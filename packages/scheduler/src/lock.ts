import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Mission lock -- learned twice in one night (Trio_Specs §C, 2026-07-05):
 * two First Officer sessions ran concurrently in one repo, once from a
 * Ctrl+C-orphaned watchdog child and once from an interactive session beside
 * the watchdog's resume. Agents detected it forensically and stood down --
 * good behavior, wrong mechanism. This is the deterministic mechanism: every
 * mission session takes the lock at start or refuses to run; supervisors
 * check/reap stale locks (dead PID or old heartbeat) before resurrecting.
 *
 * Release OVERWRITES with released:true rather than unlinking -- the history
 * of who last owned the mission stays inspectable.
 */

export interface MissionLock {
  pid: number;
  sessionId: string;
  startedAt: string;
  heartbeatAt: string;
  released?: boolean;
}

export interface LockPolicy {
  /**
   * Heartbeat older than this counts as stale even if some PID matches.
   * Default 30 min -- pairs with the session's <=25-min alive-touch contract
   * (same pairing as the guard's idle gate): a session heartbeating on
   * schedule can never look stale.
   */
  staleHeartbeatMinutes: number;
}

export const DEFAULT_LOCK_POLICY: LockPolicy = { staleHeartbeatMinutes: 30 };

export interface LockDeps {
  now?: () => Date;
  /** Injectable liveness probe (tests). Defaults to signal-0. */
  isPidAlive?: (pid: number) => boolean;
}

function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readLock(lockPath: string): MissionLock | null {
  if (!existsSync(lockPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(lockPath, 'utf8')) as MissionLock;
    if (typeof raw.pid !== 'number' || typeof raw.heartbeatAt !== 'string') return null;
    return raw;
  } catch {
    return null; // corrupt lock = stale lock
  }
}

export type LockLiveness = 'free' | 'live' | 'stale' | 'released';

export function lockLiveness(
  lock: MissionLock | null,
  policy: LockPolicy = DEFAULT_LOCK_POLICY,
  deps: LockDeps = {},
): LockLiveness {
  if (!lock) return 'free';
  if (lock.released) return 'released';
  const now = (deps.now ?? (() => new Date()))();
  const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive;
  const heartbeatAgeMin = (now.getTime() - Date.parse(lock.heartbeatAt)) / 60_000;
  const heartbeatFresh =
    !Number.isNaN(heartbeatAgeMin) && heartbeatAgeMin < policy.staleHeartbeatMinutes;
  if (!heartbeatFresh) return 'stale'; // hung or dead either way
  // pid <= 0 = pid-untracked (a CLI-acquired lock: each `lookout lock` call
  // is its own short-lived process, so a recorded CLI pid would be dead the
  // moment the command exits -- liveness is governed by the heartbeat alone).
  // A real pid buys fast reaping: dead pid = stale immediately, no waiting
  // out the heartbeat window (the spec's "dead PID or old heartbeat").
  if (lock.pid > 0 && !isPidAlive(lock.pid)) return 'stale';
  return 'live';
}

export type AcquireResult =
  | { ok: true; lock: MissionLock; reaped: MissionLock | null }
  | { ok: false; holder: MissionLock; message: string };

/** Take the mission lock, reaping a stale/released one. Refuses when live. */
export function acquireLock(
  lockPath: string,
  opts: { sessionId: string; pid?: number; policy?: Partial<LockPolicy> } & LockDeps,
): AcquireResult {
  const now = (opts.now ?? (() => new Date()))();
  const policy = { ...DEFAULT_LOCK_POLICY, ...opts.policy };
  const existing = readLock(lockPath);
  const liveness = lockLiveness(existing, policy, opts);

  if (liveness === 'live' && existing) {
    return {
      ok: false,
      holder: existing,
      message:
        `mission already owned by PID ${existing.pid} (session ${existing.sessionId}, ` +
        `started ${existing.startedAt}) -- attach read-only or stand down`,
    };
  }

  const lock: MissionLock = {
    pid: opts.pid ?? process.pid,
    sessionId: opts.sessionId,
    startedAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
  };
  mkdirSync(dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  return { ok: true, lock, reaped: liveness === 'stale' ? existing : null };
}

/**
 * Owner identity: the recorded pid when it is tracked (>0), else the mission
 * sessionId -- a pid-untracked (CLI) lock is operated on by whoever shares
 * the pinned session id from the same state dir's config.
 */
function isOwner(lock: MissionLock, opts: { pid?: number; sessionId?: string }): boolean {
  if (lock.pid > 0 && opts.pid !== undefined && lock.pid === opts.pid) return true;
  if (opts.sessionId !== undefined && lock.sessionId === opts.sessionId) return true;
  return false;
}

/** Refresh the heartbeat. Only the owner (pid or sessionId) may touch. */
export function touchLock(
  lockPath: string,
  opts: { pid?: number; sessionId?: string } & LockDeps = {},
): { ok: boolean; message?: string } {
  const lock = readLock(lockPath);
  if (!lock) return { ok: false, message: 'no lock to heartbeat' };
  const owner = { pid: opts.pid ?? process.pid, sessionId: opts.sessionId };
  if (!isOwner(lock, owner)) {
    return {
      ok: false,
      message: `lock owned by PID ${lock.pid} / session ${lock.sessionId}, not you`,
    };
  }
  lock.heartbeatAt = (opts.now ?? (() => new Date()))().toISOString();
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  return { ok: true };
}

/** Mark the lock released (overwrite, never unlink). Owner-only unless forced. */
export function releaseLock(
  lockPath: string,
  opts: { pid?: number; sessionId?: string; force?: boolean } & LockDeps = {},
): { ok: boolean; message?: string } {
  const lock = readLock(lockPath);
  if (!lock) return { ok: false, message: 'no lock to release' };
  const owner = { pid: opts.pid ?? process.pid, sessionId: opts.sessionId };
  if (!isOwner(lock, owner) && !opts.force) {
    return {
      ok: false,
      message: `lock owned by PID ${lock.pid} / session ${lock.sessionId}, not you (use --force)`,
    };
  }
  lock.released = true;
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  return { ok: true };
}
