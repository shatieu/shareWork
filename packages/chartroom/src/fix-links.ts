import { extractLinks } from './markdown.js';
import { computeExpectedHref, normalizeHref } from './link-paths.js';
import type { ChartRoomIndex } from './index-schema.js';

export interface LinkFixChange {
  targetId: string;
  oldHref: string;
  newHref: string;
}

export interface LinkFixResult {
  changed: boolean;
  newText: string;
  changes: LinkFixChange[];
}

/**
 * Repair stale outbound links in a single file's raw text (plan §6.2), shared by the `fix-links`
 * command and the pre-commit hook. Only touches the href portion of a link node whose `title="id:
 * <id>"` resolves to a current path that differs from what's written — never re-renders the whole
 * file, never touches frontmatter, never touches link text or the title attribute itself.
 *
 * `relPath` is the repo-root-relative path of the file this raw text belongs to (used to compute
 * the correct *relative* replacement href against each target's current index path).
 */
export function computeLinkFixes(relPath: string, raw: string, index: ChartRoomIndex): LinkFixResult {
  const links = extractLinks(raw);
  const changes: LinkFixChange[] = [];
  const splices: Array<{ start: number; end: number; text: string }> = [];

  for (const link of links) {
    const idMatch = link.titleAttr ? /^id:(.+)$/.exec(link.titleAttr.trim()) : null;
    if (!idMatch) continue;
    const targetId = idMatch[1].trim();
    const targetDoc = index.docs[targetId];
    if (!targetDoc) continue; // dangling id (tombstone/not-found) — not this pass's job to invent a fix

    const expectedHref = computeExpectedHref(relPath, targetDoc.path);
    if (normalizeHref(link.href) === expectedHref) continue; // already correct

    let spliceRange = link.urlPosition;
    if (!spliceRange) {
      // Fallback (plan §10 risk #3): locate the literal href text within the whole node's own
      // source slice and splice only that substring — still never touches unrelated bytes.
      const whole = raw.slice(link.position.start, link.position.end);
      const idx = whole.indexOf(link.href);
      if (idx === -1) continue; // can't safely locate the href text; skip rather than risk corruption
      spliceRange = { start: link.position.start + idx, end: link.position.start + idx + link.href.length };
    }

    splices.push({ start: spliceRange.start, end: spliceRange.end, text: expectedHref });
    changes.push({ targetId, oldHref: link.href, newHref: expectedHref });
  }

  if (splices.length === 0) {
    return { changed: false, newText: raw, changes: [] };
  }

  // Apply from the end of the string backwards so earlier offsets are never invalidated by a
  // preceding splice changing the string length.
  splices.sort((a, b) => b.start - a.start);
  let newText = raw;
  for (const s of splices) {
    newText = newText.slice(0, s.start) + s.text + newText.slice(s.end);
  }
  // changes were collected in document order; splices were applied in reverse, but `changes`
  // itself was never reordered, so callers still see document-order reporting.
  return { changed: true, newText, changes };
}
