import { describe, expect, it } from 'vitest';
import { computeBacklinks } from '../../src/daemon/backlinks.js';
import { emptyIndex, type ChartRoomIndex, type DocEntry } from '../../src/index-schema.js';

function doc(path: string, title: string, outbound: DocEntry['outbound'] = []): DocEntry {
  return { path, title, headings: [], outbound };
}

function indexWith(docs: ChartRoomIndex['docs'], deleted: ChartRoomIndex['deleted'] = {}): ChartRoomIndex {
  return { ...emptyIndex(), docs, deleted };
}

describe('computeBacklinks', () => {
  it('a doc with no inbound links has an empty (absent) backlinks entry', () => {
    const index = indexWith({
      a: doc('a.md', 'A'),
    });
    expect(computeBacklinks(index)).toEqual({});
  });

  it('two docs linking to a third both appear in its backlinks', () => {
    const index = indexWith({
      a: doc('a.md', 'A', [{ targetId: 'c', hrefAsWritten: 'c.md', stale: false }]),
      b: doc('b.md', 'B', [{ targetId: 'c', hrefAsWritten: 'c.md', stale: false }]),
      c: doc('c.md', 'C'),
    });
    expect(computeBacklinks(index)).toEqual({
      c: [
        { id: 'a', path: 'a.md', title: 'A' },
        { id: 'b', path: 'b.md', title: 'B' },
      ],
    });
  });

  it('a link to a tombstoned id contributes no backlink entry', () => {
    const index = indexWith(
      {
        a: doc('a.md', 'A', [{ targetId: 'gone', hrefAsWritten: 'gone.md', stale: false }]),
      },
      { gone: { lastPath: 'gone.md', deletedAt: '2026-01-01T00:00:00.000Z' } },
    );
    expect(computeBacklinks(index)).toEqual({});
  });

  it('a link to a not-found id (never existed) contributes no backlink entry', () => {
    const index = indexWith({
      a: doc('a.md', 'A', [{ targetId: 'never-existed', hrefAsWritten: 'x.md', stale: false }]),
    });
    expect(computeBacklinks(index)).toEqual({});
  });

  it('a link with no targetId (plain, non-id-carrying markdown link) is ignored', () => {
    const index = indexWith({
      a: doc('a.md', 'A', [{ hrefAsWritten: 'https://example.com', stale: false }]),
      b: doc('b.md', 'B'),
    });
    expect(computeBacklinks(index)).toEqual({});
  });
});
