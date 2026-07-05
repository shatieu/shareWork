import { describe, expect, it } from 'vitest';
import { resolve } from '../src/resolver.js';
import { emptyIndex, type ChartRoomIndex } from '../src/index-schema.js';

function buildIndex(overrides: Partial<ChartRoomIndex> = {}): ChartRoomIndex {
  return { ...emptyIndex(), ...overrides };
}

describe('resolve', () => {
  it('step 1: resolves an exact id hit', () => {
    const index = buildIndex({
      docs: { 'auth-arch': { path: 'docs/auth.md', title: 'Auth Architecture', headings: [], outbound: [] } },
    });
    expect(resolve(index, 'auth-arch')).toEqual({ matchType: 'id', id: 'auth-arch', path: 'docs/auth.md' });
  });

  it('step 2: resolves an exact path-as-written hit', () => {
    const index = buildIndex({
      docs: { 'auth-arch': { path: 'docs/sub/auth.md', title: 'Auth Architecture', headings: [], outbound: [] } },
    });
    expect(resolve(index, 'docs/sub/auth.md')).toEqual({ matchType: 'path', id: 'auth-arch', path: 'docs/sub/auth.md' });
  });

  it('step 3: resolves a unique filename match', () => {
    const index = buildIndex({
      docs: { 'auth-arch': { path: 'docs/sub/auth.md', title: 'Auth Architecture', headings: [], outbound: [] } },
    });
    expect(resolve(index, 'auth.md')).toEqual({ matchType: 'filename', id: 'auth-arch', path: 'docs/sub/auth.md' });
  });

  it('step 3: ambiguous filename (2+ matches) falls through, does not false-match', () => {
    const index = buildIndex({
      docs: {
        a: { path: 'docs/a/readme.md', title: 'Alpha', headings: [], outbound: [] },
        b: { path: 'docs/b/readme.md', title: 'Beta', headings: [], outbound: [] },
      },
    });
    expect(resolve(index, 'readme.md')).toEqual({ matchType: 'not-found' });
  });

  it('step 4: fuzzy title match with guess:true when unambiguous', () => {
    const index = buildIndex({
      docs: { 'auth-arch': { path: 'docs/auth.md', title: 'Authentication Architecture Overview', headings: [], outbound: [] } },
    });
    const result = resolve(index, 'authentication-architecture');
    expect(result.matchType).toBe('fuzzy');
    if (result.matchType === 'fuzzy') {
      expect(result.guess).toBe(true);
      expect(result.id).toBe('auth-arch');
    }
  });

  it('step 4: does not guess when scores are ambiguous (no meaningful margin)', () => {
    const index = buildIndex({
      docs: {
        a: { path: 'docs/a.md', title: 'Payments Gateway', headings: [], outbound: [] },
        b: { path: 'docs/b.md', title: 'Payments Ledger', headings: [], outbound: [] },
      },
    });
    expect(resolve(index, 'payments')).toEqual({ matchType: 'not-found' });
  });

  it('step 5: resolves a tombstone', () => {
    const index = buildIndex({
      deleted: { 'gone-doc': { lastPath: 'docs/gone.md', deletedAt: '2026-01-01T00:00:00.000Z' } },
    });
    expect(resolve(index, 'gone-doc')).toEqual({
      matchType: 'tombstone',
      id: 'gone-doc',
      lastPath: 'docs/gone.md',
      deletedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('step 5: not-found when nothing matches at all', () => {
    const index = buildIndex();
    expect(resolve(index, 'totally-unknown-xyz')).toEqual({ matchType: 'not-found' });
  });
});
