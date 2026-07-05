import matter from 'gray-matter';

/**
 * Matches a leading YAML frontmatter block: `---\n ... \n---\n` (optionally followed by more
 * content). Captures nothing separately — callers only need the match length to know where the
 * body starts.
 */
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/;

export interface FrontmatterInfo {
  hasFrontmatter: boolean;
  data: Record<string, unknown>;
  /** byte offset (UTF-16 code unit index) into the raw string where the body begins. */
  bodyStart: number;
}

/**
 * Read-only frontmatter extraction. Byte offsets are computed independently of gray-matter's own
 * content slicing (which does not guarantee exact offsets into the *original* raw string) — see
 * plan §1.1. gray-matter is only trusted here for parsing the YAML into a data object.
 */
export function readFrontmatter(raw: string): FrontmatterInfo {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) {
    return { hasFrontmatter: false, data: {}, bodyStart: 0 };
  }
  let data: Record<string, unknown> = {};
  try {
    ({ data } = matter(raw));
  } catch {
    // Malformed YAML: treat as no usable frontmatter data, but the block still exists so we
    // don't try to double-inject a second frontmatter block on top of it.
    data = {};
  }
  return { hasFrontmatter: true, data: data ?? {}, bodyStart: m[0].length };
}

/**
 * Surgically inject `id: <id>` into a document's frontmatter, mutating only the exact bytes
 * needed and leaving everything else byte-identical.
 * - No frontmatter at all: prepend a new `---\nid: <id>\n---\n\n` block.
 * - Frontmatter exists but has no `id`: insert `id: <id>\n` as the first line inside the block.
 * - Frontmatter already has an `id`: no-op, returns `raw` unchanged (idempotent).
 * Never calls matter.stringify and never touches the body.
 */
export function injectId(raw: string, id: string): string {
  const fm = readFrontmatter(raw);

  if (!fm.hasFrontmatter) {
    return `---\nid: ${id}\n---\n\n${raw}`;
  }

  if (fm.data.id !== undefined && fm.data.id !== null && String(fm.data.id).length > 0) {
    return raw;
  }

  const openMatch = /^---\r?\n/.exec(raw);
  if (!openMatch) {
    // Should be unreachable given fm.hasFrontmatter, but fail safe rather than corrupt the file.
    return raw;
  }
  const insertAt = openMatch[0].length;
  return raw.slice(0, insertAt) + `id: ${id}\n` + raw.slice(insertAt);
}
