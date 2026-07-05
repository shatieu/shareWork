// Pure, Milkdown-independent segmentation of a doc's raw text into an ordered list of top-level
// blocks with byte offsets (plan §3.1 steps 1-3). This is the single most correctness-critical
// piece of the round-trip engine (plan §10 risk #1) — it decides, for every construct, whether a
// block is "prose" (safe to hand to Milkdown for WYSIWYG editing) or "opaque" (a directive/HTML/
// unrecognized construct that must be passed through byte-for-byte, never touched).
//
// Reuses phase-1's own `AstNode` offset-bearing node shape (`chartroom/markdown`, plan §3.4
// decision (b), approved in DECISIONS-NEEDED.md "Package 3") for the parsed-tree contract, but
// builds its own unified/remark pipeline here (remark-parse + remark-gfm + remark-directive) since
// phase-1's own pipeline has no `remark-directive` support (§1.2/§3.4). Frontmatter is stripped by
// a standalone byte-offset regex *before* this module's own pipeline ever sees the body — the
// frontmatter block's bytes are therefore never handed to any parser here at all, matching
// phase-1's `frontmatter.ts::readFrontmatter` and phase-2's `DocView.tsx::stripFrontmatter`
// discipline exactly (plan §4).

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import type { AstNode } from 'chartroom/markdown';

// Matches a leading YAML frontmatter block: `---\n ... \n---\n` (optionally followed by more
// content). Deliberately the exact same shape as phase-1's `frontmatter.ts::FRONTMATTER_RE` and
// phase-2's `DocView.tsx::FRONTMATTER_RE` — kept as a third, independent, byte-for-byte-identical
// copy rather than an import (matches the phase-2 precedent of not cross-package-importing
// non-offset-critical logic; the one piece of phase-1 logic this package *does* import is the
// `AstNode` type contract itself, per the approved §3.4 decision).
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/;

/** Body-level node types Milkdown's `preset-commonmark` + `preset-gfm` natively understand and can
 * safely round-trip as ordinary editable content (plan §3.1 step 3). A strict allowlist, not a
 * denylist: any top-level node type *not* in this set — `html`, `containerDirective`,
 * `leafDirective`, `textDirective`, `definition` (reference-link definitions), and any future/
 * unusual construct this list doesn't anticipate — defaults to "opaque" rather than risking
 * Milkdown mangling something it doesn't understand. This is a deliberate, safety-first design
 * choice (plan §10 risk #4): it means reference-link definitions, for example, are not editable
 * via the WYSIWYG view in phase 3, a documented, accepted UX gap, not a correctness bug.
 */
const PROSE_TYPES = new Set([
  'heading',
  'paragraph',
  'list',
  'blockquote',
  'code',
  'table',
  'thematicBreak',
]);

export type BlockKind = 'prose' | 'opaque';

export interface SegmentedBlock {
  kind: BlockKind;
  /** mdast node type, e.g. 'heading', 'containerDirective', 'html'. */
  type: string;
  /** byte offset range into `bodyText` (not the original full raw file — frontmatter already stripped). */
  start: number;
  end: number;
  /** `bodyText.slice(start, end)` — the block's own original raw text, verbatim. */
  text: string;
}

export interface SegmentedDocument {
  /** original frontmatter block's raw text, or '' if the doc has none. Never parsed, never touched. */
  frontmatter: string;
  /** raw text of the doc body (original raw text with the frontmatter block's bytes removed). */
  bodyText: string;
  /** ordered top-level blocks, in document order. */
  blocks: SegmentedBlock[];
  /**
   * `gaps[i]` is the raw whitespace/blank-line text between `blocks[i-1].end` and `blocks[i].start`
   * (`gaps[0]` is the leading gap before the first block, if any); `gaps[blocks.length]` is the
   * trailing text after the last block's end (through the end of `bodyText`). Always
   * `gaps.length === blocks.length + 1`. Preserving these verbatim (plan §3.1 step 8) is what
   * keeps a repo's own blank-line/EOF-newline conventions untouched rather than re-derived from
   * Milkdown's own list-tightness/paragraph-spacing defaults.
   */
  gaps: string[];
}

function classify(type: string): BlockKind {
  return PROSE_TYPES.has(type) ? 'prose' : 'opaque';
}

/** Splits raw file text into its frontmatter block (verbatim, unparsed) and the remaining body text. */
export function splitFrontmatter(raw: string): { frontmatter: string; bodyText: string } {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return { frontmatter: '', bodyText: raw };
  return { frontmatter: match[0], bodyText: raw.slice(match[0].length) };
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkDirective);

/**
 * Parse `bodyText` (already frontmatter-stripped) and segment it into ordered top-level blocks +
 * gaps (plan §3.1 steps 1-3, 8). Pure function, no Milkdown/ProseMirror dependency at all — fully
 * unit-testable in isolation, which is deliberate given this is the highest-risk logic in the
 * entire phase (plan §10 risk #1).
 */
export function segmentDocument(raw: string): SegmentedDocument {
  const { frontmatter, bodyText } = splitFrontmatter(raw);
  const tree = processor.parse(bodyText) as unknown as AstNode;
  const children = tree.children ?? [];

  const blocks: SegmentedBlock[] = [];
  for (const child of children) {
    if (!child.position) continue; // defensive: every real top-level mdast node carries a position
    const start = child.position.start.offset;
    const end = child.position.end.offset;
    blocks.push({ kind: classify(child.type), type: child.type, start, end, text: bodyText.slice(start, end) });
  }

  const gaps: string[] = [];
  let cursor = 0;
  for (const block of blocks) {
    gaps.push(bodyText.slice(cursor, block.start));
    cursor = block.end;
  }
  gaps.push(bodyText.slice(cursor));

  return { frontmatter, bodyText, blocks, gaps };
}

/**
 * Rejoins a `SegmentedDocument`'s pieces back into the exact original raw text — used both as a
 * sanity check (round-tripping `segmentDocument` itself must be lossless) and as the basis for
 * `roundTrip.ts`'s save-time reconstruction (which substitutes edited blocks' text before joining).
 */
export function reassemble(doc: Pick<SegmentedDocument, 'frontmatter' | 'gaps'>, blockTexts: string[]): string {
  let out = doc.frontmatter;
  for (let i = 0; i < blockTexts.length; i += 1) {
    out += doc.gaps[i] + blockTexts[i];
  }
  out += doc.gaps[blockTexts.length];
  return out;
}
