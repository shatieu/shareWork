/**
 * One observation of the account's usage windows.
 *
 * The field names deliberately match the signal-file shape the Lookout
 * prototype proved in the field (suite-design/lookout/lookout.ps1) so a
 * guard written against the prototype's usage.json keeps working.
 */
export interface UsageSnapshot {
  /** Five-hour window utilization, 0-100. */
  five_hour_pct: number;
  /** Seven-day window utilization, 0-100 (NaN-free; 0 when unknown). */
  seven_day_pct: number;
  /** ISO timestamp at which the five-hour window resets. */
  resets_at: string;
  /** ISO timestamp of the observation itself. */
  checked_at: string;
  /** Which signal produced this snapshot. */
  source: UsageSource;
  /**
   * True when this snapshot was served from cache after a fetch failure --
   * the value is the last known good, not a fresh reading.
   */
  stale?: boolean;
}

export type UsageSource = 'oauth' | 'statusline' | 'limit-message';

export interface Thresholds {
  /** five_hour_pct at/above which ALERT is raised. */
  alertAt: number;
  /** five_hour_pct at/above which PAUSE is raised (pause mode only). */
  pauseAt: number;
}

/**
 * pause: free-window economy -- stop new work at pauseAt, wait for the reset.
 * spend: paid extra-usage economy -- ALERT still fires, PAUSE never does.
 * (Binary switch proven by the prototype's -AllowExtraUsage; budget-capped
 * middle mode is explicitly deferred by Trio_Specs §C.)
 */
export type UsageMode = 'pause' | 'spend';

export interface SignalState {
  alert: boolean;
  pause: boolean;
}

export const DEFAULT_THRESHOLDS: Thresholds = { alertAt: 80, pauseAt: 93 };
