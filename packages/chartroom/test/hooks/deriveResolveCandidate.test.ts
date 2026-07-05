import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveResolveCandidate } from '../../src/hook-candidate.js';

describe('deriveResolveCandidate', () => {
  it('an already-relative path is returned unchanged (slash-normalized)', () => {
    expect(deriveResolveCandidate('docs/sub/a.md', 'C:\\repo')).toBe('docs/sub/a.md');
  });

  it('an absolute path inside the repo root becomes repo-relative', () => {
    const repoRoot = join('C:', 'repo');
    const filePath = join(repoRoot, 'docs', 'a.md');
    expect(deriveResolveCandidate(filePath, repoRoot)).toBe('docs/a.md');
  });

  it('an absolute path entirely outside the repo root falls back to the bare basename', () => {
    const repoRoot = join('C:', 'repo');
    const filePath = join('C:', 'somewhere-else', 'a.md');
    expect(deriveResolveCandidate(filePath, repoRoot)).toBe('a.md');
  });

  it('never emits a path-traversal-shaped (../) candidate for an outside-root path', () => {
    const repoRoot = join('C:', 'repo', 'nested');
    const filePath = join('C:', 'repo', 'other', 'a.md');
    const result = deriveResolveCandidate(filePath, repoRoot);
    expect(result).not.toMatch(/\.\./);
    expect(result).toBe('a.md');
  });
});
