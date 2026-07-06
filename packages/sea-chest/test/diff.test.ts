import { describe, expect, it } from 'vitest';
import { diffFileMaps, diffLines, unifiedDiff } from '../src/diff.js';

describe('diffLines', () => {
  it('identical inputs are all-context', () => {
    const ops = diffLines('a\nb', 'a\nb');
    expect(ops.every((op) => op.type === 'ctx')).toBe(true);
  });

  it('reports adds and deletes with common affixes preserved', () => {
    const ops = diffLines('keep\nold\ntail', 'keep\nnew\ntail');
    expect(ops).toEqual([
      { type: 'ctx', line: 'keep' },
      { type: 'del', line: 'old' },
      { type: 'add', line: 'new' },
      { type: 'ctx', line: 'tail' },
    ]);
  });

  it('handles empty sides', () => {
    expect(diffLines('', 'x')).toEqual([{ type: 'add', line: 'x' }]);
    expect(diffLines('x', '')).toEqual([{ type: 'del', line: 'x' }]);
    expect(diffLines('', '')).toEqual([]);
  });

  it('falls back to whole-replace beyond the LCS cap without corrupting counts', () => {
    const a = Array.from({ length: 4000 }, (_, i) => `a${i}`).join('\n');
    const b = Array.from({ length: 4000 }, (_, i) => `b${i}`).join('\n');
    const ops = diffLines(a, b);
    expect(ops.filter((op) => op.type === 'del')).toHaveLength(4000);
    expect(ops.filter((op) => op.type === 'add')).toHaveLength(4000);
  });
});

describe('unifiedDiff', () => {
  it('returns empty string for identical text', () => {
    expect(unifiedDiff('same\n', 'same\n', 'a', 'b')).toBe('');
  });

  it('emits headers and hunk markers with correct line numbers', () => {
    const a = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].join('\n');
    const b = ['1', '2', '3', '4', 'FIVE', '6', '7', '8', '9', '10'].join('\n');
    const diff = unifiedDiff(a, b, 'locker/x', 'local/x');
    expect(diff).toContain('--- locker/x');
    expect(diff).toContain('+++ local/x');
    expect(diff).toContain('@@ -2,7 +2,7 @@');
    expect(diff).toContain('-5');
    expect(diff).toContain('+FIVE');
  });

  it('splits distant changes into separate hunks', () => {
    const base = Array.from({ length: 40 }, (_, i) => `line${i}`);
    const changed = [...base];
    changed[2] = 'X';
    changed[35] = 'Y';
    const diff = unifiedDiff(base.join('\n'), changed.join('\n'), 'a', 'b');
    expect(diff.match(/@@ /g)).toHaveLength(2);
  });
});

describe('diffFileMaps (locker_diff surface)', () => {
  it('classifies added/removed/modified/same', () => {
    const result = diffFileMaps(
      { 'same.md': 'x', 'changed.md': 'local', 'only-local.md': 'l' },
      { 'same.md': 'x', 'changed.md': 'stored', 'only-locker.md': 's' },
    );
    expect(result).toEqual([
      { path: 'changed.md', status: 'modified', diff: expect.stringContaining('+local') },
      { path: 'only-local.md', status: 'added', diff: '' },
      { path: 'only-locker.md', status: 'removed', diff: '' },
      { path: 'same.md', status: 'same', diff: '' },
    ]);
  });
});
