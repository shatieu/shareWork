// The round-trip serialization test suite (plan §9.1) — the single most important test suite in
// this phase, proving the hard byte-identical round-trip acceptance line: "edit-save cycle
// produces zero diff on untouched lines." Every fixture gets two assertion classes:
//   1. No-op round trip: load, "save" with no edit at all -> output === original, byte for byte.
//   2. Minimal-diff single edit: change exactly one block -> only that block's own byte range
//      differs; the prefix before it and the suffix after it are byte-identical to the original
//      (which trivially implies every *line* outside that range is untouched too — additionally
//      asserted explicitly via a line-array comparison per the plan's literal wording).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Fragment, type Node as PMNode } from '@milkdown/kit/prose/model';
import {
  buildDocNodeFromBlocks,
  canonicalizeBlock,
  createHeadlessEngine,
  extractCurrentBlocks,
  matchReorderedBlocks,
  reconstructFile,
  type RoundTripEngine,
} from '../../src/editor/roundTrip.js';
import { reassemble, segmentDocument } from '../../src/editor/segmentBlocks.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, 'fixtures');

function loadFixture(file: string): string {
  return readFileSync(join(FIXTURES_DIR, file), 'utf8');
}

/**
 * Recursively replaces the first text-node occurrence of `oldSubstr` with `newSubstr` inside a
 * *live* ProseMirror node subtree (pre-order walk), returning a brand-new node (via `.copy()`,
 * which preserves every other attr/mark exactly) or `null` if `oldSubstr` wasn't found anywhere —
 * a generic way to simulate "the user edited one word inside this block" using real ProseMirror
 * node construction (not a JSON round trip — `Node.fromJSON`'s strict attr validation turned out,
 * during implementation, to reject some of Milkdown's own internally-produced attr shapes, e.g.
 * list `spread` being set as the *string* `"false"` rather than a boolean by
 * `@milkdown/preset-commonmark`'s own `parseMarkdown` runner — a real, if harmless in normal use,
 * Milkdown quirk that only surfaces under `fromJSON`'s stricter validation, not through ordinary
 * node construction/editing. Operating on live nodes via `.copy()` sidesteps it entirely, and is
 * also a closer analogue of what a real ProseMirror transaction does.)
 */
function replaceTextInNode(node: PMNode, oldSubstr: string, newSubstr: string): PMNode | null {
  if (node.isText) {
    const text = node.text ?? '';
    if (!text.includes(oldSubstr)) return null;
    return node.type.schema.text(text.replace(oldSubstr, newSubstr), node.marks);
  }
  let replacedAny = false;
  const newChildren: PMNode[] = [];
  node.forEach((child) => {
    if (!replacedAny) {
      const replaced = replaceTextInNode(child, oldSubstr, newSubstr);
      if (replaced) {
        newChildren.push(replaced);
        replacedAny = true;
        return;
      }
    }
    newChildren.push(child);
  });
  if (!replacedAny) return null;
  return node.copy(Fragment.fromArray(newChildren));
}

/** Simulates toggling the first GFM task-list checkbox found in a live node subtree (`list_item`
 * nodes carry a boolean `checked` attr in Milkdown's GFM preset). Uses `NodeType.create` (lenient,
 * no strict attr validation) rather than a JSON round trip, same reasoning as `replaceTextInNode`. */
function toggleFirstCheckboxInNode(node: PMNode): PMNode | null {
  if (typeof node.attrs.checked === 'boolean') {
    return node.type.create({ ...node.attrs, checked: !node.attrs.checked }, node.content, node.marks);
  }
  let replacedAny = false;
  const newChildren: PMNode[] = [];
  node.forEach((child) => {
    if (!replacedAny) {
      const replaced = toggleFirstCheckboxInNode(child);
      if (replaced) {
        newChildren.push(replaced);
        replacedAny = true;
        return;
      }
    }
    newChildren.push(child);
  });
  if (!replacedAny) return null;
  return node.copy(Fragment.fromArray(newChildren));
}

