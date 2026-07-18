import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  countUndelivered,
  createMessage,
  listHistory,
  messageToJson,
  openShipCommsDb,
  pollMessages,
  shipCommsDbPath,
} from '../src/db.js';

let home: string;
let db: Database.Database;

const T0 = '2026-07-18T10:00:00.000Z';
const T1 = '2026-07-18T10:00:01.000Z';
const T2 = '2026-07-18T10:00:02.000Z';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ship-comms-db-home-'));
  db = openShipCommsDb(home);
});

afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

describe('openShipCommsDb', () => {
  it('creates ~/.ship/ship-comms.db under the given home', () => {
    expect(shipCommsDbPath(home)).toBe(join(home, '.ship', 'ship-comms.db'));
    expect(db.pragma('user_version', { simple: true })).toBe(1);
  });
});

describe('messages', () => {
  it('stores a message undelivered and round-trips through messageToJson', () => {
    const row = createMessage(db, { fromSession: 'sess-a', toSession: 'sess-b', text: 'hello' }, T0);
    expect(messageToJson(row)).toEqual({
      id: row.id,
      fromSession: 'sess-a',
      toSession: 'sess-b',
      text: 'hello',
      createdAt: T0,
      deliveredAt: null,
    });
    expect(countUndelivered(db)).toBe(1);
  });

  it('pollMessages returns oldest-first, marks delivered, and a second poll is empty', () => {
    createMessage(db, { fromSession: 'a', toSession: 'b', text: 'first' }, T0);
    createMessage(db, { fromSession: 'a', toSession: 'b', text: 'second' }, T1);
    createMessage(db, { fromSession: 'a', toSession: 'other', text: 'not yours' }, T0);

    const polled = pollMessages(db, 'b', T2);
    expect(polled.map((m) => m.text)).toEqual(['first', 'second']);
    expect(polled.every((m) => m.delivered_at === T2)).toBe(true);

    expect(pollMessages(db, 'b', T2)).toEqual([]);
    // The other session's message is untouched.
    expect(countUndelivered(db)).toBe(1);
  });

  it('listHistory shows both directions, delivered included, oldest-first', () => {
    createMessage(db, { fromSession: 'a', toSession: 'b', text: 'to b' }, T0);
    createMessage(db, { fromSession: 'b', toSession: 'a', text: 'reply to a' }, T1);
    createMessage(db, { fromSession: 'x', toSession: 'y', text: 'unrelated' }, T0);
    pollMessages(db, 'b', T2);

    const history = listHistory(db, 'b');
    expect(history.map((m) => m.text)).toEqual(['to b', 'reply to a']);
    expect(history[0].delivered_at).toBe(T2); // delivered rows stay in history
    expect(history[1].delivered_at).toBeNull();
  });
});
