import { spawn } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { findGitRoot, normalizeSlashes } from '../repo.js';
import { readIndex } from '../index-schema.js';
import { listRepos, registerRepo, type RegisteredRepo } from '../daemon/registry.js';
import { readDaemonInfo } from '../daemon/daemon-info.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** dist/commands/open.js -> dist/cli.js -- the entrypoint a spawned background daemon runs. */
const CLI_JS = join(HERE, '..', 'cli.js');

const HEALTH_TIMEOUT_MS = 1500;
const SPAWN_WAIT_TOTAL_MS = 10_000;
const SPAWN_POLL_INTERVAL_MS = 300;

/** Is `childPath` inside (or equal to) `parentPath`? Path-boundary aware (`/repo` does not contain
 * `/repo-two/x`), case-insensitive on win32 where the filesystem is. */
function pathContains(parentPath: string, childPath: string): boolean {
  let rel = relative(resolve(parentPath), resolve(childPath));
  if (process.platform === 'win32') {
    rel = relative(resolve(parentPath).toLowerCase(), resolve(childPath).toLowerCase());
  }
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** The registered repo owning `absFile`, longest absPath prefix wins (nested repo registrations
 * resolve to the innermost). Exported for unit testing. */
export function findOwningRepo(repos: RegisteredRepo[], absFile: string): RegisteredRepo | undefined {
  let best: RegisteredRepo | undefined;
  for (const repo of repos) {
    if (!pathContains(repo.absPath, absFile)) continue;
    if (!best || resolve(repo.absPath).length > resolve(best.absPath).length) {
      best = repo;
    }
  }
  return best;
}

/** doc key (`id ?? path`) for a repo-relative file path, from that repo's `.docs/index.json` if
 * present (the daemon rewrites it constantly; if it's missing -- e.g. a repo registered seconds
 * ago -- the path itself is a valid key, `doc-lookup.ts::findDoc` accepts either). Exported for
 * unit testing. */
export function computeDocKey(repoRoot: string, relPath: string): string {
  const index = readIndex(repoRoot);
  if (index) {
    for (const [id, doc] of Object.entries(index.docs)) {
      if (doc.path === relPath) return id;
    }
  }
  return relPath;
}

/** Injectable seams so unit tests can drive the whole decision tree without a real daemon,
 * browser, registry, or clock (plan §4.E / §5). Every field defaults to the real thing. */
export interface OpenDeps {
  homeDir?: string;
  fetchFn?: typeof fetch;
  /** Spawns the detached background `chartroom serve`. */
  spawnDaemon?: () => void;
  openBrowser?: (url: string) => void;
  sleep?: (ms: number) => Promise<void>;
  spawnWaitTotalMs?: number;
  spawnPollIntervalMs?: number;
  log?: (msg: string) => void;
  logError?: (msg: string) => void;
}

function realSpawnDaemon(): void {
  spawn(process.execPath, [CLI_JS, 'serve'], { detached: true, stdio: 'ignore' }).unref();
}

/** Open `url` in the OS default browser, detached -- win32 needs the `start ""` quirk (the empty
 * string is the window title slot, or start would treat a quoted URL as the title). */
function realOpenBrowser(url: string): void {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

interface DaemonProbe {
  healthy: boolean;
  /** repo ids the live daemon actually serves (from GET /api/repos) -- may lag the registry. */
  repoIds: Set<string>;
}

async function probeDaemon(port: number, fetchFn: typeof fetch): Promise<DaemonProbe> {
  try {
    const response = await fetchFn(`http://127.0.0.1:${port}/api/repos`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return { healthy: false, repoIds: new Set() };
    const body = (await response.json()) as Array<{ id: string }>;
    return { healthy: true, repoIds: new Set(body.map((r) => r.id)) };
  } catch {
    return { healthy: false, repoIds: new Set() };
  }
}

/**
 * The core of `chartroom open <file>` (v1.1): resolves the file to its registered repo
 * (auto-registering the surrounding git repo if needed), makes sure a daemon is running AND knows
 * the repo -- an already-running daemon that predates the registration is told about it live via
 * `POST /api/repos/register` (the whole reason routes/repo-register.ts exists) -- and opens the
 * browser at the doc's key-addressed UI URL. With `printUrl`, prints the URL instead of opening a
 * browser (for scripts and acceptance tests).
 *
 * Returns the process exit code (0 ok; 2 fatal: no git root / no daemon / live-register refused).
 * Exported for unit testing.
 */
export async function openFile(fileArg: string, printUrl: boolean, deps: OpenDeps = {}): Promise<number> {
  const homeDir = deps.homeDir;
  const fetchFn = deps.fetchFn ?? fetch;
  const spawnDaemon = deps.spawnDaemon ?? realSpawnDaemon;
  const openBrowser = deps.openBrowser ?? realOpenBrowser;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = deps.log ?? console.log;
  const logError = deps.logError ?? console.error;
  const spawnWaitTotalMs = deps.spawnWaitTotalMs ?? SPAWN_WAIT_TOTAL_MS;
  const spawnPollIntervalMs = deps.spawnPollIntervalMs ?? SPAWN_POLL_INTERVAL_MS;

  const absFile = resolve(fileArg);

  let repo = findOwningRepo(listRepos(homeDir), absFile);
  if (!repo) {
    let gitRoot: string;
    try {
      gitRoot = findGitRoot(dirname(absFile));
    } catch (err) {
      logError(`chartroom: ${(err as Error).message}`);
      return 2;
    }
    repo = registerRepo(gitRoot, homeDir);
    log(`chartroom: registered '${repo.id}' -> ${repo.absPath}`);
  }

  // Find a live daemon (daemon.json is only a hint -- always health-checked).
  const info = readDaemonInfo(homeDir);
  let port: number | undefined;
  if (info) {
    const probe = await probeDaemon(info.port, fetchFn);
    if (probe.healthy) {
      port = info.port;
      if (!probe.repoIds.has(repo.id)) {
        // The running daemon predates this repo's registration. Register it live -- the daemon
        // serves raw assets dynamically, so no restart is needed.
        try {
          const response = await fetchFn(`http://127.0.0.1:${port}/api/repos/register`, {
            method: 'POST',
            // x-ship-deck: the daemon's CSRF guard on state-changing routes (plan 03 §4.5) --
            // presence is the proof; a browser page can't attach a custom header cross-origin.
            headers: { 'content-type': 'application/json', 'x-ship-deck': '1' },
            body: JSON.stringify({ path: repo.absPath }),
            signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS * 4),
          });
          if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw new Error(`daemon answered ${response.status} ${detail}`.trim());
          }
          log(`chartroom: live-registered '${repo.id}' with the running daemon on port ${port}.`);
        } catch (err) {
          // Fallback only -- an old daemon (pre-register-endpoint) or a refusing one.
          logError(
            `chartroom: a daemon is running at http://127.0.0.1:${port} but could not live-register ` +
              `'${repo.id}' (${(err as Error).message}).`,
          );
          logError(
            `chartroom: stop that daemon (Ctrl+C in its terminal, or end pid ${info.pid}), then re-run ` +
              `\`chartroom open ${fileArg}\` -- a fresh daemon will include the new repo.`,
          );
          return 2;
        }
      }
    }
  }

  if (port === undefined) {
    spawnDaemon();
    const deadline = Date.now() + spawnWaitTotalMs;
    while (Date.now() < deadline) {
      await sleep(spawnPollIntervalMs);
      const fresh = readDaemonInfo(homeDir);
      if (fresh && (await probeDaemon(fresh.port, fetchFn)).healthy) {
        port = fresh.port;
        break;
      }
    }
    if (port === undefined) {
      logError('chartroom: could not start the daemon (no healthy daemon appeared within 10s).');
      return 2;
    }
  }

  const relPath = normalizeSlashes(relative(repo.absPath, absFile));
  const docKey = computeDocKey(repo.absPath, relPath);
  const url = `http://127.0.0.1:${port}/#/repo/${encodeURIComponent(repo.id)}/doc/${encodeURIComponent(docKey)}`;

  if (printUrl) {
    log(url);
    return 0;
  }
  openBrowser(url);
  log(`chartroom: opening ${url}`);
  return 0;
}

/**
 * `chartroom open <file> [--print-url]` (v1.1): the double-click entry point -- see `openFile`.
 */
export function registerOpenCommand(program: Command): void {
  program
    .command('open <file>')
    .description('Open a markdown file in the Chart Room UI (starting the daemon if needed).')
    .option('--print-url', 'print the doc URL instead of opening a browser')
    .action(async (fileArg: string, opts: { printUrl?: boolean }) => {
      const code = await openFile(fileArg, Boolean(opts.printUrl));
      if (code !== 0) process.exitCode = code;
    });
}