interface EditSpec {
  blockIndex: number;
  /** Returns a replacement node, or `null` if the edit's target text/attr wasn't found. */
  apply: (block: PMNode) => PMNode | null;
  /** substring expected to appear in the edited block's fresh text afterwards (for a sanity check
   * that the edit actually took effect and isn't a no-op). */
  expectContains: string;
}

interface FixtureCase {
  name: string;
  file: string;
  edit: EditSpec;
}

function textEdit(oldSubstr: string, newSubstr: string): EditSpec['apply'] {
  return (b) => replaceTextInNode(b, oldSubstr, newSubstr);
}

const FIXTURES: FixtureCase[] = [
  {
    name: 'ATX headings (mixed levels)',
    file: 'atx-headings.md',
    edit: { blockIndex: 0, apply: textEdit('Top Level', 'Top Level EDITED'), expectContains: 'Top Level EDITED' },
  },
  {
    name: 'setext heading',
    file: 'setext-heading.md',
    edit: {
      blockIndex: 2,
      apply: textEdit('Subtitle Two', 'Subtitle Two EDITED'),
      expectContains: 'Subtitle Two EDITED',
    },
  },
  {
    name: 'bullet list (- marker)',
    file: 'bullet-dash.md',
    edit: { blockIndex: 1, apply: textEdit('two', 'TWO-EDITED'), expectContains: 'TWO-EDITED' },
  },
  {
    name: 'bullet list (* marker)',
    file: 'bullet-star.md',
    edit: { blockIndex: 1, apply: textEdit('two', 'TWO-EDITED'), expectContains: 'TWO-EDITED' },
  },
  {
    name: 'bullet list (+ marker)',
    file: 'bullet-plus.md',
    edit: { blockIndex: 1, apply: textEdit('two', 'TWO-EDITED'), expectContains: 'TWO-EDITED' },
  },
  {
    name: 'ordered list',
    file: 'ordered-list.md',
    edit: { blockIndex: 1, apply: textEdit('second', 'SECOND-EDITED'), expectContains: 'SECOND-EDITED' },
  },
  {
    name: 'nested list',
    file: 'nested-list.md',
    edit: { blockIndex: 1, apply: textEdit('one.a', 'one.a-EDITED'), expectContains: 'one.a-EDITED' },
  },
  {
    name: 'tight list',
    file: 'list-tight.md',
    edit: { blockIndex: 1, apply: textEdit('beta', 'BETA-EDITED'), expectContains: 'BETA-EDITED' },
  },
  {
    name: 'loose list',
    file: 'list-loose.md',
    edit: { blockIndex: 1, apply: textEdit('beta', 'BETA-EDITED'), expectContains: 'BETA-EDITED' },
  },
  {
    name: 'fenced code block (backtick, with info string)',
    file: 'code-backtick-with-lang.md',
    edit: { blockIndex: 1, apply: textEdit('const x = 1;', 'const x = 2;'), expectContains: 'const x = 2;' },
  },
  {
    name: 'fenced code block (backtick, no info string)',
    file: 'code-backtick-no-lang.md',
    edit: {
      blockIndex: 1,
      apply: textEdit('plain code, no info string', 'EDITED code, no info string'),
      expectContains: 'EDITED code, no info string',
    },
  },
  {
    name: 'fenced code block (tilde, with info string)',
    file: 'code-tilde-with-lang.md',
    edit: { blockIndex: 1, apply: textEdit('x = 1', 'x = 2'), expectContains: 'x = 2' },
  },
  {
    name: 'inline links (incl. id: format) and images',
    file: 'links-inline.md',
    edit: {
      // block 0 = '# Links' heading; block 1 = the paragraph containing the id-carrying link.
      blockIndex: 1,
      apply: textEdit('other doc', 'OTHER DOC EDITED'),
      expectContains: 'OTHER DOC EDITED',
    },
  },
  {
    name: 'reference-style links',
    file: 'links-reference.md',
    edit: {
      // block 0 = '# Reference Links' heading; block 1 = the paragraph containing the reference.
      blockIndex: 1,
      apply: textEdit('the reference', 'THE REFERENCE EDITED'),
      expectContains: 'THE REFERENCE EDITED',
    },
  },
  {
    name: 'frontmatter present',
    file: 'frontmatter-present.md',
    edit: {
      blockIndex: 1,
      apply: textEdit('Body text here.', 'Body text EDITED.'),
      expectContains: 'Body text EDITED.',
    },
  },
  {
    name: 'frontmatter absent',
    file: 'frontmatter-absent.md',
    edit: {
      blockIndex: 1,
      apply: textEdit('Body text here.', 'Body text EDITED.'),
      expectContains: 'Body text EDITED.',
    },
  },
  {
    name: 'GFM table (multiple alignment configs)',
    file: 'gfm-table.md',
    edit: { blockIndex: 1, apply: textEdit('e', 'EE'), expectContains: 'EE' },
  },
  {
    name: 'GFM task list',
    file: 'gfm-tasklist.md',
    edit: { blockIndex: 1, apply: (b) => toggleFirstCheckboxInNode(b), expectContains: '[x]' },
  },
  {
    name: 'directive blocks + raw HTML (opaque passthrough, not editable — no-op only)',
    file: 'directives.md',
    // Opaque blocks are never editable in Milkdown, so there is no "single edit" scenario for
    // them specifically — instead exercise the edit on the plain-prose paragraph sitting between
    // two directive blocks, proving the directives on either side stay byte-identical.
    edit: {
      blockIndex: 2,
      apply: textEdit('Some prose in between.', 'Some prose EDITED in between.'),
      expectContains: 'Some prose EDITED in between.',
    },
  },
  {
    name: 'combined multi-construct fixture (adjacency case)',
    file: 'combined.md',
    edit: {
      // block 1 = the intro paragraph (block 0 is the '# Combined Fixture' heading); the directive
      // immediately follows it with no blank line (the adjacency case this fixture targets).
      blockIndex: 1,
      apply: textEdit('Intro paragraph', 'Intro paragraph EDITED'),
      expectContains: 'Intro paragraph EDITED',
    },
  },
];

