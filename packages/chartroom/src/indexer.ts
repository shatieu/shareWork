import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { readFrontmatter } from './frontmatter.js';
import { extractFirstH1, extractHeadings, extractImages, extractLinks } from './markdown.js';
import { discoverDocFiles, normalizeSlashes } from './repo.js';
import { computeExpectedHref, normalizeHref } from './link-paths.js';
import { emptyIndex, readIndex, type ChartRoomIndex, type DocEntry, type DocStaleness } from './index-schema.js';

export interface DuplicateIdIssue {
  id: string;
  /** every repo-relative path that claims this id, in discovery order (first path is the one that
   * "won" the docs[id] slot; later ones are excluded from docs, see BuildIndexResult doc). */
  paths: string[];
}

export interface BuildIndexResult {
  index: ChartRoomIndex;
  /** ids claimed by 2+ files — a scan-time error per plan §8.5, must be flagged loudly by `check`,
   * never silently resolved first-seen-wins. */
  duplicateIds: DuplicateIdIssue[];
  /** repo-relative paths of docs with no `id:` frontmatter at all (distinct from duplicateIds). */
  missingIdPaths: string[];
}

export interface BuildIndexOptions {
  /**
   * Repo-relative path -> raw content overrides. Used by the pre-commit hook (plan §9.2b) to scan
   * a file using its *staged* blob content while every other file is read from the working tree.
   */
  contentOverrides?: Map<string, string>;
}

interface ParsedDoc {
  relPath: string;
  id?: string;
  title: string;
  headings: string[];
  links: ReturnType<typeof extractLinks>;
  images: ReturnType<typeof extractImages>;
  staleness?: DocStaleness;
}

/**
 * Lift the staleness opt-ins (`ttl_days:`, `sources:`) from parsed frontmatter (v1.1, spec §6).
 * Captured for identified AND unidentified docs. Malformed values are ignored silently
 * (consistent with the indexer's existing frontmatter tolerance): `ttl_days` must be a positive
 * finite number; `sources` entries must be non-empty strings (non-string/empty entries are
 * dropped, and an array with no valid entry is treated as absent).
 */
function liftStaleness(data: Record<string, unknown>): DocStaleness | undefined {
  const out: DocStaleness = {};
  const ttl = data.ttl_days;
  if (typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0) {
    out.ttlDays = ttl;
  }
  const sources = data.sources;
  if (Array.isArray(sources)) {
    const valid = sources.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
    if (valid.length > 0) {
      out.sources = valid;
    }
  }
  return out.ttlDays !== undefined || out.sources !== undefined ? out : undefined;
}

function readDocRaw(repoRoot: string, relPath: string, overrides?: Map<string, string>): string {
  if (overrides?.has(relPath)) return overrides.get(relPath) as string;
  return readFileSync(join(repoRoot, relPath), 'utf8');
}

/**
 * Frontmatter `title:` -> else first `# ` heading in the body -> else filename stem (plan §5 step 3).
 * Exported so `commands/init.ts` and the pre-commit hook (`hook.ts`) can compute a missing doc's id
 * base string using the exact same rule the indexer itself uses, without duplicating the logic.
 */
export function titleFor(data: Record<string, unknown>, raw: string, relPath: string): string {
  if (typeof data.title === 'string' && data.title.trim().length > 0) return data.title.trim();
  const h1 = extractFirstH1(raw);
  if (h1) return h1;
  const base = posix.basename(normalizeSlashes(relPath));
  return base.replace(/\.md$/i, '');
}

function parseDoc(repoRoot: string, relPath: string, overrides?: Map<string, string>): ParsedDoc {
  const raw = readDocRaw(repoRoot, relPath, overrides);
  const fm = readFrontmatter(raw);
  const rawId = fm.data.id;
  const id = typeof rawId === 'string' && rawId.trim().length > 0 ? rawId.trim() : undefined;
  return {
    relPath,
    id,
    title: titleFor(fm.data, raw, relPath),
    headings: extractHeadings(raw),
    links: extractLinks(raw),
    images: extractImages(raw),
    staleness: liftStaleness(fm.data),
  };
}

function mergeDiscoveredPaths(repoRoot: string, overrides?: Map<string, string>): string[] {
  const discovered = new Set(discoverDocFiles(repoRoot));
  if (overrides) {
    for (const p of overrides.keys()) discovered.add(p);
  }
  return [...discovered].sort();
}

