// The block-level diff-and-splice round-trip engine (plan §3, the crux of this whole phase).
//
// Design (spike-confirmed against the real installed Milkdown 7.21.2 API — see the phase-3 report
// for the full spike writeup): rather than feeding a whole raw-markdown string (with directive/HTML
// syntax mixed in) through Milkdown's own markdown-string parser — which would collide with
// `@milkdown/preset-commonmark`'s *own* built-in `html` node schema (registered as an *inline*
// atom, not a block one; see `opaqueNode.ts`'s file header for the concrete conflict this caused
// during the spike) — the live editor's document is assembled *manually*, one top-level
// `segmentBlocks.ts` block at a time (plan §3.1 step 4, taken literally): prose blocks are parsed
// via Milkdown's ordinary `parserCtx` on that block's own isolated text; opaque blocks are
// constructed directly as `chartroomOpaqueBlock` node instances, bypassing Milkdown's markdown
// parser entirely for anything it doesn't natively understand.
//
// On save, the live doc's top-level children are walked back out (`extractCurrentBlocks`), each
// compared against the original block it best corresponds to via an LCS/diff match (plan §3.1 step
// 7), and the final file text is reassembled by splicing *original raw bytes* back for every
// untouched block/gap and using freshly-serialized text only for blocks that actually changed
// (plan §3.1 steps 5-8).

import {
  Editor,
  rootCtx,
  defaultValueCtx,
  parserCtx,
  schemaCtx,
  serializerCtx,
  type DefaultValue,
} from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import type { Ctx } from '@milkdown/kit/ctx';
import type { Node as PMNode, Schema } from '@milkdown/kit/prose/model';
import { opaqueNode, OPAQUE_NODE_NAME } from './opaqueNode.js';
import type { SegmentedBlock, SegmentedDocument } from './segmentBlocks.js';

export interface RoundTripEngine {
  parse: (text: string) => PMNode;
  serialize: (node: PMNode) => string;
  schema: Schema;
  /** Tears down the underlying (possibly detached, possibly live) Milkdown `Editor` instance. */
  destroy: () => Promise<void>;
}

/**
 * Builds a Milkdown `Editor` instance and exposes its parse/serialize/schema primitives. `root` may
 * be a detached DOM node (never appended to `document.body`) for headless use — `roundTrip.ts`'s own
 * canonicalization/diffing needs no visible UI at all, only the parser/serializer pair (plan §9.4:
 * "a headless/non-DOM exercise of roundTrip.ts's pure functions"). `DocEditor.tsx` reuses this same
 * function with a *real*, mounted root for the actual interactive editor.
 */
export async function createEngine(root: HTMLElement): Promise<RoundTripEngine> {
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, '');
    })
    .use(commonmark)
    .use(gfm)
    .use(opaqueNode)
    .create();

  const ctx = editor.ctx;
  return {
    parse: ctx.get(parserCtx),
    serialize: ctx.get(serializerCtx),
    schema: ctx.get(schemaCtx),
    destroy: async () => {
      await editor.destroy();
    },
  };
}

/** Convenience wrapper for headless (non-interactive) use — always mounts to a detached `<div>`. */
export async function createHeadlessEngine(): Promise<RoundTripEngine> {
  return createEngine(document.createElement('div'));
}

/**
 * Builds (but does not `.create()`) the same commonmark+gfm+opaqueNode Editor plugin stack, for
 * `@milkdown/react`'s `useEditor` hook — its `getEditor` factory must return an *uncreated* Editor
 * synchronously (the hook itself calls `.create()` internally, per `@milkdown/react`'s own
 * `useGetEditor` implementation, confirmed by reading its shipped `.js` during the API spike, not
 * just its `.d.ts`). `DocEditor.tsx` uses this for the real, interactive, DOM-mounted editor.
 */
export function buildUncreatedEditor(root: HTMLElement, defaultValue: DefaultValue): Editor {
  return Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, defaultValue);
    })
    .use(commonmark)
    .use(gfm)
    .use(opaqueNode);
}

/**
 * Wraps an already-created Milkdown `Editor`'s own `ctx` as a `RoundTripEngine` — used at save time
 * so `extractCurrentBlocks`/`reconstructFile` operate against the *live* editor's own schema
 * instance (required: a live doc's nodes are bound to the schema that created them) rather than a
 * separate headless engine.
 */
export function wrapEditorCtx(ctx: Ctx): RoundTripEngine {
  return {
    parse: ctx.get(parserCtx),
    serialize: ctx.get(serializerCtx),
    schema: ctx.get(schemaCtx),
    destroy: async () => {
      /* lifecycle owned by whoever created the real Editor this ctx belongs to */
    },
  };
}

