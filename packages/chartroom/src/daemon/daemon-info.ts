import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const DAEMON_DIR_NAME = '.chartroom';
const DAEMON_FILE_NAME = 'daemon.json';

/**
 * The daemon discovery file (wave-2 feature 5): `chartroom serve` writes it after `.listen()`
 * succeeds; `chartroom open` reads it to find (and health-check) a running daemon instead of
 * blindly spawning a second one. The file can be stale (daemon crashed without cleanup), so
 * readers must always health-check the port -- `readDaemonInfo` only promises "this is what the
 * last daemon wrote", never "a daemon is running".
 */
export interface DaemonInfo {
  port: number;
  pid: number;
  startedAt: string;
}

/** Same `homeDir` override pattern as registry.ts/activity.ts -- tests never touch the real home. */
export function daemonInfoPath(homeDir: string = homedir()): string {
  return join(homeDir, DAEMON_DIR_NAME, DAEMON_FILE_NAME);
}

export function writeDaemonInfo(info: DaemonInfo, homeDir: string = homedir()): void {
  const path = daemonInfoPath(homeDir);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(info, null, 2) + '\n', 'utf8');
}

export function readDaemonInfo(homeDir: string = homedir()): DaemonInfo | undefined {
  const path = daemonInfoPath(homeDir);
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<DaemonInfo>;
    if (typeof parsed.port !== 'number' || typeof parsed.pid !== 'number') return undefined;
    return { port: parsed.port, pid: parsed.pid, startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '' };
  } catch {
    return undefined;
  }
}

/** Best-effort delete (SIGINT/SIGTERM path) -- a failure here must never turn a clean shutdown
 * into a crash; worst case the next `chartroom open` health-checks a stale file and moves on. */
export function deleteDaemonInfo(homeDir: string = homedir()): void {
  try {
    unlinkSync(daemonInfoPath(homeDir));
  } catch {
    // already gone / never written / unwritable -- all fine.
  }
}
