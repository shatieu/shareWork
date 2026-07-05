import { spawn } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { findGitRoot } from '../repo.js';
import { readIndex } from '../index-schema.js';
import { normalizeSlashes } from '../repo.js';
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
 * present (the daemon rewrites it constantly; if it's missing the path itself is a valid key --
 * `doc-lookup.ts::findDoc` accepts either). Exported for unit testing. */
export function computeDocKey(repoRoot: string, relPath: string): string {
  const index = readIndex(repoRoot);
  if (index) {
    for (const [id, doc] of Object.entries(index.docs)) {
      if (doc.path === relPath) return id;
    }
  }
  return relPath;
}

async function isDaemonHealthy(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/repos`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Spawn a detached background `chartroom serve` and poll daemon.json + health until it answers
 * (or ~10s passes). Returns the live port, or undefined on timeout. */
async function ensureDaemonRunning(): Promise<number | undefined> {
  const existing = readDaemonInfo();
  if (existing && (await isDaemonHealthy(existing.port))) {
    return existing.port;
  }

  spawn(process.execPath, [CLI_JS, 'serve'], { detached: true, stdio: 'ignore' }).unref();

  const deadline = Date.now() + SPAWN_WAIT_TOTAL_MS;
  while (Date.now() < deadline) {
    await sleep(SPAWN_POLL_INTERVAL_MS);
    const info = readDaemonInfo();
    if (info && (await isDaemonHealthy(info.port))) {
      return info.port;
    }
  }
  return undefined;
}

/** Open `url` in the OS default browser, detached -- win32 needs the `start ""` quirk (the empty
 * string is the window title slot, or start would treat a quoted URL as the title). */
function openInBrowser(url: string): void {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

/**
 * `chartroom open <file>` (wave-2 feature 5): the double-click entry point. Resolves the file to
 * its registered repo (auto-registering the surrounding git repo if needed), makes sure a daemon
 * is running (health-checks `~/.chartroom/daemon.json`, spawning a detached `serve` if not), and
 * opens the browser at that doc's key-addressed UI URL.
 *
 * One honest limitation, stated rather than papered over: the daemon's static repo mounts are
 * fixed at boot, so a repo registered *just now* is invisible to an *already-running* daemon. In
 * that case this command explains how to restart instead of killing the user's daemon behind
 * their back or racing a second daemon onto another port.
 */
export function registerOpenCommand(program: Command): void {
  program
    .command('open <file>')
    .description('Open a markdown file in the Chart Room UI (starting the daemon if needed).')
    .action(async (fileArg: string) => {
      const absFile = resolve(fileArg);

      let repo = findOwningRepo(listRepos(), absFile);
      let justRegistered = false;
      if (!repo) {
        let gitRoot: string;
        try {
          gitRoot = findGitRoot(dirname(absFile));
        } catch (err) {
          console.error(`chartroom: ${(err as Error).message}`);
          process.exitCode = 2;
          return;
        }
        repo = registerRepo(gitRoot);
        justRegistered = true;
        console.log(`chartroom: registered '${repo.id}' -> ${repo.absPath}`);
      }

      const runningInfo = readDaemonInfo();
      let livePort: number | undefined;
      if (runningInfo && (await isDaemonHealthy(runningInfo.port))) {
        livePort = runningInfo.port;
      }

      if (justRegistered && runningInfo && livePort !== undefined) {
        // The running daemon predates this registration and cannot serve the new repo (static
        // mounts are fixed at boot). Be honest and stop, rather than silently opening a 404 or
        // spawning a competing second daemon.
        console.log(
          `chartroom: a daemon is already running at http://127.0.0.1:${livePort}, but it started before ` +
            `'${repo.id}' was registered and cannot serve it without a restart.`,
        );
        console.log(
          `chartroom: stop that daemon (Ctrl+C in its terminal, or end pid ${runningInfo.pid}), then re-run ` +
            `\`chartroom open ${fileArg}\` -- it will start a fresh daemon that includes the new repo.`,
        );
        process.exitCode = 1;
        return;
      }

      const port = livePort ?? (await ensureDaemonRunning());
      if (port === undefined) {
        console.error('chartroom: could not start the daemon (no healthy daemon appeared within 10s).');
        process.exitCode = 2;
        return;
      }

      const relPath = normalizeSlashes(relative(repo.absPath, absFile));
      const docKey = computeDocKey(repo.absPath, relPath);
      const url = `http://127.0.0.1:${port}/#/repo/${repo.id}/doc/${encodeURIComponent(docKey)}`;

      openInBrowser(url);
      console.log(`chartroom: opening ${url}`);
    });
}