describe('round-trip engine — fixture-based no-op + single-edit suite (plan §9.1)', () => {
  let engine: RoundTripEngine;

  beforeEach(async () => {
    engine = await createHeadlessEngine();
  });

  afterEach(async () => {
    await engine.destroy();
  });

  for (const fixture of FIXTURES) {
    describe(fixture.name, () => {
      it('no-op round trip: load then save with no edit === original, byte for byte', () => {
        const raw = loadFixture(fixture.file);
        const before = segmentDocument(raw);
        const doc = buildDocNodeFromBlocks(engine, before.blocks);
        const current = extractCurrentBlocks(engine, doc);
        const result = reconstructFile(engine, before, current);
        expect(result).toBe(raw);
      });

      it('minimal-diff single edit: only the edited block changes, everything else byte-identical', () => {
        const raw = loadFixture(fixture.file);
        const before = segmentDocument(raw);
        const doc = buildDocNodeFromBlocks(engine, before.blocks);

        const children: PMNode[] = [];
        doc.forEach((child) => children.push(child));
        const target = children[fixture.edit.blockIndex];
        const edited = fixture.edit.apply(target);
        if (!edited) {
          throw new Error(
            `fixture "${fixture.name}": edit target not found in block ${fixture.edit.blockIndex} (got type '${target.type.name}')`,
          );
        }
        children[fixture.edit.blockIndex] = edited;
        const editedDoc = engine.schema.topNodeType.create(null, children);

        const current = extractCurrentBlocks(engine, editedDoc);
        const result = reconstructFile(engine, before, current);

        // The edit actually took effect.
        expect(current[fixture.edit.blockIndex].text).toContain(fixture.edit.expectContains);
        expect(current[fixture.edit.blockIndex].text).not.toBe(before.blocks[fixture.edit.blockIndex].text);

        // Byte-identical prefix/suffix around the edited block's own original byte range — this is
        // a *stronger* and more exact version of "every other line is untouched" (identical bytes
        // implies identical lines), computed directly from segmentBlocks' own offsets rather than
        // a guessed/hardcoded expected string.
        const editedBlock = before.blocks[fixture.edit.blockIndex];
        const prefixOffset = before.frontmatter.length + editedBlock.start;
        const suffixOffset = before.frontmatter.length + editedBlock.end;
        const prefixOriginal = raw.slice(0, prefixOffset);
        const suffixOriginal = raw.slice(suffixOffset);
        expect(result.startsWith(prefixOriginal)).toBe(true);
        expect(result.endsWith(suffixOriginal)).toBe(true);

        // Explicit line-array diff (plan §9.1's literal wording: "asserted via splitting both
        // old/new text into lines and diffing them") over the untouched prefix/suffix regions.
        expect(prefixOriginal.split('\n')).toEqual(result.slice(0, prefixOriginal.length).split('\n'));
        expect(suffixOriginal.split('\n')).toEqual(result.slice(result.length - suffixOriginal.length).split('\n'));

        // Cross-check via the deterministic reassemble() path: splicing the *actually observed*
        // fresh serialization for just the edited block into the original block list reproduces
        // the same result reconstructFile() computed independently through its own LCS-diff path.
        const expected = reassemble(
          before,
          before.blocks.map((blk, i) => (i === fixture.edit.blockIndex ? current[i].text : blk.text)),
        );
        expect(result).toBe(expected);
      });
    });
  }

  // The fixture loop above (per plan §9.1's literal ask) only ever exercises same-block-count
  // edits. `reconstructFile`'s LCS-based matching (plan §3.1 step 7) is *designed* to also handle
  // genuine block insertion/deletion, not just in-place edits -- worth its own explicit coverage
  // rather than leaving that path implemented-but-unexercised.
  describe('block insertion and deletion (plan §3.1 step 7 — beyond §9.1\'s literal same-count-edit ask)', () => {
    const raw = '# Title\n\nFirst para.\n\nSecond para.\n\nThird para.\n';

    it('inserting a brand-new block leaves every original block/gap byte-identical', () => {
      const before = segmentDocument(raw);
      const doc = buildDocNodeFromBlocks(engine, before.blocks);
      const children: PMNode[] = [];
      doc.forEach((child) => children.push(child));

      // Insert a new paragraph node between "First para." and "Second para.".
      const parsed = engine.parse('Inserted para.');
      const newNode = parsed.firstChild;
      expect(newNode).toBeTruthy();
      children.splice(2, 0, newNode!);

      const editedDoc = engine.schema.topNodeType.create(null, children);
      const current = extractCurrentBlocks(engine, editedDoc);
      const result = reconstructFile(engine, before, current);

      expect(result).toBe(
        '# Title\n\nFirst para.\n\nInserted para.\n\nSecond para.\n\nThird para.\n',
      );
      // Every original block's own text still appears, untouched, in document order.
      for (const block of before.blocks) {
        expect(result).toContain(block.text);
      }
    });

    it('deleting a block removes exactly that block, everything else byte-identical', () => {
      const before = segmentDocument(raw);
      const doc = buildDocNodeFromBlocks(engine, before.blocks);
      const children: PMNode[] = [];
      doc.forEach((child) => children.push(child));

      // Delete "Second para." (index 2: 0=heading, 1=First para., 2=Second para., 3=Third para.).
      children.splice(2, 1);

      const editedDoc = engine.schema.topNodeType.create(null, children);
      const current = extractCurrentBlocks(engine, editedDoc);
      const result = reconstructFile(engine, before, current);

      expect(result).toBe('# Title\n\nFirst para.\n\nThird para.\n');
      expect(result).not.toContain('Second para.');
    });

    it('inserting at the very start and end preserves the untouched middle byte-identical', () => {
      const before = segmentDocument(raw);
      const doc = buildDocNodeFromBlocks(engine, before.blocks);
      const children: PMNode[] = [];
      doc.forEach((child) => children.push(child));

      const leading = engine.parse('Leading new para.').firstChild!;
      const trailing = engine.parse('Trailing new para.').firstChild!;
      children.unshift(leading);
      children.push(trailing);

      const editedDoc = engine.schema.topNodeType.create(null, children);
      const current = extractCurrentBlocks(engine, editedDoc);
      const result = reconstructFile(engine, before, current);

      expect(result).toBe(
        'Leading new para.\n\n# Title\n\nFirst para.\n\nSecond para.\n\nThird para.\n\nTrailing new para.\n',
      );
    });
  });

  // Fix for the tracked follow-up in DECISIONS-NEEDED.md ("Package 3 (Chart Room phase 3): known
  // round-trip gap on block reorder"): a genuine reorder of two (or more) existing blocks, with no
  // other edit, must preserve each block's own original bytes at its new position -- not fall
  // through to Milkdown's freshly re-serialized/canonicalized text the way `lcsMatch` alone (which
  // only matches strictly-increasing index pairs, order-preserving by definition) would produce for
  // whichever one of the two swapped blocks doesn't land in the LCS.
  describe('block reorder (DECISIONS-NEEDED.md tracked follow-up, now fixed)', () => {
    it('swapping two blocks with no other edit preserves each block\'s own original bytes', () => {
      // A '+'-marker bullet list is a deliberate choice: Milkdown's commonmark serializer
      // normalizes bullet markers to '-', so this block's canonical form provably diverges from
      // its own original raw bytes -- exactly the condition the tracked bug report named as the
      // trigger ("For any block whose canonical form diverges from how it was actually
      // authored... this produces a spurious diff"). If the fix regresses, this block would come
      // back re-serialized with '-' markers instead of its own original '+' markers.
      const raw = '# Title\n\n+ one\n+ two\n+ three\n\n1. first\n2. second\n3. third\n';
      const before = segmentDocument(raw);
      const doc = buildDocNodeFromBlocks(engine, before.blocks);
      const children: PMNode[] = [];
      doc.forEach((child) => children.push(child));

      // Simulate a pure drag-reorder: swap the two list nodes (indices 1 and 2), no other edit.
      [children[1], children[2]] = [children[2], children[1]];
      const editedDoc = engine.schema.topNodeType.create(null, children);

      const current = extractCurrentBlocks(engine, editedDoc);
      const result = reconstructFile(engine, before, current);

      const plusListRaw = before.blocks[1].text; // '+ one\n+ two\n+ three'
      const orderedListRaw = before.blocks[2].text; // '1. first\n2. second\n3. third'

      // Sanity check: this fixture actually exercises the divergent-canonical-form trigger.
      const plusListCanonical = canonicalizeBlock(engine, plusListRaw);
      expect(plusListCanonical).not.toBe(plusListRaw);

      // Both blocks' own original bytes appear verbatim, in the new (swapped) order.
      expect(result).toContain(plusListRaw);
      expect(result).toContain(orderedListRaw);
      expect(result.indexOf(orderedListRaw)).toBeLessThan(result.indexOf(plusListRaw));

      // The re-serialized/canonicalized form of the '+' list must NOT appear anywhere -- proof
      // this isn't silently falling back to fresh Milkdown text for the reordered block.
      expect(result).not.toContain(plusListCanonical);

      // The only actual change versus the original is the ordering itself: every original block's
      // own text is still present in full, and nothing outside the two swapped blocks changed.
      expect(result.startsWith('# Title')).toBe(true);
      expect(result.endsWith('\n')).toBe(true);
    });

    it('reorder composes correctly with a genuine insert (reorder two blocks AND add a new one)', () => {
      const raw = '# Title\n\n+ one\n+ two\n+ three\n\n1. first\n2. second\n3. third\n';
      const before = segmentDocument(raw);
      const doc = buildDocNodeFromBlocks(engine, before.blocks);
      const children: PMNode[] = [];
      doc.forEach((child) => children.push(child));

      // Swap the two lists AND insert a brand-new paragraph between them.
      const newNode = engine.parse('Inserted para.').firstChild!;
      const reordered = [children[0], children[2], newNode, children[1]];
      const editedDoc = engine.schema.topNodeType.create(null, reordered);

      const current = extractCurrentBlocks(engine, editedDoc);
      const result = reconstructFile(engine, before, current);

      const plusListRaw = before.blocks[1].text;
      const orderedListRaw = before.blocks[2].text;
      const plusListCanonical = canonicalizeBlock(engine, plusListRaw);

      // The two reordered blocks keep their own original bytes...
      expect(result).toContain(plusListRaw);
      expect(result).toContain(orderedListRaw);
      expect(result).not.toContain(plusListCanonical);
      // ...the new block gets fresh content...
      expect(result).toContain('Inserted para.');
      // ...and the overall order is: heading, ordered list, inserted para, '+' list.
      const iOrdered = result.indexOf(orderedListRaw);
      const iInserted = result.indexOf('Inserted para.');
      const iPlus = result.indexOf(plusListRaw);
      expect(iOrdered).toBeLessThan(iInserted);
      expect(iInserted).toBeLessThan(iPlus);
    });

    it('duplicate-content blocks: no-op round trip does not confuse or corrupt identical instances', () => {
      // Two genuinely byte-identical paragraphs -- proves the matching logic doesn't get confused
      // about "which original maps to which current instance" even when canonical keys collide,
      // in the baseline (no reorder) case.
      const raw = '# Title\n\nSame paragraph text.\n\nSame paragraph text.\n\nTail paragraph.\n';
      const before = segmentDocument(raw);
      const doc = buildDocNodeFromBlocks(engine, before.blocks);
      const current = extractCurrentBlocks(engine, doc);
      const result = reconstructFile(engine, before, current);

      // No-op round trip: byte-identical to the original, exactly like every other fixture.
      expect(result).toBe(raw);
    });

    it('duplicate-content blocks combined with a reorder: positional tie-break stays deterministic and lossless', () => {
      // Two identical paragraphs plus a third, distinct block (an ordered list). The distinct
      // block is dragged to the front, ahead of both duplicates. Documents the chosen, safe
      // behavior for the inherently-ambiguous "which duplicate instance is 'the' one that moved"
      // question (see `matchReorderedBlocks`'s doc comment): candidates are paired by position,
      // which is always safe here because any two blocks eligible to be paired with the same slot
      // are, by construction, canonically identical -- so it is impossible for this tie-breaking
      // to splice in a *different*, canonically-distinct original block's bytes by mistake.
      const raw = '# Title\n\nSame paragraph text.\n\nSame paragraph text.\n\n1. first\n2. second\n3. third\n';
      const before = segmentDocument(raw);
      const doc = buildDocNodeFromBlocks(engine, before.blocks);
      const children: PMNode[] = [];
      doc.forEach((child) => children.push(child));

      // Move the ordered list (index 3) to the front of the two duplicate paragraphs (indices 1, 2).
      const [orderedNode] = children.splice(3, 1);
      children.splice(1, 0, orderedNode);
      const editedDoc = engine.schema.topNodeType.create(null, children);

      const current = extractCurrentBlocks(engine, editedDoc);
      const result = reconstructFile(engine, before, current);

      const orderedListRaw = before.blocks[3].text;
      // The moved block keeps its own original bytes, now ahead of both duplicate paragraphs.
      expect(result).toContain(orderedListRaw);
      expect(result.indexOf(orderedListRaw)).toBeLessThan(result.indexOf('Same paragraph text.'));
      // Both duplicate instances are still present exactly twice each -- nothing lost, nothing
      // duplicated an extra time.
      const occurrences = result.split('Same paragraph text.').length - 1;
      expect(occurrences).toBe(2);
    });
  });

  // Fix for the second tracked follow-up in DECISIONS-NEEDED.md's block-reorder entry (the
  // "smaller, pre-existing whitespace-only defect"): the denser positional gap-alignment pass in
  // `reconstructFile` used to *overwrite* a reorder pairing's implied original index with a purely
  // positional one whenever the reordered block landed inside an equal-length inter-anchor region.
  // The reordered block then masqueraded as positionally continuous with its new neighbor and
  // inherited an original gap that no longer applies (whitespace only -- block content was never
  // affected). The fill is now reorder-aware: it never overwrites an index already claimed by a
  // `matchReorderedBlocks` pairing.
  describe('whitespace-gap quirk on reorder (DECISIONS-NEEDED.md whitespace-only defect, now fixed)', () => {
    // The exact DECISIONS-NEEDED repro shape: heading -> block A (with an unusual 3-blank-line gap
    // after the heading) -> unrelated blocks -> block B; then A and B are swapped. The unrelated
    // blocks are required: they become the LCS anchors, so the swapped blocks each sit alone in an
    // equal-length (1:1) inter-anchor region -- exactly the configuration where the positional
    // fill used to clobber the reorder pairing.
    const THREE_BLANK_GAP = '\n\n\n\n\n'; // block terminator + 3 blank lines + next block's start
    const rawReorder =
      '# Title' + THREE_BLANK_GAP + 'Block A text.\n\nUnrelated one.\n\nUnrelated two.\n\nBlock B text.\n';

    it('reordering does not leak the original heading->A 3-blank-line gap onto the new heading->B adjacency', () => {
      const before = segmentDocument(rawReorder);
      const doc = buildDocNodeFromBlocks(engine, before.blocks);
      const children: PMNode[] = [];
      doc.forEach((child) => children.push(child));

      // Pure drag-reorder: swap A (index 1) and B (index 4), no other edit.
      [children[1], children[4]] = [children[4], children[1]];
      const editedDoc = engine.schema.topNodeType.create(null, children);

      const current = extractCurrentBlocks(engine, editedDoc);
      const result = reconstructFile(engine, before, current);

      // The new heading->B adjacency is a genuinely new one the user created by reordering, so it
      // gets the documented DEFAULT_GAP -- NOT the original heading->A gap's 3 blank lines. The
      // pre-fix code produced '# Title' + THREE_BLANK_GAP + 'Block B text.' here.
      expect(result).not.toContain('# Title' + THREE_BLANK_GAP + 'Block B text.');
      expect(result).toBe(
        '# Title\n\nBlock B text.\n\nUnrelated one.\n\nUnrelated two.\n\nBlock A text.\n',
      );
    });

    it('no-reorder unusual spacing still preserves original gaps (no over-skip regression)', () => {
      // Guard against over-correcting: with NO reorder in play, the positional fill must still do
      // its original job -- edited-in-place blocks (which never appear in the LCS) must keep their
      // original unusual inter-block spacing rather than collapsing to DEFAULT_GAP.
      const raw = '# Title' + THREE_BLANK_GAP + 'Alpha para.' + THREE_BLANK_GAP + 'Beta para.\n';
      const before = segmentDocument(raw);

      // Baseline: the no-op round trip stays byte-identical, unusual gaps and all.
      const noopDoc = buildDocNodeFromBlocks(engine, before.blocks);
      expect(reconstructFile(engine, before, extractCurrentBlocks(engine, noopDoc))).toBe(raw);

      // Edit BOTH paragraphs in place so neither lands in the LCS -- the equal-length-region
      // positional fill is then the only thing standing between the original gaps and DEFAULT_GAP.
      const doc = buildDocNodeFromBlocks(engine, before.blocks);
      const children: PMNode[] = [];
      doc.forEach((child) => children.push(child));
      children[1] = replaceTextInNode(children[1], 'Alpha', 'Alpha-EDITED')!;
      children[2] = replaceTextInNode(children[2], 'Beta', 'Beta-EDITED')!;
      expect(children[1]).toBeTruthy();
      expect(children[2]).toBeTruthy();
      const editedDoc = engine.schema.topNodeType.create(null, children);

      const current = extractCurrentBlocks(engine, editedDoc);
      const result = reconstructFile(engine, before, current);

      expect(result).toBe(
        '# Title' + THREE_BLANK_GAP + current[1].text + THREE_BLANK_GAP + current[2].text + '\n',
      );
      expect(current[1].text).toContain('Alpha-EDITED');
      expect(current[2].text).toContain('Beta-EDITED');
    });
  });
});