/**
 * Milkdown's `SerializerState`/`remark-stringify` output always ends with exactly one trailing
 * newline per top-level node (confirmed empirically during the implementation spike — every node
 * type produced this consistently) — but `segmentBlocks.ts`'s own original block text never
 * includes its trailing line terminator (remark's own node `position.end.offset` convention
 * excludes it; that terminator lives in the *gap* text instead, see `segmentBlocks.ts`). Stripping
 * it here keeps every block's text — whether original raw or freshly serialized — on the same
 * "excludes its own trailing terminator, the gap supplies it" convention, so `reconstructFile`'s
 * gap-joining logic never doubles up a line break around an edited block.
 */
function stripOneTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

/**
 * Parses `text` in isolation and serializes the result straight back — Milkdown's real
 * commonmark/gfm parse+serialize pipeline, exercised on exactly one block's own original text
 * (plan §3.1 step 6's `canonical(original)` / `canonical(current)` computation). This is the
 * function that concretely proves (or disproves) the plan's central risk: whether
 * `remark-stringify`'s canonicalizing behavior is idempotent enough that an *untouched* block's
 * `canonical(original)` reliably equals its live `canonical(current)` counterpart.
 */
export function canonicalizeBlock(engine: RoundTripEngine, text: string): string {
  return stripOneTrailingNewline(engine.serialize(engine.parse(text)));
}

/**
 * Builds the full ProseMirror document Milkdown will mount for editing, by concatenating one node
 * (or node-group) per segmented block (plan §3.1 step 4) — prose blocks via Milkdown's own parser,
 * opaque blocks as directly-constructed atom nodes carrying their original raw text verbatim.
 */
export function buildDocNodeFromBlocks(engine: RoundTripEngine, blocks: SegmentedBlock[]): PMNode {
  const nodes: PMNode[] = [];
  for (const block of blocks) {
    if (block.kind === 'opaque') {
      const opaqueType = engine.schema.nodes[OPAQUE_NODE_NAME];
      nodes.push(opaqueType.create({ raw: block.text }));
    } else {
      const parsed = engine.parse(block.text);
      parsed.forEach((child) => nodes.push(child));
    }
  }
  if (nodes.length === 0) {
    const filled = engine.schema.topNodeType.createAndFill();
    if (!filled) throw new Error('chartroom-ui: could not construct an empty Milkdown document');
    return filled;
  }
  return engine.schema.topNodeType.create(null, nodes);
}

export interface CurrentBlock {
  kind: 'prose' | 'opaque';
  /** ProseMirror node type name (informational only — e.g. 'heading', 'chartroomOpaqueBlock'). */
  type: string;
  /** For opaque blocks: the node's own `raw` attr, verbatim. For prose blocks: a fresh
   * serialization of just this node (already in Milkdown's own canonical form). */
  text: string;
}

/**
 * Walks a live (or freshly-built) document's top-level children back into an ordered
 * `CurrentBlock[]` — the save-time counterpart to `segmentDocument`'s original block list (plan
 * §3.1 step 5). Opaque nodes are read directly from their `raw` attr (never re-serialized, per
 * plan §3.1 step 6); prose nodes are serialized individually by wrapping each one alone in its own
 * temporary top-level document, never via a whole-document join.
 */
export function extractCurrentBlocks(engine: RoundTripEngine, doc: PMNode): CurrentBlock[] {
  const blocks: CurrentBlock[] = [];
  doc.forEach((child) => {
    if (child.type.name === OPAQUE_NODE_NAME) {
      blocks.push({ kind: 'opaque', type: child.type.name, text: String(child.attrs.raw ?? '') });
    } else {
      const wrapper = engine.schema.topNodeType.create(null, child);
      blocks.push({ kind: 'prose', type: child.type.name, text: stripOneTrailingNewline(engine.serialize(wrapper)) });
    }
  });
  return blocks;
}

/**
 * Longest-common-subsequence match between two key sequences (plan §3.1 step 7's "Myers-diff-style
 * LCS matching" — a small, dependency-free, standard O(n·m) DP implementation, matching the
 * project's established "hand-roll a small well-tested primitive over adding a dependency for one
 * narrow use" precedent, plan §11 item 1). Returns index pairs `[i, j]` with `keysA[i] === keysB[j]`,
 * strictly increasing in both `i` and `j`.
 */
