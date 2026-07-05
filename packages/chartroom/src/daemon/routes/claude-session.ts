import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { ActivityLog } from '../activity.js';
import type { RepoRuntime } from '../server.js';

/** The exact slice of `child_process.spawn` this route needs -- injectable so the route test can
 * assert "a terminal would have been opened" without ever actually opening one. */
export type SpawnLike = (
  command: string,
  args: string[],
  options: { detached: boolean; stdio: 'ignore' },
) => { unref: () => void; on?: (event: string, listener: (...args: unknown[]) => void) => unknown };

export interface ClaudeSessionRouteOptions {
  /** test seam: replaces `child_process.spawn`. */
  spawner?: SpawnLike;
  /** test seam: pretend to be another OS. */
  platform?: NodeJS.Platform;
  /** test seam / cache: whether Windows Terminal (`wt`) is on PATH. */
  hasWindowsTerminal?: () => boolean;
}

function windowsTerminalAvailable(): boolean {
  try {
    return spawnSync('where', ['wt'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

/** Launch a detached terminal window running `claude` with cwd = repoAbsPath. Throws on a
 * synchronous spawn failure; the route translates that into a readable 500. */
function launchTerminal(
  spawner: SpawnLike,
  platform: NodeJS.Platform,
  hasWt: () => boolean,
  repoName: string,
  repoAbsPath: string,
): void {
  let child: ReturnType<SpawnLike>;

  if (platform === 'win32') {
    if (hasWt()) {
      child = spawner('cmd', ['/c', 'start', '', 'wt', '-d', repoAbsPath, 'claude'], {
        detached: true,
        stdio: 'ignore',
      });
    } else {
      child = spawner(
        'cmd',
        ['/c', 'start', `Claude — ${repoName}`, 'cmd', '/k', `cd /d ${repoAbsPath} && claude`],
        { detached: true, stdio: 'ignore' },
      );
    }
  } else if (platform === 'darwin') {
    // `open -a Terminal <file>` runs a .command file in a fresh Terminal window -- write a tiny
    // launcher under ~/.chartroom (regenerated every time; the repo path is baked in).
    const dir = join(homedir(), '.chartroom');
    mkdirSync(dir, { recursive: true });
    const launcher = join(dir, 'claude-session.command');
    writeFileSync(launcher, `#!/bin/sh\ncd "${repoAbsPath}" && exec claude\n`, 'utf8');
    chmodSync(launcher, 0o755);
    child = spawner('open', ['-a', 'Terminal', launcher], { detached: true, stdio: 'ignore' });
  } else {
    // Debian-alternatives entry point present on most Linux desktops; if it's missing, spawn
    // throws/errors and the route reports it honestly rather than guessing at emulators.
    child = spawner('x-terminal-emulator', ['-e', `sh -c 'cd "${repoAbsPath}" && exec claude'`], {
      detached: true,
      stdio: 'ignore',
    });
  }

  // Async spawn errors (e.g. ENOENT after the response is already sent) must not crash the
  // daemon -- swallow them; the window simply won't appear.
  child.on?.('error', () => {});
  child.unref();
}

/**
 * `POST /api/repos/:repoId/claude-session` (wave-2 feature 6) -- opens a NEW terminal window
 * running the `claude` CLI with cwd = that repo's absolute path, fully detached from the daemon
 * process (the daemon dying must never take a user's Claude session down with it). Returns
 * `{ ok: true }` once the launcher process has been handed to the OS; a spawn failure comes back
 * as a readable 500, an unknown repo as 404.
 */
export function registerClaudeSessionRoute(
  app: FastifyInstance,
  repos: RepoRuntime[],
  activity?: ActivityLog,
  options: ClaudeSessionRouteOptions = {},
): void {
  const spawner = options.spawner ?? (spawn as unknown as SpawnLike);
  const platform = options.platform ?? process.platform;
  const hasWt = options.hasWindowsTerminal ?? windowsTerminalAvailable;

  app.post('/api/repos/:repoId/claude-session', async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const repo = repos.find((r) => r.id === repoId);
    if (!repo) {
      return reply.code(404).send({ error: `unknown repo '${repoId}'` });
    }

    try {
      launchTerminal(spawner, platform, hasWt, repo.name, repo.absPath);
    } catch (err) {
      return reply.code(500).send({ error: `could not open a terminal: ${(err as Error).message}` });
    }

    activity?.log({
      ts: new Date().toISOString(),
      repoId: repo.id,
      repoName: repo.name,
      kind: 'session',
      summary: 'claude session opened',
      detail: repo.name,
    });

    return { ok: true };
  });
}
