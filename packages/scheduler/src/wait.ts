import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createOauthUsageSource,
  decideWaitTick,
  type OauthUsageSource,
  type WaitAction,
} from 'reset-detector';
import type { LookoutConfig } from './config.js';
import { loadResumePrompt } from './config.js';
import { defaultLastCommitTime } from './guard.js';
import { readLock } from './lock.js';
import { runSensorOnce } from './sensor.js';
import { appendLog, ensureStateDir, newestMtimeUnder, readUsageFile, statePaths } from './state.js';

/**
 * The waiter loop -- Lookout v2's default flow (plan: Workstream 2). The
 * orchestrating session spawns `lookout wait` as a BACKGROUND task at session
 * start; when the loop exits, the harness delivers its stdout to that same
 * session as the task notification. That exit output IS the continue nudge,
 * so stdout must stay clean: nothing is printed until the outcome (startup
 * chatter would ride along in front of "LOOKOUT CONTINUE" and bury the lede).
 *
 * All policy lives in reset-detector's pure decideWaitTick; this module only
 * gathers inputs (usage.json, git, activityDirs, LOCK heartbeat) and executes
 * side effects -- the same split guard.ts uses.
 */

export interface WaitOutcome {
  kind: 'continue' | 'expired' | 'refused';
  /** The full text the caller prints to stdout on exit. */
  message: string;
}

export interface WaitDeps {
  now?: () => Date;
  /** Injectable sleeper (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable self-sense tick (tests). Default: runSensorOnce via the oauth source. */
  sensorTick?: () => Promise<void>;
  /** Injectable git-activity probe (tests). Returns last commit time or null. */
  lastCommitTime?: (repoRoot: string) => Date | null;
  /** Injectable pid-liveness probe (tests). Defaults to signal-0. */
  isPidAlive?: (pid: number) => boolean;
  /** Own pid recorded in the WAITER file (tests). Defaults to process.pid. */
  pid?: number;
  log?: (line: string) => void;
  /** Observe each decided action (tests). */
  onTick?: (action: WaitAction) => void;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

// Same probe as lock.ts's (not exported there; 4 lines beat a lock.ts change).
function defaultIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

interface WaiterPidFile {
  pid: number;
  startedAt: string;
}

function readWaiterPidFile(path: string): WaiterPidFile | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as WaiterPidFile;
    if (typeof raw.pid !== 'number') return null;
    return raw;
  } catch {
    return null; // corrupt = stale
  }
}

