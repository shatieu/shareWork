import { describe, expect, it } from 'vitest';
import { computeLinkFixes } from '../src/fix-links.js';
import { emptyIndex, type ChartRoomIndex } from '../src/index-schema.js';

function buildIndex(overrides: Partial<ChartRoomIndex> = {}): ChartRoomIndex {
  return { ...emptyIndex(), ...overrides };
}

describe('computeLinkFixes', () => {
  it('rewrites a stale link href to the correct relative path, leaving everything else untouched', () => {
    const index = buildIndex({
      docs: { 'doc-a': { path: 'sub/a.md', title: 'A', headings: [], outbound: [] } },
    });
    const raw = '---\nid: doc-b\n---\n\nSee the [a doc](old/a.md "id:doc-a") for details.\n';
    const result = computeLinkFixes('b.md', raw, index);
    expect(result.changed).toBe(true);
    expect(result.changes).toEqual([{ targetId: 'doc-a', oldHref: 'old/a.md', newHref: 'sub/a.md' }]);
    expect(result.newText).toBe('---\nid: doc-b\n---\n\nSee the [a doc](sub/a.md "id:doc-a") for details.\n');
  });

  it('leaves non-stale links untouched (no-op, byte-identical)', () => {
    const index = buildIndex({
      docs: { 'doc-a': { path: 'sub/a.md', title: 'A', headings: [], outbound: [] } },
    });
    const raw = 'See the [a doc](sub/a.md "id:doc-a") for details.\n';
    const result = computeLinkFixes('b.md', raw, index);
    expect(result.changed).toBe(false);
    expect(result.newText).toBe(raw);
    expect(result.changes).toEqual([]);
  });

  it('frontmatter block is byte-identical after a link-only fix in the body', () => {
    const index = buildIndex({
      docs: { 'doc-a': { path: 'sub/a.md', title: 'A', headings: [], outbound: [] } },
    });
    const raw = '---\nid: doc-b\ntitle: "Doc B: notes"\n---\n\n[a](old/a.md "id:doc-a")\n';
    const result = computeLinkFixes('b.md', raw, index);
    const frontmatterBefore = raw.split('\n\n')[0];
    const frontmatterAfter = result.newText.split('\n\n')[0];
    expect(frontmatterAfter).toBe(frontmatterBefore);
  });

  it('does not rewrite a link-like string inside a fenced code block', () => {
    const index = buildIndex({
      docs: { 'doc-a': { path: 'sub/a.md', title: 'A', headings: [], outbound: [] } },
    });
    const raw = '```md\n[a](old/a.md "id:doc-a")\n```\n\nReal: [a](sub/a.md "id:doc-a")\n';
    const result = computeLinkFixes('b.md', raw, index);
    expect(result.changed).toBe(false);
    expect(result.newText).toBe(raw);
  });

  it('leaves a link with a dangling/unresolvable targetId untouched', () => {
    const index = buildIndex();
    const raw = '[gone](old/gone.md "id:missing-id")\n';
    const result = computeLinkFixes('b.md', raw, index);
    expect(result.changed).toBe(false);
    expect(result.newText).toBe(raw);
  });

  it('applies multiple stale-link fixes in the same file correctly (no offset drift)', () => {
    const index = buildIndex({
      docs: {
        'doc-a': { path: 'sub/a.md', title: 'A', headings: [], outbound: [] },
        'doc-c': { path: 'other/c.md', title: 'C', headings: [], outbound: [] },
      },
    });
    const raw = '[a](old/a.md "id:doc-a") and [c](old/c.md "id:doc-c")\n';
    const result = computeLinkFixes('b.md', raw, index);
    expect(result.newText).toBe('[a](sub/a.md "id:doc-a") and [c](other/c.md "id:doc-c")\n');
    expect(result.changes).toHaveLength(2);
  });
});
