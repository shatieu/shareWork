import { describe, expect, it } from 'vitest';
import { extractToc } from '../src/toc/extractToc.js';

describe('extractToc', () => {
  it('extracts heading text and depth in document order', () => {
    const raw = '# Title\n\nSome text.\n\n## Section One\n\nMore text.\n\n### Sub Section\n';
    const toc = extractToc(raw);
    expect(toc).toEqual([
      { depth: 1, text: 'Title', slug: 'title' },
      { depth: 2, text: 'Section One', slug: 'section-one' },
      { depth: 3, text: 'Sub Section', slug: 'sub-section' },
    ]);
  });

  it('de-duplicates identical heading text the same way rehype-slug does (heading, heading-1, ...)', () => {
    const raw = '# Overview\n\n## Overview\n\n## Overview\n';
    const toc = extractToc(raw);
    expect(toc.map((e) => e.slug)).toEqual(['overview', 'overview-1', 'overview-2']);
  });

  it('returns an empty array for a document with no headings', () => {
    expect(extractToc('Just a paragraph, no headings here.\n')).toEqual([]);
  });

  it('ignores frontmatter and directive blocks, extracting only real headings', () => {
    const raw = '---\nid: doc-a\ntitle: A\n---\n\n:::llm{tldr="summary"}\nBody\n:::\n\n# Real Heading\n';
    const toc = extractToc(raw);
    expect(toc).toEqual([{ depth: 1, text: 'Real Heading', slug: 'real-heading' }]);
  });
});
