import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCheck, type CheckResult } from '../check.js';
import type { ChartRoomIndex } from '../index-schema.js';
import { extractInteractiveBlocks, type InteractiveBlocks } from '../interactive-blocks.js';
import { computeBacklinks, type BacklinkEntry } from './backlinks.js';

/**
 * Per-repo in-memory snapshot: the current index, its computed backlinks map, the last
 * `check.ts::runCheck` result (reused verbatim -- its `brokenLinks` is the tombstone-display data
 * source, plan §6.6), and (phase 4 plan §3.4, additive) a per-doc-id map of that doc's
 * `extractInteractiveBlocks()` result. Replaced wholesale on each rebuild (daemon startup, and
 * every chokidar-triggered rebuild) so readers never observe a half-updated state.
 */
export interface RepoState {
  repoRoot: string;
  index: ChartRoomIndex;
  backlinks: Record<string, BacklinkEntry[]>;
  check: CheckResult;
  /** Precomputed per-doc interactive-block index (phase 4 plan §3.4) -- computed once per
   * rebuild rather than re-scanned on every `GET /api/inbox` request, so the inbox route is a pure
   * in-memory aggregation with no re-parsing on its own read path. Keyed by doc *key*
   * (`id ?? path`, doc-lookup.ts convention, wave 2) so unidentified docs' ask-me/actions blocks
   * are first-class too, not just identified docs'. */
  interactiveBlocks: Record<string, InteractiveBlocks>;
}

/**
 * Rebuild a repo's full in-memory state: fresh index (via phase-1's `check.ts::runCheck`, which
 * itself calls `buildFreshIndex` + `writeIndex` -- the "always-fresh" rule, unmodified), a freshly
 * recomputed backlinks map, and (phase 4, additive) a freshly recomputed interactive-blocks index
 * across every identified doc. A doc that can't be read (e.g. a transient race with an external
 * delete) degrades to an empty `InteractiveBlocks` entry for that doc rather than failing the whole
 * rebuild.
 */
export function rebuild(repoRoot: string): RepoState {
  const check = runCheck(repoRoot);
  const backlinks = computeBacklinks(check.index);

  const interactiveBlocks: Record<string, InteractiveBlocks> = {};
  const keyedDocs: Array<{ key: string; path: string }> = [
    ...Object.entries(check.index.docs).map(([id, doc]) => ({ key: id, path: doc.path })),
    ...check.index.unidentified.map((doc) => ({ key: doc.path, path: doc.path })),
  ];
  for (const doc of keyedDocs) {
    try {
      const raw = readFileSync(join(repoRoot, doc.path), 'utf8');
      interactiveBlocks[doc.key] = extractInteractiveBlocks(raw);
    } catch {
      interactiveBlocks[doc.key] = { askMe: [], actions: [], checkboxes: [] };
    }
  }

  return { repoRoot, index: check.index, backlinks, check, interactiveBlocks };
}
