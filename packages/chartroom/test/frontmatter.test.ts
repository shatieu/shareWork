import { describe, expect, it } from 'vitest';
import { injectId, readFrontmatter } from '../src/frontmatter.js';

describe('injectId', () => {
  it('prepends a new frontmatter block when there is none', () => {
    const raw = '# Title\n\nSome body text.\n';
    const result = injectId(raw, 'my-id');
    expect(result).toBe('---\nid: my-id\n---\n\n# Title\n\nSome body text.\n');
    // Untouched original body must appear byte-identical inside the result.
    expect(result.endsWith(raw)).toBe(true);
  });

  it('inserts id as the first line of an existing frontmatter block missing id', () => {
    const raw = '---\ntitle: My Doc\ntags:\n  - a\n  - b\n---\n\n# Title\n\nBody.\n';
    const result = injectId(raw, 'my-id');
    expect(result).toBe('---\nid: my-id\ntitle: My Doc\ntags:\n  - a\n  - b\n---\n\n# Title\n\nBody.\n');
    // Everything after the inserted line must be byte-identical to the original.
    const originalAfterOpen = raw.slice('---\n'.length);
    const resultAfterIdLine = result.slice('---\nid: my-id\n'.length);
    expect(resultAfterIdLine).toBe(originalAfterOpen);
  });

  it('is idempotent: already has id -> byte-identical no-op', () => {
    const raw = '---\nid: existing-id\ntitle: My Doc\n---\n\nBody.\n';
    const result = injectId(raw, 'ignored-id');
    expect(result).toBe(raw);
  });

  it('treats a numeric id frontmatter value as already present', () => {
    const raw = '---\nid: 123\n---\n\nBody.\n';
    const result = injectId(raw, 'ignored-id');
    expect(result).toBe(raw);
  });
});

describe('readFrontmatter', () => {
  it('reports hasFrontmatter=false and bodyStart=0 for a file with no frontmatter', () => {
    const info = readFrontmatter('# Title\n');
    expect(info.hasFrontmatter).toBe(false);
    expect(info.bodyStart).toBe(0);
    expect(info.data).toEqual({});
  });

  it('parses data and computes bodyStart at the correct offset', () => {
    const raw = '---\nid: x\ntitle: Y\n---\n\nBody text.\n';
    const info = readFrontmatter(raw);
    expect(info.hasFrontmatter).toBe(true);
    expect(info.data).toEqual({ id: 'x', title: 'Y' });
    expect(raw.slice(info.bodyStart)).toBe('\nBody text.\n');
  });
});
