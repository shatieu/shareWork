import type { UsageSnapshot } from './types.js';
import { windowKeyOf } from './window.js';

/**
 * The pure waiter decision -- Lookout v2 (plan:
 * .claude/plans/suite-repo-onboarding-and-lookout-v2.md, Workstream 2).
 *
 * Why a waiter instead of the guard as the default: the guard needs
 * per-machine Task Scheduler/cron registration (a human step) and resurrects
 * via a NEW headless claude process. The waiter is spawned by the session
 * itself as a background task; when it exits, the harness delivers its stdout
 * to the SAME session -- that IS the continue channel. No registration, no
 * second claude process, no bypassPermissions.
 *
 * Field-learned constraints carried over from the guard (decide.ts):
 * - resets_at jitters sub-seconds between polls, so window identity is
 *   windowKeyOf (rounded to the minute), never string equality.
 * - A stale usage.json means every later rule reads garbage, so the sensor
 *   check runs first; the waiter runs its OWN sensor tick rather than
 *   spawning a separate sensor process (one canonical signal path -- this
 *   absorbs the guard's relaunch-sensor duty).
 * - The grace gate pairs with the session's alive-touch heartbeat: a session
 *   that woke itself (e.g. its own ScheduleWakeup) shows activity right after
 *   the renewal, and the waiter must RE-ARM silently, never double-nudge.
 */

export interface WaitPolicy {
  /** usage.json older than this = run our own sensor tick. Default 12 (poll 300 s x2 + slack). */
  sensorStaleMinutes: number;
  /** A five_hour_pct below this reads as a freshly renewed window. Default 20. */
  freshBelowPct: number;
  /** After a renewal, wait this long for the session to wake itself before nudging. Default 10. */
  graceMinutes: number;
  /**
   * The secondary (equal-window-key) renewal signal counts only when the
   * armed window was first seen burning at/above this pct (default 80 = the
   * ALERT default). Without this floor, arming inside an already-fresh window
   * (pct < freshBelowPct at spawn -- the normal session-start case) would
   * false-fire a renewal on the very next tick.
   */
  collapseFromPct: number;
}

export const DEFAULT_WAIT_POLICY: WaitPolicy = {
  sensorStaleMinutes: 12,
  freshBelowPct: 20,
  graceMinutes: 10,
  collapseFromPct: 80,
};

export interface WaitInput {
  now: Date;
  /** Last sensor observation (parsed usage.json) and the file's mtime; null when absent. */
  snapshot: UsageSnapshot | null;
  usageFileMtime: Date | null;
  /** Window key the waiter is armed on; null before the first arm. */
  armedWindowKey: string | null;
  /**
   * Highest five_hour_pct observed while armed on armedWindowKey (tracked by
   * the loop). Enables the secondary renewal signal: same window key but the
   * pct collapsed from a visibly burning window -- the endpoint sometimes lags
   * resets_at behind the actual reset. null/undefined disables that signal.
   */
  armedPeakPct?: number | null;
  /** Newest of (last git commit, activityDirs mtimes, LOCK heartbeat); null = none seen. */
  lastActivityAt: Date | null;
  /** When the loop first observed the renewal; null until then. */
  renewalObservedAt: Date | null;
  policy?: Partial<WaitPolicy>;
}

export type WaitAction =
  | { kind: 'self-sense'; reason: string }
  | { kind: 'arm'; windowKey: string }
  | { kind: 'renewal'; windowKey: string; reason: string }
  | { kind: 'rearm'; windowKey: string; reason: string }
  | { kind: 'continue'; reason: string }
  | { kind: 'wait'; reason: string };

export function decideWaitTick(input: WaitInput): WaitAction {
  const policy: WaitPolicy = { ...DEFAULT_WAIT_POLICY, ...input.policy };
  const now = input.now.getTime();

  // 1. Sensor honesty first -- without a fresh usage.json every later rule
  // reads garbage. Self-sense = the waiter runs its own sensor tick.
  const mtime = input.usageFileMtime?.getTime();
  if (!input.snapshot || mtime === undefined || Number.isNaN(mtime)) {
    return { kind: 'self-sense', reason: 'usage.json missing or unreadable' };
  }
  const sensorAgeMin = (now - mtime) / 60_000;
  if (sensorAgeMin >= policy.sensorStaleMinutes) {
    return {
      kind: 'self-sense',
      reason: `usage.json stale (${sensorAgeMin.toFixed(1)} min >= ${policy.sensorStaleMinutes})`,
    };
  }

  const windowKey = windowKeyOf(input.snapshot.resets_at);
  const pct = input.snapshot.five_hour_pct;

  // 2. Grace phase: a renewal was already observed; the only question is
  // whether the session woke itself. Activity strictly AFTER the renewal
  // means it did -- re-arm silently on the current window, never double-nudge.
  if (input.renewalObservedAt) {
    const renewedAt = input.renewalObservedAt.getTime();
    if (input.lastActivityAt && input.lastActivityAt.getTime() > renewedAt) {
      return {
        kind: 'rearm',
        windowKey,
        reason: `session active at ${input.lastActivityAt.toISOString()} (after the renewal) -- it woke itself`,
      };
    }
    const graceMin = (now - renewedAt) / 60_000;
    if (graceMin >= policy.graceMinutes) {
      return {
        kind: 'continue',
        reason:
          `window renewed ${graceMin.toFixed(1)} min ago with no session activity since ` +
          `(grace ${policy.graceMinutes} min)`,
      };
    }
    return {
      kind: 'wait',
      reason: `in grace (${graceMin.toFixed(1)}/${policy.graceMinutes} min), no activity yet`,
    };
  }

  // 3. Not armed yet: arm on the current window.
  if (input.armedWindowKey === null) {
    return { kind: 'arm', windowKey };
  }

  // 4. Renewal detection. Primary signal: the jitter-proof window key changed.
  if (windowKey !== input.armedWindowKey) {
    return {
      kind: 'renewal',
      windowKey,
      reason: `window key changed (${input.armedWindowKey} -> ${windowKey})`,
    };
  }
  // Secondary signal, deliberately conservative (see collapseFromPct doc):
  // same key but the pct collapsed below freshBelowPct after the armed window
  // was seen burning >= collapseFromPct. Covers the endpoint lagging resets_at
  // behind the actual reset; the key change above stays THE renewal signal.
  if (pct < policy.freshBelowPct && input.armedPeakPct != null && input.armedPeakPct >= policy.collapseFromPct) {
    return {
      kind: 'renewal',
      windowKey,
      reason:
        `five_hour_pct collapsed (peak ${input.armedPeakPct} -> ${pct} < ${policy.freshBelowPct}) ` +
        `on an unchanged window key`,
    };
  }

  return { kind: 'wait', reason: `armed on ${windowKey}, five_hour ${pct}%` };
}
