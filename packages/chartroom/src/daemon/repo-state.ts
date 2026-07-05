import { runCheck, type CheckResult } from '../check.js';
import type { ChartRoomIndex } from '../index-schema.js';
import { computeBacklinks, type BacklinkEntry } from './backlinks.js';

/**
 * Per-repo in-memory snapshot: the current index, its computed backlinks map, and the last
 * `check.ts::runCheck` result (reused verbatim -- its `brokenLinks` is the tombstone-display data
 * source, plan §6.6). Replaced wholesale on each rebuild (daemon startup, and every
 * chokidar-triggered rebuild) so readers never observe a half-updated state.
 */
export interface RepoState {
  repoRoot: string;
  index: ChartRoomIndex;
  backlinks: Record<string, BacklinkEntry[]>;
  check: CheckResult;
}

/**
 * Rebuild a repo's full in-memory state: fresh index (via phase-1's `check.ts::runCheck`, which
 * itself calls `buildFreshIndex` + `writeIndex` -- the "always-fresh" rule, unmodified) plus a
 * freshly recomputed backlinks map.
 */
export function rebuild(repoRoot: string): RepoState {
  const check = runCheck(repoRoot);
  const backlinks = computeBacklinks(check.index);
  return { repoRoot, index: check.index, backlinks, check };
}
