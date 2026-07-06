import type { UsageSnapshot } from './types.js';
import { windowKeyOf } from './window.js';

/**
 * The pure resurrection-guard decision -- every rule here was learned the
 * hard way on the 2026-07-05/06 overnight mission (see guard.ps1's dated
 * patch comments and LESSONS-LEARNED.md):
 *
 * - ScheduleWakeup does not survive a hard token cap, so an EXTERNAL guard
 *   (Task Scheduler / cron) must own the wake-after-reset guarantee.
 * - resets_at jitters between polls; dedup must key on the rounded window
 *   (5 resurrections fired in one window before that patch).
 * - The 30-min idle threshold pairs with the session's <=25-min alive-touch
 *   heartbeat: a living session can never look dead, so resurrection means
 *   real death only.
 * - Bare `claude --continue` resumes the most recently touched session in
 *   the directory and once appended mission turns into a foreign transcript;
 *   resurrect ONLY with `--resume <pinned session id>` -- no silent fallback.
 * - Print-mode kills still-running background workers ~600 s after the final
 *   text unless CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 (killed a developer
 *   agent mid-build on 2026-07-06).
 */

export interface GuardPolicy {
  /** usage.json older than this = dead sensor. Default 12 (poll 300 s x2 + slack). */
  sensorStaleMinutes: number;
  /** Resurrect only when five_hour_pct is below this (fresh window). Default 20. */
  tokensAvailableBelowPct: number;
  /** Repo must be idle at least this long. Default 30 (pairs with <=25-min heartbeat). */
  idleMinutes: number;
}

export const DEFAULT_GUARD_POLICY: GuardPolicy = {
  sensorStaleMinutes: 12,
  tokensAvailableBelowPct: 20,
  idleMinutes: 30,
};

export interface GuardInput {
  now: Date;
  /** Last sensor observation (parsed usage.json) and the file's mtime; null when absent. */
  snapshot: UsageSnapshot | null;
  usageFileMtime: Date | null;
  /** Newest of (last git commit, tracking-file mtimes); null = no activity ever seen. */
  lastActivityAt: Date | null;
  /** Window keys of resurrections already performed (marker files). */
  resurrectionKeys: string[];
  /** The pinned mission session id (minted at launch with --session-id). */
  sessionId: string | null;
  /** The resume prompt text; null when not configured. */
  resumePrompt: string | null;
  policy?: Partial<GuardPolicy>;
}

export interface ResurrectCommand {
  /** argv[0] is the executable. */
  argv: string[];
  /** Extra environment the spawn must merge over process.env. */
  env: Record<string, string>;
}

export type GuardAction =
  | { kind: 'relaunch-sensor'; reason: string }
  | { kind: 'none'; reason: string }
  | { kind: 'refuse'; reason: string }
  | { kind: 'resurrect'; windowKey: string; command: ResurrectCommand; reason: string };

export const PRINT_BG_CEILING_ENV = 'CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS';

export function buildResurrectCommand(sessionId: string, resumePrompt: string): ResurrectCommand {
  return {
    argv: [
      'claude',
      '--resume',
      sessionId,
      '-p',
      resumePrompt,
      '--permission-mode',
      'bypassPermissions',
    ],
    env: { [PRINT_BG_CEILING_ENV]: '0' },
  };
}

export function decideGuardAction(input: GuardInput): GuardAction {
  const policy: GuardPolicy = { ...DEFAULT_GUARD_POLICY, ...input.policy };
  const now = input.now.getTime();

  // 1. Sensor freshness -- without a live sensor nothing else is trustworthy.
  const mtime = input.usageFileMtime?.getTime();
  if (!input.snapshot || mtime === undefined || Number.isNaN(mtime)) {
    return { kind: 'relaunch-sensor', reason: 'usage.json missing or unreadable' };
  }
  const sensorAgeMin = (now - mtime) / 60_000;
  if (sensorAgeMin >= policy.sensorStaleMinutes) {
    return {
      kind: 'relaunch-sensor',
      reason: `usage.json stale (${sensorAgeMin.toFixed(1)} min >= ${policy.sensorStaleMinutes})`,
    };
  }

  // 2. Token gate: only a clearly fresh window justifies a resurrection.
  const pct = input.snapshot.five_hour_pct;
  if (pct >= policy.tokensAvailableBelowPct) {
    return {
      kind: 'none',
      reason: `five_hour_pct ${pct} >= ${policy.tokensAvailableBelowPct} (window not fresh)`,
    };
  }

  // 3. Idle gate: a living session heartbeats <=25 min; 30 min quiet = dead.
  if (input.lastActivityAt) {
    const idleMin = (now - input.lastActivityAt.getTime()) / 60_000;
    if (idleMin < policy.idleMinutes) {
      return {
        kind: 'none',
        reason: `repo active ${idleMin.toFixed(1)} min ago (< ${policy.idleMinutes} min idle)`,
      };
    }
  }

  // 4. Once per window, keyed on the jitter-proof window key.
  const windowKey = windowKeyOf(input.snapshot.resets_at);
  if (input.resurrectionKeys.includes(windowKey)) {
    return { kind: 'none', reason: `already resurrected this window (${windowKey})` };
  }

  // 5. Session pinning is mandatory -- refuse loudly rather than `-c` blindly.
  if (!input.sessionId) {
    return {
      kind: 'refuse',
      reason:
        'no pinned sessionId configured -- refusing to resurrect (bare --continue ' +
        'resumes the wrong session; run `lookout init` and launch with --session-id)',
    };
  }
  if (!input.resumePrompt || input.resumePrompt.trim().length === 0) {
    return { kind: 'refuse', reason: 'no resume prompt configured -- refusing to resurrect' };
  }

  return {
    kind: 'resurrect',
    windowKey,
    command: buildResurrectCommand(input.sessionId, input.resumePrompt.trim()),
    reason: `five_hour_pct ${pct} with idle repo -- resurrecting session (window ${windowKey})`,
  };
}
