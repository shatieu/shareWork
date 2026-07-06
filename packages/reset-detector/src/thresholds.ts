import type { SignalState, Thresholds, UsageMode } from './types.js';

/**
 * Pure threshold evaluation. ALERT and PAUSE are levels, not edges: the
 * caller's signal files self-clear as soon as the pct drops back under the
 * threshold (proven live 2026-07-05 -- the prototype cleared PAUSE on its own
 * after a window reset).
 *
 * In spend mode PAUSE is suppressed entirely (work continues into paid extra
 * usage); ALERT still fires so the session knows it crossed into warn land.
 */
export function evaluateSignals(
  fiveHourPct: number,
  thresholds: Thresholds,
  mode: UsageMode = 'pause',
): SignalState {
  const alert = fiveHourPct >= thresholds.alertAt;
  const pause = mode === 'pause' && fiveHourPct >= thresholds.pauseAt;
  return { alert, pause };
}
