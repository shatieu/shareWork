import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureSessionRow,
  findOrphanSessions,
  getRollup,
  getSession,
  insertEntry,
  listEntries,
  markCaptured,
  markSessionEnded,
  openShipLogDb,
  shipLogDbPath,
  touchStop,
  upsertRollup,
  upsertSessionStart,
} from '../src/db.js';

let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'ship-log-db-test-'));
});

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

describe('openShipLogDb', () => {
  it('creates the schema at homeDir/.ship/log.db and is safe to reopen', () => {
    const db1 = openShipLogDb(fakeHome);
    upsertSessionStart(db1, {
      sessionId: 's1',
      cwd: '/tmp/x',
      startedAt: '2026-07-06T00:00:00.000Z',
    });
    db1.close();

    const db2 = openShipLogDb(fakeHome);
    expect(getSession(db2, 's1')?.session_id).toBe('s1');
    db2.close();

    expect(shipLogDbPath(fakeHome)).toContain('.ship');
  });

  it('supports a second concurrent connection (CLI-vs-hull simulation)', () => {
    const dbA = openShipLogDb(fakeHome);
    const dbB = openShipLogDb(fakeHome);
    upsertSessionStart(dbA, { sessionId: 's2', cwd: '/tmp/y', startedAt: '2026-07-06T00:00:00Z' });
    expect(getSession(dbB, 's2')?.session_id).toBe('s2');
    dbA.close();
    dbB.close();
  });
});

describe('session lifecycle rows', () => {
  it('upsertSessionStart then touchStop then markSessionEnded then markCaptured', () => {
    const db = openShipLogDb(fakeHome);
    upsertSessionStart(db, {
      sessionId: 's3',
      cwd: '/tmp/z',
      repoRoot: '/tmp/z',
      project: 'z',
      branchStart: 'main',
      headStart: 'abc123',
      startedAt: '2026-07-06T00:00:00Z',
    });
    touchStop(db, 's3', '2026-07-06T00:01:00Z', '/tmp/transcript.jsonl');
    let row = getSession(db, 's3')!;
    expect(row.last_stop_at).toBe('2026-07-06T00:01:00Z');
    expect(row.transcript_path).toBe('/tmp/transcript.jsonl');
    expect(row.captured).toBe(0);

    markSessionEnded(db, 's3', '2026-07-06T00:02:00Z', 'other');
    row = getSession(db, 's3')!;
    expect(row.ended_at).toBe('2026-07-06T00:02:00Z');
    expect(row.end_reason).toBe('other');

    markCaptured(db, 's3');
    row = getSession(db, 's3')!;
    expect(row.captured).toBe(1);
    db.close();
  });

  it('ensureSessionRow never clobbers an existing SessionStart row', () => {
    const db = openShipLogDb(fakeHome);
    upsertSessionStart(db, {
      sessionId: 's4',
      cwd: '/tmp/a',
      branchStart: 'feature-x',
      startedAt: '2026-07-06T00:00:00Z',
    });
    ensureSessionRow(db, { sessionId: 's4', cwd: '/tmp/a-different', startedAt: '2026-07-06T09:00:00Z' });
    const row = getSession(db, 's4')!;
    expect(row.branch_start).toBe('feature-x');
    expect(row.started_at).toBe('2026-07-06T00:00:00Z');
    db.close();
  });

  it('findOrphanSessions returns sessions stale beyond the threshold, never-captured only', () => {
    const db = openShipLogDb(fakeHome);
    upsertSessionStart(db, { sessionId: 'orphan1', cwd: '/tmp/o', startedAt: '2026-07-06T00:00:00Z' });
    touchStop(db, 'orphan1', '2026-07-06T00:00:00Z');
    upsertSessionStart(db, { sessionId: 'fresh1', cwd: '/tmp/f', startedAt: '2026-07-06T02:55:00Z' });
    touchStop(db, 'fresh1', '2026-07-06T02:55:00Z');

    const orphans = findOrphanSessions(db, '2026-07-06T03:00:00Z', 2 * 60 * 60 * 1000);
    expect(orphans.map((o) => o.session_id)).toEqual(['orphan1']);
    db.close();
  });
});

describe('entries + rollups', () => {
  it('insertEntry then listEntries filters by date/project', () => {
    const db = openShipLogDb(fakeHome);
    insertEntry(db, {
      sessionId: 's5',
      date: '2026-07-06',
      project: 'alpha',
      commits: [{ hash: 'a1', subject: 'fix bug' }],
      files: ['a.ts'],
      summary: 'Fixed a bug.',
      createdAt: '2026-07-06T00:00:00Z',
    });
    insertEntry(db, {
      sessionId: 's6',
      date: '2026-07-05',
      project: 'beta',
      commits: [],
      files: [],
      summary: 'Nothing changed.',
      createdAt: '2026-07-05T00:00:00Z',
    });

    expect(listEntries(db, { date: '2026-07-06' })).toHaveLength(1);
    expect(listEntries(db, { project: 'beta' })).toHaveLength(1);
    expect(listEntries(db)).toHaveLength(2);
    db.close();
  });

  it('upsertRollup is idempotent re-init (insert then update same date)', () => {
    const db = openShipLogDb(fakeHome);
    upsertRollup(db, {
      date: '2026-07-06',
      digest_md: 'first',
      model: 'haiku',
      entry_count: 1,
      created_at: '2026-07-06T00:00:00Z',
    });
    upsertRollup(db, {
      date: '2026-07-06',
      digest_md: 'second',
      model: 'haiku',
      entry_count: 2,
      created_at: '2026-07-06T01:00:00Z',
    });
    const row = getRollup(db, '2026-07-06');
    expect(row?.digest_md).toBe('second');
    expect(row?.entry_count).toBe(2);
    db.close();
  });
});
