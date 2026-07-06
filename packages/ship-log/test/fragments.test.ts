import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { slugify, writeFragment } from '../src/fragments.js';

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'ship-log-fragments-test-'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('slugify', () => {
  it('lowercases and dashes non-alphanumerics', () => {
    expect(slugify('Bridge Phase 1!!')).toBe('bridge-phase-1');
  });
  it('falls back to "session" for empty/undefined input', () => {
    expect(slugify('')).toBe('session');
    expect(slugify(undefined)).toBe('session');
    expect(slugify('###')).toBe('session');
  });
});

describe('writeFragment', () => {
  const baseInput = {
    repoRoot: '',
    date: '2026-07-06',
    sessionId: 'abcdef1234567890',
    project: 'shareWork',
    branch: 'ship-wave1-bridge1',
    summary: 'Implemented ship-log capture.',
    commits: [{ hash: 'deadbeef', subject: 'feat: capture' }],
    files: ['a.ts', 'b.ts'],
  };

  it('writes a create-only fragment with the expected filename shape and frontmatter', () => {
    const result = writeFragment({ ...baseInput, repoRoot });
    expect(result.written).toBe(true);
    expect(result.path).toMatch(/2026-07-06--ship-wave1-bridge1--abcdef12\.md$/);
    const content = readFileSync(result.path, 'utf8');
    expect(content).toContain('id: log-abcdef12');
    expect(content).toContain('date: 2026-07-06');
    expect(content).toContain('session: abcdef1234567890');
    expect(content).toContain('Implemented ship-log capture.');
    expect(content).toContain('deadbeef feat: capture');
  });

  it('never overwrites an existing fragment (create-only invariant)', () => {
    const first = writeFragment({ ...baseInput, repoRoot });
    const originalBytes = readFileSync(first.path);

    const second = writeFragment({
      ...baseInput,
      repoRoot,
      summary: 'A completely different summary that must never land.',
    });
    expect(second.written).toBe(false);
    expect(second.path).toBe(first.path);

    const afterBytes = readFileSync(first.path);
    expect(afterBytes.equals(originalBytes)).toBe(true);
    expect(afterBytes.toString('utf8')).not.toContain('completely different');
  });

  it('sets partial: true in frontmatter when requested', () => {
    const result = writeFragment({ ...baseInput, repoRoot, partial: true });
    const content = readFileSync(result.path, 'utf8');
    expect(content).toContain('partial: true');
  });

  it('creates changelog/entries on demand', () => {
    expect(existsSync(join(repoRoot, 'changelog', 'entries'))).toBe(false);
    writeFragment({ ...baseInput, repoRoot });
    expect(existsSync(join(repoRoot, 'changelog', 'entries'))).toBe(true);
  });
});