export function lcsMatch(keysA: string[], keysB: string[]): Array<[number, number]> {
  const n = keysA.length;
  const m = keysB.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = keysA[i] === keysB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const matches: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (keysA[i] === keysB[j]) {
      matches.push([i, j]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return matches;
}

/** Separator used between two blocks in the reconstructed output when there is no original gap to
 * preserve (a genuinely new block, or two blocks newly adjacent because something between them was
 * deleted/reordered) — the standard single-blank-line CommonMark block separator. */
const DEFAULT_GAP = '\n\n';

/**
 * Reassembles the final saved file text (plan §3.1 steps 5-8): matches `currentBlocks` against
 * `original.blocks` via `lcsMatch` (using each prose block's canonicalized text, and each opaque
 * block's exact raw text, as the comparison key), then walks the *current* block order splicing in
 * original raw bytes for every matched (= unchanged) block and gap, and fresh serialized text only
 * for blocks with no match (= new or edited content). Frontmatter is always the original's,
 * untouched, prepended unconditionally (plan §4).
 */
export function reconstructFile(
  engine: RoundTripEngine,
  original: SegmentedDocument,
  currentBlocks: CurrentBlock[],
): string {
  const originalKeys = original.blocks.map((b) =>
    b.kind === 'opaque' ? b.text : canonicalizeBlock(engine, b.text),
  );
  const currentKeys = currentBlocks.map((b) => b.text);

  const matches = lcsMatch(originalKeys, currentKeys);
  const matchedForCurrent = new Map<number, number>();
  for (const [origIdx, curIdx] of matches) matchedForCurrent.set(curIdx, origIdx);

  // A *second*, denser alignment used only to decide which gap to preserve (never to decide block
  // *content*): LCS anchors alone lose positional continuity across an edited-in-place block (e.g.
  // "paragraph unchanged, NEXT paragraph edited, NEXT block unchanged" — the edited paragraph
  // never appears in `matches` at all, since its key differs from every original key, which made
  // the block *after* it look "non-adjacent" to anything and fall back to a default blank-line gap
  // even when the original had none — a real bug caught by this suite's own adjacency fixture).
  // Between any two consecutive LCS anchors (or the start/end of the document), if the run of
  // current blocks and the run of original blocks in that gap are the *same length*, they're
  // assumed to correspond 1:1 positionally — covering the overwhelmingly common "N blocks modified
  // in place, nothing inserted/deleted/reordered" case exactly, while still falling back to the
  // safe default gap for genuine insertions/deletions/reorders where lengths don't line up.
  const impliedOrigIdxForCurrent = new Map<number, number>(matchedForCurrent);
  {
    let prevOrigEnd = 0;
    let prevCurEnd = 0;
    const anchors: Array<[number, number]> = [...matches, [original.blocks.length, currentBlocks.length]];
    for (const [oi, ci] of anchors) {
      const origRegionLen = oi - prevOrigEnd;
      const curRegionLen = ci - prevCurEnd;
      if (origRegionLen === curRegionLen && origRegionLen > 0) {
        for (let k = 0; k < curRegionLen; k += 1) {
          impliedOrigIdxForCurrent.set(prevCurEnd + k, prevOrigEnd + k);
        }
      }
      prevOrigEnd = oi + 1;
      prevCurEnd = ci + 1;
    }
  }

  const blockTexts: string[] = [];
  const gaps: string[] = [];

  for (let ci = 0; ci < currentBlocks.length; ci += 1) {
    const origIdx = matchedForCurrent.get(ci);
    const impliedIdx = impliedOrigIdxForCurrent.get(ci);
    const prevImpliedIdx = ci > 0 ? impliedOrigIdxForCurrent.get(ci - 1) : undefined;

    if (ci === 0) {
      gaps.push(original.gaps[0]);
    } else if (impliedIdx !== undefined && prevImpliedIdx !== undefined && impliedIdx === prevImpliedIdx + 1) {
      // Both this block and the previous one map to still-adjacent original positions (whether
      // unchanged or merely edited-in-place) — preserve the exact original spacing between them.
      gaps.push(original.gaps[impliedIdx]);
    } else {
      gaps.push(DEFAULT_GAP);
    }

    if (origIdx !== undefined) {
      blockTexts.push(original.blocks[origIdx].text);
    } else {
      blockTexts.push(currentBlocks[ci].text);
    }
  }

  gaps.push(original.gaps[original.blocks.length]); // trailing gap, always the original's

  let out = original.frontmatter;
  for (let i = 0; i < blockTexts.length; i += 1) {
    out += gaps[i] + blockTexts[i];
  }
  out += gaps[blockTexts.length];
  return out;
}
