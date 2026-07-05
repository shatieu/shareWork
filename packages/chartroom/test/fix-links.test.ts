import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeImageFixes, computeLinkFixes } from '../src/fix-links.js';
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

describe('computeImageFixes (plan §6.3 — image-href repair extension)', () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-image-fix-test-'));
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
  });

  function writeFile(relPath: string, content: string | Buffer): void {
    const abs = join(repoRoot, relPath);
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(abs, content);
  }

  it('own-doc-id asset-folder fallback: repairs a broken href after the hosting doc moves', () => {
    // Asset lives in its repo-root-relative, doc-id-keyed folder (plan §6.1) — unaffected by the
    // doc's own move.
    writeFile('assets/doc-a/167.png', Buffer.from('fake-png-bytes'));
    const index: ChartRoomIndex = { ...emptyIndex(), docs: { 'doc-a': { path: 'docs/sub/a.md', title: 'A', headings: [], outbound: [] } } };

    // href was correct when the doc lived at docs/a.md (one level up from repo root to assets/).
    const raw = '---\nid: doc-a\n---\n\n# A\n\n![](../assets/doc-a/167.png)\n';
    const result = computeImageFixes(repoRoot, 'docs/sub/a.md', raw, index);

    expect(result.changed).toBe(true);
    expect(result.changes).toEqual([{ oldHref: '../assets/doc-a/167.png', newHref: '../../assets/doc-a/167.png' }]);
    expect(result.newText).toBe('---\nid: doc-a\n---\n\n# A\n\n![](../../assets/doc-a/167.png)\n');
  });

  it('content-hash match: repairs a resolvable-but-stale href when the asset itself moved', () => {
    writeFile('assets/doc-a/new-location.png', Buffer.from('same-bytes'));
    writeFile('docs/old-location.png', Buffer.from('same-bytes'));
    const index: ChartRoomIndex = {
      ...emptyIndex(),
      docs: { 'doc-a': { path: 'docs/a.md', title: 'A', headings: [], outbound: [] } },
      assets: { [sha256Hex('same-bytes')]: { path: 'assets/doc-a/new-location.png' } },
    };

    const raw = '![](old-location.png)\n';
    const result = computeImageFixes(repoRoot, 'docs/a.md', raw, index);

    expect(result.changed).toBe(true);
    expect(result.changes).toEqual([{ oldHref: 'old-location.png', newHref: '../assets/doc-a/new-location.png' }]);
  });

  it('leaves an already-correct image href untouched (no-op, byte-identical)', () => {
    writeFile('assets/doc-a/167.png', Buffer.from('fake-png-bytes'));
    const index: ChartRoomIndex = { ...emptyIndex(), docs: { 'doc-a': { path: 'docs/a.md', title: 'A', headings: [], outbound: [] } } };
    const raw = '![](../assets/doc-a/167.png)\n';
    const result = computeImageFixes(repoRoot, 'docs/a.md', raw, index);
    expect(result.changed).toBe(false);
    expect(result.newText).toBe(raw);
  });

  it('leaves a fully broken image (no id-folder match, no hash match) untouched rather than guessing', () => {
    const index: ChartRoomIndex = { ...emptyIndex(), docs: { 'doc-a': { path: 'docs/a.md', title: 'A', headings: [], outbound: [] } } };
    const raw = '![](nowhere/gone.png)\n';
    const result = computeImageFixes(repoRoot, 'docs/a.md', raw, index);
    expect(result.changed).toBe(false);
    expect(result.newText).toBe(raw);
  });

  it('passes through remote image URLs untouched', () => {
    const index: ChartRoomIndex = { ...emptyIndex(), docs: { 'doc-a': { path: 'docs/a.md', title: 'A', headings: [], outbound: [] } } };
    const raw = '![](https://example.com/pic.png)\n';
    const result = computeImageFixes(repoRoot, 'docs/a.md', raw, index);
    expect(result.changed).toBe(false);
  });

  it('frontmatter and surrounding prose are byte-identical after an image-only fix', () => {
    writeFile('assets/doc-a/167.png', Buffer.from('fake-png-bytes'));
    const index: ChartRoomIndex = { ...emptyIndex(), docs: { 'doc-a': { path: 'docs/sub/a.md', title: 'A', headings: [], outbound: [] } } };
    const raw = '---\nid: doc-a\ntitle: "A: notes"\n---\n\n# A\n\nSome text before.\n\n![](../assets/doc-a/167.png)\n\nSome text after.\n';
    const result = computeImageFixes(repoRoot, 'docs/sub/a.md', raw, index);
    expect(result.newText.split('\n\n')[0]).toBe(raw.split('\n\n')[0]);
    expect(result.newText).toContain('Some text before.');
    expect(result.newText).toContain('Some text after.');
  });
});

function sha256Hex(content: string): string {
  // Same hashing scheme indexer.ts::collectAssets uses, so this matches whatever key
  // computeImageFixes will actually compute for a real file with this content.
  return createHash('sha256').update(content).digest('hex');
}
