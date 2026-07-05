import { describe, expect, it } from 'vitest';
import { generateId, slugify } from '../src/id.js';

describe('slugify', () => {
  it('lowercases and hyphenates spaces/punctuation', () => {
    expect(slugify('Auth Architecture: v2!')).toBe('auth-architecture-v2');
  });

  it('strips diacritics', () => {
    expect(slugify('Café Résumé')).toBe('cafe-resume');
  });

  it('collapses repeated separators and trims leading/trailing hyphens', () => {
    expect(slugify('  --Weird___Title--  ')).toBe('weird-title');
  });

  it('falls back to "doc" when nothing usable remains', () => {
    expect(slugify('!!!')).toBe('doc');
  });

  it('is stable: same input always produces the same slug', () => {
    expect(slugify('Auth Spec')).toBe(slugify('Auth Spec'));
  });
});

describe('generateId', () => {
  it('returns the plain slug when there is no collision', () => {
    expect(generateId('Auth Spec', new Set())).toBe('auth-spec');
  });

  it('suffixes -2 on first collision', () => {
    expect(generateId('Auth Spec', new Set(['auth-spec']))).toBe('auth-spec-2');
  });

  it('suffixes -3 when -2 is also taken', () => {
    expect(generateId('Auth Spec', new Set(['auth-spec', 'auth-spec-2']))).toBe('auth-spec-3');
  });

  it('same title against an empty existing-id set is stable', () => {
    const a = generateId('Some Title', new Set());
    const b = generateId('Some Title', new Set());
    expect(a).toBe(b);
  });
});
