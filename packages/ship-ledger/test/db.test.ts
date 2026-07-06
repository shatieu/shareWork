import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createItem,
  getItem,
  itemToJson,
  listItems,
  openShipLedgerDb,
  shipLedgerDbPath,
  stageProgressFor,
  updateItem,
  LEDGER_STATUSES,
} from '../src/db.js';

let fakeHome: string;
let db: Database.Database;

const T0 = '2026-07-06T10:00:00.000Z';
const T1 = '2026-07-06T11:00:00.000Z';

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'ship-ledger-db-test-'));
  db = openShipLedgerDb(fakeHome);
});

afterEach(() => {
  db.close();
  rmSync(fakeHome, { recursive: true, force: true });
});

describe('openShipLedgerDb', () => {
  it('creates the db under <home>/.ship/ledger.db in WAL mode', () => {
    expect(shipLedgerDbPath(fakeHome)).toBe(join(fakeHome, '.ship', 'ledger.db'));
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('is idempotent across reopen -- schema and data survive', () => {
    createItem(db, { title: 'survives', source: 'human' }, T0);
    db.close();
    db = openShipLedgerDb(fakeHome);
    expect(listItems(db)).toHaveLength(1);
    const meta = db.prepare('SELECT version FROM schema_meta').all();
    expect(meta).toEqual([{ version: 1 }]);
  });

  it('allows a concurrent second connection (MCP-process-vs-hull simulation)', () => {
    const other = openShipLedgerDb(fakeHome);
    const created = createItem(other, { title: 'from other process', source: 'agent' }, T0);
    expect(getItem(db, created.id)?.title).toBe('from other process');
    other.close();
  });
});

describe('stageProgressFor', () => {
  it('is total over the status enum, monotone open->done, done=100, open=0', () => {
    for (const status of LEDGER_STATUSES) {
      const p = stageProgressFor(status);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(100);
    }
    expect(stageProgressFor('open')).toBe(0);
    expect(stageProgressFor('done')).toBe(100);
    expect(stageProgressFor('claimed')).toBeLessThan(stageProgressFor('in_progress'));
    expect(stageProgressFor('in_progress')).toBeLessThan(stageProgressFor('in_review'));
  });
});

describe('createItem', () => {
  it('applies defaults: uuid id, open/normal, empty spec, stage_progress from status', () => {
    const row = createItem(db, { title: 'a thing', source: 'human' }, T0);
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.status).toBe('open');
    expect(row.priority).toBe('normal');
    expect(row.spec_md).toBe('');
    expect(row.stage_progress).toBe(0);
    expect(row.created_at).toBe(T0);
    expect(row.updated_at).toBe(T0);
    expect(JSON.parse(row.session_refs_json)).toEqual([]);
  });

  it('honors explicit fields and computes stage_progress from the given status', () => {
    const row = createItem(
      db,
      {
        title: 'estimated',
        specMd: '## spec',
        project: 'sharework',
        status: 'in_progress',
        priority: 'high',
        source: 'agent',
        sessionRefs: ['s-1'],
        difficulty: 'L',
        remainingGuessH: 4.5,
      },
      T0,
    );
    expect(row.stage_progress).toBe(stageProgressFor('in_progress'));
    expect(row.difficulty).toBe('L');
    expect(row.remaining_guess_h).toBe(4.5);
    expect(JSON.parse(row.session_refs_json)).toEqual(['s-1']);
  });

  it('rejects invalid status / priority / source / difficulty', () => {
    expect(() =>
      createItem(db, { title: 'x', source: 'martian' as never }, T0),
    ).toThrow(/invalid source/);
    expect(() =>
      createItem(db, { title: 'x', source: 'human', status: 'doing' as never }, T0),
    ).toThrow(/invalid status/);
    expect(() =>
      createItem(db, { title: 'x', source: 'human', priority: 'urgent' as never }, T0),
    ).toThrow(/invalid priority/);
    expect(() =>
      createItem(db, { title: 'x', source: 'human', difficulty: 'XXL' as never }, T0),
    ).toThrow(/invalid difficulty/);
  });
});

describe('listItems', () => {
  it('filters by project, status, and source', () => {
    createItem(db, { title: 'a', project: 'p1', source: 'human' }, T0);
    createItem(db, { title: 'b', project: 'p2', status: 'done', source: 'agent' }, T0);
    createItem(db, { title: 'c', project: 'p2', source: 'native-mirror' }, T1);
    expect(listItems(db)).toHaveLength(3);
    expect(listItems(db, { project: 'p2' })).toHaveLength(2);
    expect(listItems(db, { status: 'done' }).map((r) => r.title)).toEqual(['b']);
    expect(listItems(db, { source: 'native-mirror' }).map((r) => r.title)).toEqual(['c']);
  });
});

describe('updateItem', () => {
  it('returns undefined for an unknown id', () => {
    expect(updateItem(db, 'nope', { title: 'x' }, T1)).toBeUndefined();
  });

  it('recomputes stage_progress on status change and advances updated_at', () => {
    const row = createItem(db, { title: 'w', source: 'human' }, T0);
    const updated = updateItem(db, row.id, { status: 'in_review' }, T1)!;
    expect(updated.status).toBe('in_review');
    expect(updated.stage_progress).toBe(stageProgressFor('in_review'));
    expect(updated.updated_at).toBe(T1);
    expect(updated.created_at).toBe(T0);
  });

  it('leaves stage_progress alone when status is not patched', () => {
    const row = createItem(db, { title: 'w', status: 'in_progress', source: 'agent' }, T0);
    const updated = updateItem(db, row.id, { title: 'renamed' }, T1)!;
    expect(updated.stage_progress).toBe(stageProgressFor('in_progress'));
    expect(updated.title).toBe('renamed');
  });

  it('addSessionRef appends once (dedupe)', () => {
    const row = createItem(db, { title: 'w', source: 'agent', sessionRefs: ['s-1'] }, T0);
    updateItem(db, row.id, { addSessionRef: 's-2' }, T1);
    const twice = updateItem(db, row.id, { addSessionRef: 's-2' }, T1)!;
    expect(JSON.parse(twice.session_refs_json)).toEqual(['s-1', 's-2']);
  });

  it('rejects an invalid patched status', () => {
    const row = createItem(db, { title: 'w', source: 'human' }, T0);
    expect(() => updateItem(db, row.id, { status: 'finished' as never }, T1)).toThrow(
      /invalid status/,
    );
  });
});

describe('itemToJson', () => {
  it('round-trips the row into the canonical camelCase shape', () => {
    const row = createItem(
      db,
      { title: 'j', source: 'agent', sessionRefs: ['s-9'], difficulty: 'S' },
      T0,
    );
    const json = itemToJson(row);
    expect(json).toMatchObject({
      id: row.id,
      title: 'j',
      specMd: '',
      status: 'open',
      priority: 'normal',
      source: 'agent',
      sessionRefs: ['s-9'],
      stageProgress: 0,
      difficulty: 'S',
      createdAt: T0,
      updatedAt: T0,
    });
  });
});