describe('matchReorderedBlocks — second-pass reorder matching, pure-function unit tests', () => {
  it('pairs a genuine one-for-one swap that lcsMatch alone could not fully match', () => {
    // originalKeys/currentKeys mimic a swap of blocks at indices 1 and 2 ('A','B' <-> 'B','A').
    const originalKeys = ['H', 'A', 'B'];
    const currentKeys = ['H', 'B', 'A'];
    // lcsMatch itself can only match one of 'A'/'B' (order-preserving) -- simulate whichever one
    // it picks; either is a valid LCS result for this input.
    const lcsMatches: Array<[number, number]> = [[0, 0], [1, 2]]; // H, and A matched at its old slot
    const reorderPairs = matchReorderedBlocks(originalKeys, currentKeys, lcsMatches);
    expect(reorderPairs).toEqual([[2, 1]]); // original 'B' (idx2) <-> current 'B' (idx1)
  });

  it('does not invent a match for a genuinely new block with no corresponding original', () => {
    const originalKeys = ['H', 'A'];
    const currentKeys = ['H', 'A', 'NEW'];
    const lcsMatches: Array<[number, number]> = [[0, 0], [1, 1]];
    expect(matchReorderedBlocks(originalKeys, currentKeys, lcsMatches)).toEqual([]);
  });

  it('does not invent a match for a genuinely deleted block with no corresponding current', () => {
    const originalKeys = ['H', 'A', 'GONE'];
    const currentKeys = ['H', 'A'];
    const lcsMatches: Array<[number, number]> = [[0, 0], [1, 1]];
    expect(matchReorderedBlocks(originalKeys, currentKeys, lcsMatches)).toEqual([]);
  });

  it('breaks ties among canonically-identical duplicates by strict positional order', () => {
    // Two unmatched originals share key 'DUP', two unmatched currents share key 'DUP' -- the
    // first unmatched original should pair with the first unmatched current, in index order.
    const originalKeys = ['DUP', 'DUP'];
    const currentKeys = ['DUP', 'DUP'];
    const lcsMatches: Array<[number, number]> = []; // force everything through the reorder pass
    expect(matchReorderedBlocks(originalKeys, currentKeys, lcsMatches)).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it('leaves surplus duplicate originals/currents unmatched when counts differ', () => {
    // Three originals share a key, only one current does -- exactly one pairing, the other two
    // originals are left unmatched (correctly treated as deleted, not guessed at).
    const originalKeys = ['DUP', 'DUP', 'DUP'];
    const currentKeys = ['DUP'];
    expect(matchReorderedBlocks(originalKeys, currentKeys, [])).toEqual([[0, 0]]);

    // The reverse: one original, three currents sharing a key -- one pairing, the other two
    // currents are left unmatched (correctly treated as new content, not guessed at).
    expect(matchReorderedBlocks(['DUP'], ['DUP', 'DUP', 'DUP'], [])).toEqual([[0, 0]]);
  });
});
