// The opaque-passthrough Milkdown node (plan §3.2): a single custom ProseMirror node type,
// `chartroomOpaqueBlock`, used for every top-level block `segmentBlocks.ts` classifies as
// "opaque" (directive blocks, raw HTML, reference-link definitions, anything unrecognized). Its
// only content is its *original raw source text*, stored as a node attribute — `atom: true` means
// ProseMirror treats it as a single indivisible unit with no directly editable inline content, so
// Milkdown/the user literally cannot mutate its text from within the WYSIWYG view. This is what
// makes phase-4-reserved directive syntax (`:::llm`/`:::human`/`:::ask-me`) and raw HTML provably
// impossible to corrupt in phase 3 — by construction, not by convention (plan §3.1 step 4).
//
// Spike finding worth recording (plan §1.7's honesty flag, borne out in practice): Milkdown's own
// `@milkdown/preset-commonmark` already registers a node schema for mdast type `'html'` — but as an
// *inline* atom (`group: 'inline'`, for a `<span>` embedded mid-paragraph), not a block-level one.
// Feeding a whole raw-HTML-block-containing document through Milkdown's own markdown-string parser
// and hoping a competing `chartroomOpaqueBlock` schema would correctly claim *block-level* `'html'`
// nodes instead turned out to be a real, confirmed API conflict, not a hypothetical — there is no
// clean way to make one mdast type name ('html') resolve to two different ProseMirror node groups
// based on tree depth via a bare `(node) => boolean` matcher.
//
// Resolution: `roundTrip.ts`/`DocEditor.tsx` never feed opaque-block text through Milkdown's own
// markdown-string parser at all. Per plan §3.1 step 4's literal design ("build the Milkdown
// document by concatenating..."), the live editor's document is assembled *manually*, one top-level
// block at a time: prose blocks are parsed via `ctx.get(parserCtx)` (Milkdown's ordinary
// commonmark+gfm parser, on that block's own isolated text only); opaque blocks are constructed
// directly as `chartroomOpaqueBlock` node instances via `schema.nodes.chartroomOpaqueBlock.create({
// raw: block.text })` — Milkdown's own markdown-parsing pipeline never sees directive/HTML syntax
// at all, so the competing built-in `html` schema is simply never in the picture. This is a cleaner,
// more robust mechanism than trying to out-prioritize a competing built-in matcher, and it is why
// this node's own `parseMarkdown` hook below is an inert stub rather than a real matcher.

import { $node } from '@milkdown/kit/utils';

/**
 * The opaque passthrough node. Declared with a syntactically-valid but practically-unreachable
 * `parseMarkdown` (see file header) — it exists only because `NodeSchema` requires the field, not
 * because anything in this codebase ever calls Milkdown's whole-document markdown parser on text
 * containing an opaque construct. `toMarkdown` *is* implemented correctly (as an mdast `html` node,
 * whose value remark-stringify emits verbatim/unescaped) so that serializing a live document
 * containing an untouched opaque node never throws — but per plan §3.2, `roundTrip.ts` never
 * actually trusts this runner's output for an opaque block's own content either: it always reads
 * `node.attrs.raw` directly and splices the original bytes back unconditionally.
 */
export const opaqueNode = $node('chartroomOpaqueBlock', () => ({
  group: 'block',
  atom: true,
  isolating: true,
  attrs: { raw: { default: '' } },
  parseDOM: [{ tag: 'div[data-chartroom-opaque]' }],
  toDOM: (node) => {
    const raw = String(node.attrs.raw ?? '');
    const pre = document.createElement('pre');
    pre.textContent = raw;
    return [
      'div',
      { 'data-chartroom-opaque': 'true', class: 'chartroom-opaque-block', contentEditable: 'false' },
      ['div', { class: 'chartroom-opaque-block__label' }, 'not editable in this view'],
      pre,
    ];
  },
  parseMarkdown: {
    match: () => false,
    runner: () => {
      /* unreachable — see file header */
    },
  },
  toMarkdown: {
    match: (node) => node.type.name === 'chartroomOpaqueBlock',
    runner: (state, node) => {
      state.addNode('html', undefined, String(node.attrs.raw ?? ''));
    },
  },
}));

export const OPAQUE_NODE_NAME = 'chartroomOpaqueBlock';