export async function runWaitLoop(
  config: LookoutConfig,
  stateDir: string,
  deps: WaitDeps = {},
): Promise<WaitOutcome> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? defaultSleep;
  const lastCommitTime = deps.lastCommitTime ?? defaultLastCommitTime;
  const isPidAlive = deps.isPidAlive ?? defaultIsPidAlive;
  const ownPid = deps.pid ?? process.pid;
  const paths = statePaths(stateDir);
  ensureStateDir(stateDir);
  const log = deps.log ?? ((line: string) => appendLog(paths.waitLogFile, line, now()));

  // Single instance: two waiters on one state dir would double-nudge the
  // session (the exact failure the guard's once-per-window marker prevents).
  const existing = readWaiterPidFile(paths.waiterPidFile);
  if (existing && existing.pid !== ownPid && isPidAlive(existing.pid)) {
    return {
      kind: 'refused',
      message:
        `another waiter is already running (PID ${existing.pid}, started ${existing.startedAt}) ` +
        `on ${stateDir} -- refusing to start a second one`,
    };
  }
  writeFileSync(
    paths.waiterPidFile,
    JSON.stringify({ pid: ownPid, startedAt: now().toISOString() }, null, 2) + '\n',
  );

  // The oauth source is created once so its internal rate-limit cache spans
  // ticks (it is aggressively rate-limited; see reset-detector/oauth.ts).
  let oauthSource: OauthUsageSource | null = null;
  const sensorTick =
    deps.sensorTick ??
    (async () => {
      oauthSource ??= createOauthUsageSource();
      await runSensorOnce({
        source: oauthSource,
        stateDir,
        thresholds: config.thresholds,
        mode: config.mode,
      });
    });

  const policy = config.wait;
  const maxHours = config.wait.maxHours;
  const startedAt = now().getTime();
  let armedWindowKey: string | null = null;
  let armedPeakPct: number | null = null;
  let renewalObservedAt: Date | null = null;
  let renewedFromKey: string | null = null;
  let renewedToKey: string | null = null;

  log(`waiter started (pid ${ownPid}, poll ${config.pollSeconds}s, grace ${policy.graceMinutes} min, max ${maxHours} h)`);

  try {
    for (;;) {
      const tickNow = now();

      // Self-expiry: a background task must not be trusted to outlive a
      // multi-day mission silently -- exit loudly and ask to be respawned.
      if (tickNow.getTime() - startedAt >= maxHours * 3_600_000) {
        const message =
          `LOOKOUT WAITER EXPIRED — ran ${maxHours} h without firing a continue. ` +
          `If the mission is still going, respawn me: run \`lookout wait\` as a ` +
          `background task again (state ${stateDir}).`;
        log(`expired after ${maxHours} h -- exiting`);
        return { kind: 'expired', message };
      }

      try {
        // Gather inputs -- same sources as guard.ts, plus the LOCK heartbeat
        // (the session's alive-touch cadence is the most direct liveness signal).
        const usage = readUsageFile(stateDir);
        const commitAt = lastCommitTime(config.repoRoot);
        const activityAt = newestMtimeUnder(
          config.activityDirs.map((d) => resolve(config.repoRoot, d)),
        );
        const lock = readLock(paths.lockFile);
        const heartbeatMs = lock ? Date.parse(lock.heartbeatAt) : NaN;
        const heartbeatAt = Number.isNaN(heartbeatMs) ? null : new Date(heartbeatMs);
        let lastActivityAt: Date | null = null;
        for (const candidate of [commitAt, activityAt, heartbeatAt]) {
          if (candidate && (!lastActivityAt || candidate > lastActivityAt)) {
            lastActivityAt = candidate;
          }
        }

        const action = decideWaitTick({
          now: tickNow,
          snapshot: usage.snapshot,
          usageFileMtime: usage.mtime,
          armedWindowKey,
          armedPeakPct,
          lastActivityAt,
          renewalObservedAt,
          policy,
        });
        deps.onTick?.(action);

        switch (action.kind) {
          case 'self-sense': {
            await sensorTick();
            log(`self-sense: ${action.reason}`);
            break;
          }
          case 'arm': {
            armedWindowKey = action.windowKey;
            armedPeakPct = usage.snapshot?.five_hour_pct ?? null;
            log(`armed on window ${action.windowKey} (five_hour ${armedPeakPct ?? '?'}%)`);
            break;
          }
          case 'renewal': {
            renewedFromKey = armedWindowKey;
            renewedToKey = action.windowKey;
            renewalObservedAt = tickNow;
            armedWindowKey = action.windowKey;
            armedPeakPct = usage.snapshot?.five_hour_pct ?? null;
            log(`renewal observed: ${action.reason} -- grace ${policy.graceMinutes} min`);
            break;
          }
          case 'rearm': {
            // The session woke itself -- re-arm silently, never double-nudge.
            armedWindowKey = action.windowKey;
            armedPeakPct = usage.snapshot?.five_hour_pct ?? null;
            renewalObservedAt = null;
            renewedFromKey = null;
            renewedToKey = null;
            log(`re-armed silently on window ${action.windowKey}: ${action.reason}`);
            break;
          }
          case 'continue': {
            const idleMin = renewalObservedAt
              ? Math.round((tickNow.getTime() - renewalObservedAt.getTime()) / 60_000)
              : policy.graceMinutes;
            const message = buildContinueMessage({
              stateDir,
              pct: usage.snapshot?.five_hour_pct ?? 0,
              oldKey: renewedFromKey ?? '(unknown)',
              newKey: renewedToKey ?? armedWindowKey ?? '(unknown)',
              idleMin,
            });
            log(`CONTINUE fired: ${action.reason}`);
            return { kind: 'continue', message };
          }
          case 'wait': {
            // Track the armed window's burn peak -- it feeds the secondary
            // (equal-key pct-collapse) renewal signal in decideWaitTick.
            if (armedWindowKey && !renewalObservedAt && usage.snapshot) {
              armedPeakPct = Math.max(armedPeakPct ?? 0, usage.snapshot.five_hour_pct);
            }
            break;
          }
        }
      } catch (err) {
        // Errors never break the loop and never shorten the interval.
        log(`tick failed (loop continues): ${err instanceof Error ? err.message : String(err)}`);
      }

      // After a renewal is observed, tighten the poll so the grace window is
      // measured with ~1-min resolution (a 300 s poll would overshoot a 10-min
      // grace by up to half a poll). Never widen beyond the configured poll.
      const pollMs = config.pollSeconds * 1000;
      const intervalMs = renewalObservedAt ? Math.min(60_000, pollMs) : pollMs;
      await sleep(intervalMs);
    }
  } finally {
    // Best-effort: let the next waiter start without a liveness probe.
    try {
      rmSync(paths.waiterPidFile, { force: true });
    } catch {
      /* best effort */
    }
  }
}

/**
 * Written FOR the session that spawned the waiter -- this text arrives as its
 * background-task notification, so the first line must carry the whole story
 * and the rest must tell it exactly what to do next.
 */
function buildContinueMessage(opts: {
  stateDir: string;
  pct: number;
  oldKey: string;
  newKey: string;
  idleMin: number;
}): string {
  const lines = [
    `LOOKOUT CONTINUE — usage window renewed (five_hour ${opts.pct}%, was window ${opts.oldKey}, ` +
      `now ${opts.newKey}); no session activity for ${opts.idleMin} min since renewal.`,
    `Re-read the signal files under ${opts.stateDir} and your mission checkpoint, then resume the queue.`,
  ];
  const prompt = loadResumePrompt(opts.stateDir);
  if (prompt) lines.push(prompt);
  return lines.join('\n');
}
