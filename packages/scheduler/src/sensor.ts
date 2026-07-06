import { evaluateSignals, type OauthUsageSource, type Thresholds, type UsageMode, type UsageSnapshot } from 'reset-detector';
import { appendLog, statePaths, writeSensorResult } from './state.js';

/**
 * The sensor half of the Lookout: reads usage on a fixed interval and writes
 * state files. It NEVER launches, kills, resumes, or controls any other
 * process -- the session is primary, the Lookout is its instrument
 * (Trio_Specs §C product shape).
 */

export interface SensorOptions {
  source: OauthUsageSource;
  stateDir: string;
  thresholds: Thresholds;
  mode: UsageMode;
  now?: () => Date;
}

export interface SensorTickResult {
  status: 'ok' | 'ALERT' | 'PAUSE' | 'error';
  snapshot: UsageSnapshot | null;
  error?: string;
}

export async function runSensorOnce(opts: SensorOptions): Promise<SensorTickResult> {
  const now = opts.now ?? (() => new Date());
  const paths = statePaths(opts.stateDir);
  const read = await opts.source.read();

  if (!read.snapshot) {
    // Endpoint failure with no last-good: keep usage.json and the signal
    // files untouched, log, and let the caller sleep the FULL interval
    // (never hammer on failure -- prototype rule).
    appendLog(paths.logFile, `NA NA error ${read.error ?? 'no snapshot'}`, now());
    return { status: 'error', snapshot: null, error: read.error };
  }

  const signals = evaluateSignals(read.snapshot.five_hour_pct, opts.thresholds, opts.mode);
  const status = writeSensorResult(opts.stateDir, read.snapshot, signals);
  const staleNote = read.snapshot.stale ? ' (stale cache)' : '';
  appendLog(
    paths.logFile,
    `${read.snapshot.five_hour_pct} ${read.snapshot.resets_at} ${status}${staleNote}`,
    now(),
  );
  return { status, snapshot: read.snapshot };
}

export interface SensorLoopOptions extends SensorOptions {
  pollSeconds: number;
  /** Stops the loop (tests / graceful shutdown). */
  signal?: AbortSignal;
  /** Injectable sleeper (tests). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  onTick?: (result: SensorTickResult) => void;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolveSleep) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', done);
      clearTimeout(timer);
      resolveSleep();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Poll forever (until aborted). Errors never break the loop and never shorten the interval. */
export async function runSensorLoop(opts: SensorLoopOptions): Promise<void> {
  const sleep = opts.sleep ?? defaultSleep;
  while (!opts.signal?.aborted) {
    let result: SensorTickResult;
    try {
      result = await runSensorOnce(opts);
    } catch (err) {
      result = {
        status: 'error',
        snapshot: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    opts.onTick?.(result);
    if (opts.signal?.aborted) break;
    await sleep(opts.pollSeconds * 1000, opts.signal);
  }
}
