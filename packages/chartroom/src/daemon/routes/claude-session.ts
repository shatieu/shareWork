import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { DECK_CLIENT_HEADER } from 'suite-conventions';
import type { RepoRuntime } from '../server.js';

/** The exact slice of `child_process.spawn` this route needs -- injectable so the route test can
 * assert "a terminal would have been opened" (argv, cwd, cleaned env) without opening one. */
export type SpawnLike = (
  command: string,
  args: string[],
  options: { detached: boolean; stdio: 'ignore'; env: NodeJS.ProcessEnv; cwd?: string },
) => { unref: () => void; on?: (event: string, listener: (...args: unknown[]) => void) => unknown };

export interface ClaudeSessionRouteOptions {
  /** test seam: replaces `child_process.spawn`. */
  spawner?: SpawnLike;
  /** test seam: pretend to be another OS. */
  platform?: NodeJS.Platform;
  /** test seam / cache: whether Windows Terminal (`wt`) is available. */
  hasWindowsTerminal?: () => boolean;
  /** test seam: the environment to clean and hand to the child (default `process.env`). */
  baseEnv?: NodeJS.ProcessEnv;
}

/**
 * Windows Terminal detection (researcher R3): `where wt` finds the Store app's App Execution
 * Alias for a plain user process (alias is on by default), but misses it if the daemon was
 * started with a stripped PATH -- belt-and-braces with an existsSync on the well-known alias
 * location. A user who disabled the alias correctly falls through to the cmd branch.
 */
function windowsTerminalAvailable(): boolean {
  try {
    if (spawnSync('where', ['wt'], { stdio: 'ignore' }).status === 0) return true;
  } catch {
    /* fall through to the path probe */
  }
  try {
    const localAppData = process.env.LOCALAPPDATA;
    return !!localAppData && existsSync(join(localAppData, 'Microsoft', 'WindowsApps', 'wt.exe'));
  } catch {
    return false;
  }
}

/**
 * Env hygiene (researcher R2): mirror the claude CLI's own fresh-session spawn exactly -- strip
 * the four session markers and blank INVOCATION_ID (verbatim from the vendor binary's own
 * env-hygiene function), plus two cheap extras. Without this the parent daemon's own Claude
 * session (e.g. when the Deck was launched from inside Claude Code) leaks into the child --
 * empirically proven (probe children received CLAUDECODE=[1] through both spawn branches).
 */
export function cleanClaudeEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv, INVOCATION_ID: '' };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_CODE_CHILD_SESSION;
  delete env.CLAUDE_CODE_BRIDGE_SESSION_ID;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.AI_AGENT;
  return env;
}

/** Launch a detached terminal window running `claude` with cwd = repoAbsPath. Throws on a
 * synchronous spawn failure; the route translates that into a readable 500.
 *
 * win32 argv shapes are researcher-R1-verified (empirical spawn matrix, spaces-in-path cases):
 * - wt branch: direct `wt.exe` spawn, `-w new` forces a fresh window regardless of the user's
 *   windowingBehavior; `-d` handles paths with spaces; the command is wrapped in `cmd /k` because
 *   wt's CreateProcess does NOT resolve npm `.cmd` shims (PATHEXT) -- `cmd` does, and `/k` keeps
 *   the tab open after claude exits.
 * - cmd fallback: `start` with an explicit title (so a quoted path is never eaten as the title);
 *   spawn's `cwd:` option propagates through `cmd /c start` to the new console -- no `cd /d`.
 * - A repo path containing `;` is routed to the cmd fallback (wt treats `;` as a command
 *   delimiter; vanishingly rare, and the fallback handles it verbatim).
 */