function collectAssets(repoRoot: string, docs: ParsedDoc[]): Record<string, { path: string }> {
  const assets: Record<string, { path: string }> = {};
  for (const doc of docs) {
    for (const image of doc.images) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(image.href)) continue; // http(s):, mailto:, data:, etc. — pass through
      const docDir = dirname(join(repoRoot, doc.relPath));
      const absPath = join(docDir, image.href);
      if (!existsSync(absPath)) continue; // broken image link — surfaced by `check`, not here
      const bytes = readFileSync(absPath);
      const hash = createHash('sha256').update(bytes).digest('hex');
      assets[hash] = { path: normalizeSlashes(relative(repoRoot, absPath)) };
    }
  }
  return assets;
}

/**
 * Full-repo scan building a fresh index in memory (plan §5 steps 1-5), diffed against the previous
 * on-disk index (if any) to compute tombstones/move-detection/resurrection (plan §7). Never
 * mutates doc files — pure read (or content-override) + compute. Callers decide whether/when to
 * persist the result via `writeIndex` (plan §6.3 "always-fresh" rule: resolve/check/fix-links/the
 * hook all rebuild in memory first, and still write the refreshed copy back to disk as a side effect).
 */
export function buildFreshIndex(repoRoot: string, options: BuildIndexOptions = {}): BuildIndexResult {
  const overrides = options.contentOverrides;
  const relPaths = mergeDiscoveredPaths(repoRoot, overrides);
  const parsedDocs = relPaths.map((p) => parseDoc(repoRoot, p, overrides));

  // Pass 1: id -> path, first-seen wins; collect duplicates and missing-id paths.
  const idToPath = new Map<string, string>();
  const duplicatePaths = new Map<string, string[]>();
  const missingIdPaths: string[] = [];
  const excludedFromDocs = new Set<string>(); // relPaths that lost the docs[id] slot to a duplicate

  for (const doc of parsedDocs) {
    if (!doc.id) {
      missingIdPaths.push(doc.relPath);
      continue;
    }
    if (!idToPath.has(doc.id)) {
      idToPath.set(doc.id, doc.relPath);
      duplicatePaths.set(doc.id, [doc.relPath]);
    } else {
      duplicatePaths.get(doc.id)!.push(doc.relPath);
      excludedFromDocs.add(doc.relPath);
    }
  }

  const duplicateIds: DuplicateIdIssue[] = [...duplicatePaths.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([id, paths]) => ({ id, paths }));

  // Pass 2: build outbound links now that idToPath (the "fresh" id->path map) is complete.
  function toDocEntry(doc: ParsedDoc): DocEntry {
    const outbound = doc.links.map((link) => {
      const idMatch = link.titleAttr ? /^id:(.+)$/.exec(link.titleAttr.trim()) : null;
      const targetId = idMatch ? idMatch[1].trim() : undefined;
      let stale = false;
      if (targetId) {
        const targetPath = idToPath.get(targetId);
        if (targetPath) {
          stale = normalizeHref(link.href) !== computeExpectedHref(doc.relPath, targetPath);
        }
      }
      return { targetId, hrefAsWritten: link.href, stale };
    });
    const entry: DocEntry = { path: doc.relPath, title: doc.title, headings: doc.headings, outbound };
    if (doc.staleness) {
      entry.staleness = doc.staleness;
    }
    return entry;
  }

  const docs: Record<string, DocEntry> = {};
  const unidentified: DocEntry[] = [];
  for (const doc of parsedDocs) {
    if (doc.id && !excludedFromDocs.has(doc.relPath)) {
      docs[doc.id] = toDocEntry(doc);
    } else {
      unidentified.push(toDocEntry(doc));
    }
  }

  // Diff against the previous on-disk index to compute tombstones/moves/resurrection (plan §7).
  const previous = readIndex(repoRoot);
  const deleted: ChartRoomIndex['deleted'] = {};
  if (previous) {
    const nowIso = new Date().toISOString();
    for (const [id, entry] of Object.entries(previous.deleted)) {
      if (!(id in docs)) {
        deleted[id] = entry; // still gone — preserve the original tombstone, not a "re-deleted" timestamp
      }
      // else: resurrected (id reappeared in the fresh scan) — drop the tombstone, it's back in `docs`.
    }
    for (const [id, entry] of Object.entries(previous.docs)) {
      if (!(id in docs)) {
        deleted[id] = { lastPath: entry.path, deletedAt: nowIso };
      }
    }
  }
  // First-ever build (no previous index): every doc is new, no tombstones are invented.

  const assets = collectAssets(repoRoot, parsedDocs);

  const index: ChartRoomIndex = {
    ...emptyIndex(),
    docs,
    unidentified,
    assets,
    deleted,
  };

  return { index, duplicateIds, missingIdPaths };
}
