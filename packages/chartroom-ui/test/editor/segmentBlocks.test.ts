import { describe, expect, it } from 'vitest';
import { reassemble, segmentDocument, splitFrontmatter } from '../../src/editor/segmentBlocks.js';

describe('splitFrontmatter', () => {
  it('extracts a leading frontmatter block verbatim', () => {
    const raw = '---\nid: a\ntitle: "A"\n---\n\n# A\n';
    const { frontmatter, bodyText } = splitFrontmatter(raw);
    // The regex consumes through the first newline after the closing `---` only; the blank-line
    // separator before the body is left as part of bodyText (and ends up in segmentDocument's
    // leading gap) — same convention as phase-1's frontmatter.ts/phase-2's DocView.tsx.
    expect(frontmatter).toBe('---\nid: a\ntitle: "A"\n---\n');
    expect(bodyText).toBe('\n# A\n');
    expect(frontmatter + bodyText).toBe(raw);
  });

  it('returns an empty frontmatter string when the doc has none', () => {
    const raw = '# A\n\nSome text.\n';
    const { frontmatter, bodyText } = splitFrontmatter(raw);
    expect(frontmatter).toBe('');
    expect(bodyText).toBe(raw);
  });
});

describe('segmentDocument — block boundaries + classification', () => {
  // Note: remark's own node `position.end.offset` convention consistently excludes each block's
  // final line-terminator (verified empirically across every node type below) — that trailing
  // newline instead shows up in the *gap* text before the next block (or the trailing gap after
  // the last block). This doesn't affect correctness (reassemble() still reproduces the original
  // byte-for-byte, asserted at the bottom of this file) — it's simply where the boundary falls.

  it('classifies an ATX heading as prose', () => {
    const doc = segmentDocument('## Hello\n');
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]).toMatchObject({ kind: 'prose', type: 'heading', text: '## Hello' });
    expect(doc.gaps[1]).toBe('\n');
  });

  it('classifies a setext heading as one atomic prose block spanning both lines', () => {
    const doc = segmentDocument('Hello\n=====\n');
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]).toMatchObject({ kind: 'prose', type: 'heading', text: 'Hello\n=====' });
  });

  it('classifies bullet lists (each of -, *, +) as prose', () => {
    for (const marker of ['-', '*', '+']) {
      const doc = segmentDocument(`${marker} one\n${marker} two\n`);
      expect(doc.blocks).toHaveLength(1);
      expect(doc.blocks[0].kind).toBe('prose');
      expect(doc.blocks[0].type).toBe('list');
    }
  });

  it('classifies ordered lists as prose', () => {
    const doc = segmentDocument('1. one\n2. two\n');
    expect(doc.blocks[0]).toMatchObject({ kind: 'prose', type: 'list' });
  });

  it('classifies fenced code blocks (backtick and tilde) as prose', () => {
    const backtick = segmentDocument('```js\nconst x = 1;\n```\n');
    expect(backtick.blocks[0]).toMatchObject({ kind: 'prose', type: 'code' });

    const tilde = segmentDocument('~~~js\nconst x = 1;\n~~~\n');
    expect(tilde.blocks[0]).toMatchObject({ kind: 'prose', type: 'code' });
  });

  it('classifies GFM tables as prose', () => {
    const doc = segmentDocument('| a | b |\n| - | - |\n| 1 | 2 |\n');
    expect(doc.blocks[0]).toMatchObject({ kind: 'prose', type: 'table' });
  });

  it('classifies a container directive block (:::llm) as opaque', () => {
    const doc = segmentDocument(':::llm\nSome instructions.\n:::\n');
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]).toMatchObject({ kind: 'opaque', type: 'containerDirective' });
    expect(doc.blocks[0].text).toBe(':::llm\nSome instructions.\n:::');
  });

  it('classifies raw HTML blocks as opaque', () => {
    const doc = segmentDocument('<div class="note">\nRaw HTML\n</div>\n');
    expect(doc.blocks[0]).toMatchObject({ kind: 'opaque', type: 'html' });
  });

  it('classifies a reference-link definition as opaque (defensive allowlist, plan §10 risk #4)', () => {
    const doc = segmentDocument('[ref]: https://example.com "Example"\n');
    expect(doc.blocks[0]).toMatchObject({ kind: 'opaque', type: 'definition' });
  });

  it('excludes frontmatter from segmentation entirely', () => {
    const raw = '---\nid: a\n---\n\n# A\n';
    const doc = segmentDocument(raw);
    expect(doc.frontmatter).toBe('---\nid: a\n---\n');
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks.some((b) => b.text.includes('id: a'))).toBe(false);
  });

  it('multiple adjacent blocks (directive immediately followed by heading, no blank line) segment correctly', () => {
    const raw = ':::llm\ninstructions\n:::\n## Heading\n';
    const doc = segmentDocument(raw);
    expect(doc.blocks).toHaveLength(2);
    expect(doc.blocks[0]).toMatchObject({ kind: 'opaque', type: 'containerDirective' });
    expect(doc.blocks[1]).toMatchObject({ kind: 'prose', type: 'heading' });
    // Exactly one newline (the plain line terminator ending the directive's closing fence line) —
    // no *blank* line in between, distinct from the double-newline "one blank line" case below.
    expect(doc.gaps[1]).toBe('\n');
  });

  it('preserves blank-line-count between blocks in the gap text (single vs double)', () => {
    const single = segmentDocument('# A\n\nPara one.\n');
    const double = segmentDocument('# A\n\n\nPara one.\n');
    // Each gap always carries one extra leading newline beyond the blank-line count itself (the
    // line terminator ending the *previous* block's own last line, which remark's own node
    // positions exclude) — so "one blank line" is 2 newlines, "two blank lines" is 3.
    expect(single.gaps[1]).toBe('\n\n');
    expect(double.gaps[1]).toBe('\n\n\n');
  });

  it('reassemble(segmentDocument(raw), originalBlockTexts) reproduces raw byte-for-byte', () => {
    const fixtures = [
      '---\nid: a\n---\n\n# A\n\nSome *text*.\n\n- one\n- two\n\n:::llm\nhi\n:::\n',
      '# Only heading\n',
      '',
      'No heading, just a paragraph.\n',
      'Setext\n======\n\nSecond\n------\n\nBody text.\n',
    ];
    for (const raw of fixtures) {
      const doc = segmentDocument(raw);
      const rebuilt = reassemble(doc, doc.blocks.map((b) => b.text));
      expect(doc.frontmatter + rebuilt.slice(doc.frontmatter.length)).toBe(raw);
      expect(rebuilt).toBe(raw);
    }
  });
});
