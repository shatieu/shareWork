import { buildFreshIndex, type DuplicateIdIssue } from './indexer.js';
import { writeIndex, type ChartRoomIndex } from './index-schema.js';
import { runStalenessCheck, type StalenessResult, type StalenessSeams } from './staleness.js';

export interface BrokenLinkIssue {
  /** repo-relative path of the doc containing the outbound link. */
  path: string;
  targetId: string;
  hrefAsWritten: string;
  matchType: 'tombstone' | 'not-found';
  /** only present when matchType === 'tombstone'. */
  lastPath?: string;
}

export interface CheckOptions {
  /** injectable "now" (unix epoch seconds) for the staleness pass — tests; defaults to wall clock. */
  nowEpoch?: number;
  /** injectable git seam for the staleness pass — tests. */
  stalenessSeams?: StalenessSeams;
}

export interface CheckResult {
  index: ChartRoomIndex;
  brokenLinks: BrokenLinkIssue[];
  missingIds: string[];
  duplicateIds: DuplicateIdIssue[];
  /**
   * true when nothing was found wrong (plan §8.5 exit code 0). Deliberately keeps its exact v1
   * meaning — link/id INTEGRITY only, never staleness. `runCheck` also runs on every daemon
   * rebuild and any future hook path; a TTL expiry must never start blocking commits or flipping
   * unrelated consumers. Staleness verdicts live in the `stalenessClean` sibling.
   */
  clean: boolean;
  /** v1.1 staleness pass (spec §6): ttl/sources freshness + orphan detection. Additive. */
  staleness: StalenessResult;
  /**
   * true when no doc is ttl-expired or stale against its `sources:`. Orphans are deliberately
   * excluded — they are a warn-only heuristic (the CLI gates them behind `--fail-orphans`).
   */
  stalenessClean: boolean;
}

/**
 * Read-only integrity check (plan §8.5): broken/tombstoned outbound links, docs missing an `id:`,
 * and duplicate ids. Always rebuilds the index fresh in memory first (plan §6.3 "always-fresh"
 * rule) and, as a side effect, writes the refreshed copy back to `.docs/index.json` -- same
 * pattern as `resolve`/`fix-links`/the hook. Never mutates doc files.
 */
export function runCheck(repoRoot: string, options: CheckOptions = {}): CheckResult {
  const { index, duplicateIds, missingIdPaths } = buildFreshIndex(repoRoot);
  writeIndex(repoRoot, index);

  const brokenLinks: BrokenLinkIssue[] = [];
  const allDocEntries = [...Object.values(index.docs), ...index.unidentified];
  for (const doc of allDocEntries) {
    for (const link of doc.outbound) {
      if (!link.targetId) continue;
      if (index.docs[link.targetId]) continue; // resolves fine, not broken

      const deleted = index.deleted[link.targetId];
      if (deleted) {
        brokenLinks.push({
          path: doc.path,
          targetId: link.targetId,
          hrefAsWritten: link.hrefAsWritten,
          matchType: 'tombstone',
          lastPath: deleted.lastPath,
        });
      } else {
        brokenLinks.push({
          path: doc.path,
          targetId: link.targetId,
          hrefAsWritten: link.hrefAsWritten,
          matchType: 'not-found',
        });
      }
    }
  }

  const clean = brokenLinks.length === 0 && missingIdPaths.length === 0 && duplicateIds.length === 0;

  const nowEpoch = options.nowEpoch ?? Math.floor(Date.now() / 1000);
  const staleness = runStalenessCheck(repoRoot, index, nowEpoch, options.stalenessSeams);
  const stalenessClean = staleness.ttlExpired.length === 0 && staleness.staleAgainstSources.length === 0;

  return { index, brokenLinks, missingIds: missingIdPaths, duplicateIds, clean, staleness, stalenessClean };
}
