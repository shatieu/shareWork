import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildTar, buildTgz, readTar } from '../src/tar.js';

describe('tar writer', () => {
  it('round-trips entries byte-for-byte', () => {
    const entries = [
      { name: 'package/package.json', content: '{"name":"x"}\n' },
      { name: 'package/skills/demo/SKILL.md', content: '# Demo\n\ncontent with ümläuts\n' },
    ];
    const roundTripped = readTar(buildTar(entries, 1_751_800_000));
    expect(roundTripped).toEqual(entries);
  });

  it('is deterministic (same input, same bytes) and entry-order independent', () => {
    const a = [
      { name: 'package/a.md', content: 'a' },
      { name: 'package/b.md', content: 'b' },
    ];
    const b = [...a].reverse();
    const mtime = 1_751_800_000;
    expect(buildTar(a, mtime).equals(buildTar(b, mtime))).toBe(true);
    expect(buildTgz(a, mtime).equals(buildTgz(b, mtime))).toBe(true);
  });

  it('gzips to a valid archive', () => {
    const entries = [{ name: 'package/x.txt', content: 'hello' }];
    const tgz = buildTgz(entries, 0);
    expect(readTar(gunzipSync(tgz))).toEqual(entries);
  });

  it('handles names >100 chars via the ustar prefix field', () => {
    const long = `package/${'deep/'.repeat(25)}file.md`; // > 100 chars
    expect(long.length).toBeGreaterThan(100);
    const roundTripped = readTar(buildTar([{ name: long, content: 'x' }], 0));
    expect(roundTripped[0].name).toBe(long);
  });

  it('rejects unsplittable overlong names instead of corrupting the archive', () => {
    const bad = 'x'.repeat(200);
    expect(() => buildTar([{ name: bad, content: 'x' }], 0)).toThrow(/too long/);
  });

  it('pads bodies to 512-byte blocks and terminates with two zero blocks', () => {
    const tar = buildTar([{ name: 'package/a', content: 'abc' }], 0);
    expect(tar.length % 512).toBe(0);
    expect(tar.subarray(tar.length - 1024).every((byte) => byte === 0)).toBe(true);
  });
});
