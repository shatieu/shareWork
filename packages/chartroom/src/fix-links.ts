import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { extractImages, extractLinks } from './markdown.js';
import { computeExpectedHref, normalizeHref } from './link-paths.js';
import { normalizeSlashes } from './repo.js';
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

export interface ImageFixChange {
  oldHref: string;
  newHref: string;
}

export interface ImageFixResult {
  changed: boolean;
  newText: string;
  changes: ImageFixChange[];
}

const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function applySplices(raw: string, splices: Array<{ start: number; end: number; text: string }>): string {
  const sorted = [...splices].sort((a, b) => b.start - a.start);
  let newText = raw;
  for (const s of sorted) {
    newText = newText.slice(0, s.start) + s.text + newText.slice(s.end);
  }
  return newText;
}

function ownDocId(relPath: string, index: ChartRoomIndex): string | undefined {
  for (const [id, doc] of Object.entries(index.docs)) {
    if (doc.path === relPath) return id;
  }
  return undefined;
}

/**
 * Repair image hrefs gone stale because the *hosting doc* moved (phase 3 plan §6.3 — the one
 * behavior change to existing phase-1 logic in Chart Room's editor phase, approved in
 * `suite-design/overnight/DECISIONS-NEEDED.md`, "Package 3" section). Image links (`![alt](href)`)
 * carry no `id:` title attribute the way doc-to-doc links do, so `computeLinkFixes` above never
 * touches them — this is a narrow, additive extension closing that gap via two mechanisms, tried
 * in order for each image node:
 *
 *  1. **Content-hash match** (mirrors the doc-link precedent above): if the href, resolved from
 *     the doc's *current* directory, still points at a real file, hash it and look the hash up in
 *     `index.assets` (`indexer.ts::collectAssets`, unmodified). If that hash is registered under a
 *     *different* repo-relative path than the resolved one, the asset itself moved/was renamed —
 *     splice in the corrected relative href.
 *  2. **Own-doc-id asset-folder fallback**: if the href does *not* resolve at all from the doc's
 *     current location (the literal "doc moved, asset didn't" acceptance scenario, plan §9.2),
 *     mechanism 1 can't help — an unresolvable image is never discovered/hashed by `collectAssets`
 *     in the first place, so `index.assets` has no entry to look up (a real bootstrapping gap in a
 *     hash-only approach, worth flagging honestly rather than silently papered over). Since this
 *     project's own upload endpoint (plan §6.1) always writes pasted images to
 *     `assets/<hosting-doc-id>/<timestamp>.png` — a repo-root-relative folder keyed by the doc's
 *     own `id`, which does not change on a `git mv` of the doc — a broken image href whose
 *     basename matches a file actually present under the current doc's own `assets/<id>/` folder
 *     is repaired directly from that naming convention, with no hash lookup needed.
 *
 * `repoRoot` is required (unlike `computeLinkFixes`) since both mechanisms need real filesystem
 * access (hashing a resolved file; checking existence in the id-keyed asset folder).
 */
export function computeImageFixes(
  repoRoot: string,
  relPath: string,
  raw: string,
  index: ChartRoomIndex,
): ImageFixResult {
  const images = extractImages(raw);
  const changes: ImageFixChange[] = [];
  const splices: Array<{ start: number; end: number; text: string }> = [];
  const docId = ownDocId(relPath, index);
  const docDir = dirname(join(repoRoot, relPath));

  for (const image of images) {
    if (URL_SCHEME_RE.test(image.href)) continue; // http(s):, data:, mailto:, ... pass through untouched

    let expectedHref: string | undefined;
    const resolvedAbs = join(docDir, image.href);

    if (existsSync(resolvedAbs)) {
      const bytes = readFileSync(resolvedAbs);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const registered = index.assets[hash];
      const resolvedRelPath = normalizeSlashes(relative(repoRoot, resolvedAbs));
      if (registered && registered.path !== resolvedRelPath) {
        expectedHref = computeExpectedHref(relPath, registered.path);
      }
    } else if (docId) {
      const basename = posix.basename(normalizeSlashes(image.href));
      const candidateRelPath = normalizeSlashes(join('assets', docId, basename));
      if (existsSync(join(repoRoot, candidateRelPath))) {
        expectedHref = computeExpectedHref(relPath, candidateRelPath);
      }
    }

    if (!expectedHref || normalizeHref(image.href) === expectedHref) continue;

    let spliceRange = image.urlPosition;
    if (!spliceRange) {
      // Fallback, same reasoning as computeLinkFixes above: locate the literal href text within
      // the whole node's own source slice and splice only that substring.
      const whole = raw.slice(image.position.start, image.position.end);
      const idx = whole.indexOf(image.href);
      if (idx === -1) continue; // can't safely locate the href text; skip rather than risk corruption
      spliceRange = { start: image.position.start + idx, end: image.position.start + idx + image.href.length };
    }

    splices.push({ start: spliceRange.start, end: spliceRange.end, text: expectedHref });
    changes.push({ oldHref: image.href, newHref: expectedHref });
  }

  if (splices.length === 0) {
    return { changed: false, newText: raw, changes: [] };
  }

  return { changed: true, newText: applySplices(raw, splices), changes };
}
