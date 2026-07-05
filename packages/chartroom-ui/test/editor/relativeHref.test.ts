import { describe, expect, it } from 'vitest';
import { computeExpectedHref, normalizeHref } from '../../src/editor/relativeHref.js';

// This module is a pure-string reimplementation of chartroom's link-paths.ts::computeExpectedHref
// (see relativeHref.ts's file header for why it's duplicated rather than cross-imported: a real
// `vite build` confirmed the original's `node:path` dependency breaks at runtime in a browser
// bundle). These cases mirror the same inputs/outputs that function is expected to produce.

describe('normalizeHref', () => {
  it('strips a leading "./"', () => {
    expect(normalizeHref('./a.md')).toBe('a.md');
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(normalizeHref('sub\\a.md')).toBe('sub/a.md');
  });

  it('leaves an already-normalized href untouched', () => {
    expect(normalizeHref('sub/a.md')).toBe('sub/a.md');
  });
});

describe('computeExpectedHref', () => {
  it('same-directory target', () => {
    expect(computeExpectedHref('docs/a.md', 'docs/b.md')).toBe('b.md');
  });

  it('both files at repo root', () => {
    expect(computeExpectedHref('a.md', 'b.md')).toBe('b.md');
  });

  it('nested target (one level deeper)', () => {
    expect(computeExpectedHref('docs/a.md', 'docs/sub/nested.md')).toBe('sub/nested.md');
  });

  it('sibling-directory target (one level up, one level down)', () => {
    expect(computeExpectedHref('docs/a.md', 'other/c.md')).toBe('../other/c.md');
  });

  it('deeply nested source, root-level target', () => {
    expect(computeExpectedHref('docs/sub/deeper/a.md', 'b.md')).toBe('../../../b.md');
  });

  it('root-level source, deeply nested target', () => {
    expect(computeExpectedHref('a.md', 'docs/sub/deeper/b.md')).toBe('docs/sub/deeper/b.md');
  });

  it('common-ancestor paths that partially overlap', () => {
    expect(computeExpectedHref('docs/sub/a.md', 'docs/other/b.md')).toBe('../other/b.md');
  });

  it('matches phase-1 link-paths.test-equivalent cases used by fix-links.test.ts', () => {
    // Same scenario as chartroom/test/fix-links.test.ts's own fixtures.
    expect(computeExpectedHref('b.md', 'sub/a.md')).toBe('sub/a.md');
    expect(computeExpectedHref('b.md', 'other/c.md')).toBe('other/c.md');
  });
});
