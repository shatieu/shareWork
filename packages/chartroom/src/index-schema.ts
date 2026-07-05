import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const INDEX_SCHEMA_VERSION = 1 as const;

/** Repo-relative path (from repo root) to the gitignored index file. */
export const INDEX_RELATIVE_PATH = '.docs/index.json';

export interface OutboundLink {
  /** the id this link points to, if it carries `title="id:<id>"` */
  targetId?: string;
  /** the literal href/path as written in the file right now */
  hrefAsWritten: string;
  /** true if hrefAsWritten no longer matches the current resolved path for targetId */
  stale: boolean;
}

export interface DocEntry {
  /** repo-root-relative, forward-slash-normalized path */
  path: string;
  title: string;
  headings: string[];
  outbound: OutboundLink[];
}

export interface AssetEntry {
  /** repo-root-relative, forward-slash-normalized path */
  path: string;
}

export interface DeletedEntry {
  lastPath: string;
  deletedAt: string;
}

export interface ChartRoomIndex {
  version: typeof INDEX_SCHEMA_VERSION;
  generatedAt: string;
  docs: Record<string, DocEntry>;
  /**
   * Docs discovered on disk that carry no `id:` frontmatter at all. Per plan §4: such a doc "can't
   * be looked up by id" so it is deliberately *not* a key in `docs` (which is keyed by id), but it
   * must remain discoverable by path/filename (resolver steps 2-3) and still be scanned for broken
   * outbound links by `check`. Additive beyond the plan's literal schema shape, needed to satisfy
   * that same note without contradicting "docs is keyed by id".
   */
  unidentified: DocEntry[];
  assets: Record<string, AssetEntry>;
  deleted: Record<string, DeletedEntry>;
}

export function emptyIndex(): ChartRoomIndex {
  return {
    version: INDEX_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    docs: {},
    unidentified: [],
    assets: {},
    deleted: {},
  };
}

/**
 * Read `.docs/index.json` from disk. Returns undefined if it doesn't exist, or if it exists but
 * doesn't match the current schema version or is unparsable (a stale/corrupt index must be
 * detected and ignored, never misread as a broken current-shape index — plan §4 notes).
 */
export function readIndex(repoRoot: string): ChartRoomIndex | undefined {
  const path = join(repoRoot, INDEX_RELATIVE_PATH);
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ChartRoomIndex>;
    if (parsed.version !== INDEX_SCHEMA_VERSION) return undefined;
    if (typeof parsed.docs !== 'object' || typeof parsed.deleted !== 'object' || typeof parsed.assets !== 'object') {
      return undefined;
    }
    // `unidentified` is an additive field (see interface comment) — tolerate its absence in an
    // index.json written before it existed rather than treating the whole file as stale-shape.
    if (!Array.isArray(parsed.unidentified)) {
      parsed.unidentified = [];
    }
    return parsed as ChartRoomIndex;
  } catch {
    return undefined;
  }
}

/** Write the index atomically: write to a temp file, then rename over the target, so a crash
 * mid-write never leaves a corrupt/partial index on disk. */
export function writeIndex(repoRoot: string, index: ChartRoomIndex): void {
  const path = join(repoRoot, INDEX_RELATIVE_PATH);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(index, null, 2) + '\n', 'utf8');
  renameSync(tmpPath, path);
}