function launchTerminal(
  spawner: SpawnLike,
  platform: NodeJS.Platform,
  hasWt: () => boolean,
  env: NodeJS.ProcessEnv,
  repoName: string,
  repoAbsPath: string,
): void {
  let child: ReturnType<SpawnLike>;

  if (platform === 'win32') {
    if (hasWt() && !repoAbsPath.includes(';')) {
      child = spawner('wt.exe', ['-w', 'new', '-d', repoAbsPath, 'cmd', '/k', 'claude'], {
        detached: true,
        stdio: 'ignore',
        env,
      });
    } else {
      child = spawner('cmd', ['/c', 'start', `Claude — ${repoName}`, 'cmd', '/k', 'claude'], {
        detached: true,
        stdio: 'ignore',
        env,
        cwd: repoAbsPath,
      });
    }
  } else if (platform === 'darwin') {
    // `open -a Terminal <file>` runs a .command file in a fresh Terminal window. Per-request
    // unique launcher file (plan 03 §3.1 fix: the old single shared file was a TOCTOU race
    // between two concurrent chip clicks on different repos).
    const dir = join(homedir(), '.chartroom', 'claude-launchers');
    mkdirSync(dir, { recursive: true });
    const launcher = join(dir, `claude-session-${Date.now()}-${randomBytes(4).toString('hex')}.command`);
    writeFileSync(launcher, `#!/bin/sh\ncd "${repoAbsPath.replace(/"/g, '\\"')}" && exec claude\n`, 'utf8');
    chmodSync(launcher, 0o755);
    child = spawner('open', ['-a', 'Terminal', launcher], { detached: true, stdio: 'ignore', env });
  } else {
    // Debian-alternatives entry point present on most Linux desktops; if it's missing, spawn
    // throws/errors and the route reports it honestly rather than guessing at emulators.
    child = spawner(
      'x-terminal-emulator',
      ['-e', `sh -c 'cd "${repoAbsPath.replace(/"/g, '\\"')}" && exec claude'`],
      { detached: true, stdio: 'ignore', env, cwd: repoAbsPath },
    );
  }

  // Async spawn errors (e.g. ENOENT after the response is already sent) must not crash the
  // daemon -- swallow them; the window simply won't appear.
  child.on?.('error', () => {});
  child.unref();
}

/**
 * `POST /api/repos/:repoId/claude-session` (plan 03 §4.5) -- opens a NEW terminal window running
 * the `claude` CLI with cwd = that repo's absolute path, fully detached from the daemon process
 * (the daemon dying must never take a user's Claude session down with it). Returns `{ ok: true }`
 * once the launcher process has been handed to the OS; a spawn failure comes back as a readable
 * 500, an unknown repo as 404.
 *
 * CSRF guard: requires the `x-ship-deck` custom header. A cross-origin form/fetch cannot attach a
 * custom header without a CORS preflight, and this server enables no CORS -- so a malicious web
 * page cannot make the local daemon spawn terminals. (Any local process still can; inherent to a
 * local daemon, documented in the ship README.)
 */
export function registerClaudeSessionRoute(
  app: FastifyInstance,
  repos: RepoRuntime[],
  options: ClaudeSessionRouteOptions = {},
): void {
  const spawner = options.spawner ?? (spawn as unknown as SpawnLike);
  const platform = options.platform ?? process.platform;
  const hasWt = options.hasWindowsTerminal ?? windowsTerminalAvailable;

  app.post('/api/repos/:repoId/claude-session', async (request, reply) => {
    if (request.headers[DECK_CLIENT_HEADER] === undefined) {
      return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
    }

    const { repoId } = request.params as { repoId: string };
    const repo = repos.find((r) => r.id === repoId);
    if (!repo) {
      return reply.code(404).send({ error: `unknown repo '${repoId}'` });
    }

    try {
      const env = cleanClaudeEnv(options.baseEnv);
      launchTerminal(spawner, platform, hasWt, env, repo.name, repo.absPath);
    } catch (err) {
      return reply.code(500).send({ error: `could not open a terminal: ${(err as Error).message}` });
    }

    return { ok: true };
  });
}
