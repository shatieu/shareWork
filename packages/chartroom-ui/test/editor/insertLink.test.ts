import { describe, expect, it } from 'vitest';
import { insertLink } from '../../src/editor/insertLink.js';
import type { DocSummary } from '../../src/api/client.js';

describe('insertLink (plan §7/§9.3)', () => {
  it('inserts the id-carrying format for a same-directory target', () => {
    const target: DocSummary = { id: 'doc-b', path: 'docs/b.md', title: 'Doc B' };
    const result = insertLink('docs/a.md', target);
    expect(result).toBe('[Doc B](b.md "id:doc-b")');
  });

  it('computes the correct relative href for a nested target', () => {
    const target: DocSummary = { id: 'doc-nested', path: 'docs/sub/nested.md', title: 'Nested' };
    const result = insertLink('docs/a.md', target);
    expect(result).toBe('[Nested](sub/nested.md "id:doc-nested")');
  });

  it('computes the correct relative href for a sibling-directory target', () => {
    const target: DocSummary = { id: 'doc-other', path: 'other/c.md', title: 'C' };
    const result = insertLink('docs/a.md', target);
    expect(result).toBe('[C](../other/c.md "id:doc-other")');
  });

  it('uses the selected text as link text when provided', () => {
    const target: DocSummary = { id: 'doc-b', path: 'docs/b.md', title: 'Doc B' };
    const result = insertLink('docs/a.md', target, 'click here');
    expect(result).toBe('[click here](b.md "id:doc-b")');
  });

  it('falls back to the target title when no text is selected', () => {
    const target: DocSummary = { id: 'doc-b', path: 'docs/b.md', title: 'Doc B' };
    expect(insertLink('docs/a.md', target, undefined)).toBe('[Doc B](b.md "id:doc-b")');
    expect(insertLink('docs/a.md', target, '')).toBe('[Doc B](b.md "id:doc-b")');
    expect(insertLink('docs/a.md', target, '   ')).toBe('[Doc B](b.md "id:doc-b")');
  });

  it('omits the id: title attribute for an unidentified (no-id) target', () => {
    const target: DocSummary = { id: null, path: 'docs/no-id.md', title: 'No Id' };
    const result = insertLink('docs/a.md', target);
    expect(result).toBe('[No Id](no-id.md)');
  });
});
