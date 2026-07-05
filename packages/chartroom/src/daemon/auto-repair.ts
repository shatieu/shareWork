import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeImageFixes, computeLinkFixes } from '../fix-links.js';
import type { RepoState } from './repo-state.js';

/**
 * One human-readable repair performed by `runAutoRepair` -- everything an `ActivityEvent` of kind
 * 'repair' needs *except* the repo identity (repoId/repoName/ts), which only the caller (the
 * serve-time rebuild pipeline) knows. Kept as a draft rather than a full `ActivityEvent` so this
 * module stays a pure repoRoot+state function with no dependency on the activity log.
 */
export interface RepairEventDraft {
  /** e.g. `link repaired via id:key-rotation` or `image link repaired`. */
  summary: string;
  /** e.g. `ops/rotate.md — href docs/rotate.md → ../ops/rotate.md`. */
  detail: string;
  /** key (`id ?? path`) of the doc whose file was edited. */
  docKey: string;
  /** repo-relative path of the file that was edited. */
  path: string;
}

export interface AutoRepairResult {
  events: RepairEventDraft[];
  changedFiles: number;
}

/**
 * The daemon-side automatic link-repair pass (wave-2 feature 2): for every doc in the index --
 * identified *and* unidentified -- run phase 1's `computeLinkFixes` and phase 3's
 * `computeImageFixes` (both reused verbatim, never reimplemented) and write the file back when
 * anything changed, emitting one draft event per individual href change.
 *
 * Idempotence is inherited from the fix engines themselves: they splice each href to its
 * *expected* value, so a second pass over the just-written text finds every href already correct
 * and changes nothing. That's what lets the watcher-triggered rebuild caused by our own writes
 * settle naturally (rebuild -> repair -> 0 changes -> done) instead of ping-ponging. The
 * serve-time pipeline still carries a belt-and-suspenders loop guard on top (rebuild-pipeline.ts).
 */
export function runAutoRepair(repoRoot: string, state: RepoState): AutoRepairResult {
  const index = state.index;
  const events: RepairEventDraft[] = [];
  let changedFiles = 0;

  const docs: Array<{ key: string; path: string }> = [
    ...Object.entries(index.docs).map(([id, doc]) => ({ key: id, path: doc.path })),
    ...index.unidentified.map((doc) => ({ key: doc.path, path: doc.path })),
  ];

  for (const doc of docs) {
    const abs = join(repoRoot, doc.path);
    if (!existsSync(abs)) continue; // transient race with an external delete -- skip, next rebuild catches up

    let raw: string;
    try {
      raw = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }

    const linkResult = computeLinkFixes(doc.path, raw, index);
    // Image repair runs against the link pass's own output text (same ordering as the fix-links
    // command), so its splice offsets are computed against exactly what will be written.
    const imageResult = computeImageFixes(repoRoot, doc.path, linkResult.newText, index);

    if (!linkResult.changed && !imageResult.changed) continue;

    writeFileSync(abs, imageResult.newText, 'utf8');
    changedFiles += 1;

    for (const change of linkResult.changes) {
      events.push({
        summary: `link repaired via id:${change.targetId}`,
        detail: `${doc.path} — href ${change.oldHref} → ${change.newHref}`,
        docKey: doc.key,
        path: doc.path,
      });
    }
    for (const change of imageResult.changes) {
      events.push({
        summary: 'image link repaired',
        detail: `${doc.path} — href ${change.oldHref} → ${change.newHref}`,
        docKey: doc.key,
        path: doc.path,
      });
    }
  }

  return { events, changedFiles };
}
