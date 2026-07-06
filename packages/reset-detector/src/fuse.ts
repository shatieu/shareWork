import type { UsageSnapshot, UsageSource } from './types.js';
import { sameWindow } from './window.js';

const SOURCE_PRIORITY: Record<UsageSource, number> = {
  oauth: 3,
  statusline: 2,
  'limit-message': 1,
};

export interface FusedUsage {
  /** The snapshot the caller should act on, or null when nothing is usable. */
  snapshot: UsageSnapshot | null;
  /**
   * True when two non-stale snapshots observed within `disagreementWindowMs`
   * of each other point at DIFFERENT usage windows -- the cross-check
   * Trio_Specs §C demands ("every community tool gets this wrong by relying
   * on one brittle signal"). Callers should log it and trust `snapshot`
   * (highest priority source wins).
   */
  disagreement: boolean;
}

/**
 * Fuse snapshots from any of the three signals. Freshest checked_at wins;
 * ties (within `tieWindowMs`) break by source authority oauth > statusline >
 * limit-message. Stale (cache-after-failure) snapshots lose to any fresh one.
 */
export function fuseSignals(
  snapshots: Array<UsageSnapshot | null | undefined>,
  opts: { tieWindowMs?: number; disagreementWindowMs?: number } = {},
): FusedUsage {
  const tieWindowMs = opts.tieWindowMs ?? 60_000;
  const disagreementWindowMs = opts.disagreementWindowMs ?? 10 * 60_000;

  const valid = snapshots.filter((s): s is UsageSnapshot => {
    return !!s && !Number.isNaN(Date.parse(s.checked_at));
  });
  if (valid.length === 0) return { snapshot: null, disagreement: false };

  const sorted = [...valid].sort((a, b) => {
    const freshA = a.stale ? 0 : 1;
    const freshB = b.stale ? 0 : 1;
    if (freshA !== freshB) return freshB - freshA;
    const ta = Date.parse(a.checked_at);
    const tb = Date.parse(b.checked_at);
    if (Math.abs(ta - tb) > tieWindowMs) return tb - ta;
    return SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source];
  });

  const winner = sorted[0];
  let disagreement = false;
  for (const other of sorted.slice(1)) {
    if (other.stale || winner.stale) continue;
    const gap = Math.abs(Date.parse(other.checked_at) - Date.parse(winner.checked_at));
    if (gap <= disagreementWindowMs && !sameWindow(other.resets_at, winner.resets_at)) {
      disagreement = true;
      break;
    }
  }
  return { snapshot: winner, disagreement };
}
