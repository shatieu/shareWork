import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DECK_CLIENT_HEADER, type HostContext } from 'suite-conventions';
import {
  getSession,
  listUnwatchedSessionIds,
  openShipLogDb,
  setSessionWatched,
  shipLogDbPath,
  upsertSessionStart,
} from '../src/db.js';
import { createShipLogStation, type ShipLogStation } from '../src/station.js';

/** wave2-E: the `sessions.watched` fleet-view hide flag -- persistence, migration, route,
 * contract. */

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ship-log-watch-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('watched column (db)', () => {
  it('new sessions default to watched = 1', () => {
    const db = openShipLogDb(home);
    upsertSessionStart(db, { sessionId: 's1', cwd: 'C:/repos/a', startedAt: '2026-07-17T10:00:00.000Z' });
    expect(getSession(db, 's1')?.watched).toBe(1);
    expect(listUnwatchedSessionIds(db)).toEqual([]);
    db.close();
  });

  it('unwatch persists across reopen and rewatch flips it back', () => {
    let db = openShipLogDb(home);
    upsertSessionStart(db, { sessionId: 's1', cwd: 'C:/repos/a', startedAt: '2026-07-17T10:00:00.000Z' });
    setSessionWatched(db, 's1', false, '2026-07-17T11:00:00.000Z');
    expect(listUnwatchedSessionIds(db)).toEqual(['s1']);
    db.close();

    db = openShipLogDb(home);
    expect(listUnwatchedSessionIds(db)).toEqual(['s1']);
    const rewatched = setSessionWatched(db, 's1', true, '2026-07-17T12:00:00.000Z');
    expect(rewatched.watched).toBe(1);
    expect(listUnwatchedSessionIds(db)).toEqual([]);
    db.close();
  });

  it('unwatching a session ship-log never saw plants a stub row that a later SessionStart does not clobber', () => {
    const db = openShipLogDb(home);
    const stub = setSessionWatched(db, 'ghost', false, '2026-07-17T10:00:00.000Z');
    expect(stub).toMatchObject({ session_id: 'ghost', cwd: '', watched: 0, captured: 0 });

    // The vendor fleet keeps re-reporting the session; a real SessionStart arriving later must
    // fill in cwd without resurrecting it into the watched list.
    upsertSessionStart(db, { sessionId: 'ghost', cwd: 'C:/repos/g', startedAt: '2026-07-17T10:05:00.000Z' });
    expect(getSession(db, 'ghost')).toMatchObject({ cwd: 'C:/repos/g', watched: 0 });
    expect(listUnwatchedSessionIds(db)).toEqual(['ghost']);
    db.close();
  });

  it('migrates a v1 database (no watched column) in place, preserving rows', () => {
    // Hand-roll the v1 schema exactly as it existed before this change.
    const path = shipLogDbPath(home);
    mkdirSync(join(home, '.ship'), { recursive: true });
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE schema_meta (version INTEGER NOT NULL);
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        cwd TEXT NOT NULL,
        repo_root TEXT, project TEXT, branch_start TEXT, head_start TEXT, transcript_path TEXT,
        started_at TEXT NOT NULL,
        last_stop_at TEXT, ended_at TEXT, end_reason TEXT,
        captured INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO schema_meta (version) VALUES (1);
      INSERT INTO sessions (session_id, cwd, started_at) VALUES ('old', 'C:/repos/old', '2026-07-01T00:00:00.000Z');
    `);
    legacy.close();

    const db = openShipLogDb(home);
    expect(getSession(db, 'old')).toMatchObject({ cwd: 'C:/repos/old', watched: 1 });
    expect(db.prepare('SELECT version FROM schema_meta').get()).toEqual({ version: 2 });
    setSessionWatched(db, 'old', false, '2026-07-17T10:00:00.000Z');
    expect(listUnwatchedSessionIds(db)).toEqual(['old']);
    db.close();
  });
});

describe('watch route + contracts (station)', () => {
  let station: ShipLogStation;
  let app: FastifyInstance;

  const ctx: HostContext = { port: undefined, getContract: () => undefined, log: () => {} };

  beforeEach(async () => {
    station = createShipLogStation({ homeDir: home });
    app = Fastify({ logger: false });
    await station.registerRoutes(app, ctx);
  });

  afterEach(async () => {
    await app.close();
    await station.stop?.();
  });

  it('POST /watch requires the deck header and a boolean body', async () => {
    const noHeader = await app.inject({
      method: 'POST',
      url: '/api/ship-log/sessions/s1/watch',
      payload: { watched: false },
    });
    expect(noHeader.statusCode).toBe(403);

    const badBody = await app.inject({
      method: 'POST',
      url: '/api/ship-log/sessions/s1/watch',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: { watched: 'nope' },
    });
    expect(badBody.statusCode).toBe(400);
  });

  it('POST /watch unwatches/rewatches and the contracts see it', async () => {
    const unwatch = await app.inject({
      method: 'POST',
      url: '/api/ship-log/sessions/s1/watch',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: { watched: false },
    });
    expect(unwatch.statusCode).toBe(200);
    expect(unwatch.json()).toEqual({ sessionId: 's1', watched: false });

    const listUnwatched = station.contracts?.listUnwatchedSessionIds as () => string[];
    expect(listUnwatched()).toEqual(['s1']);

    const rewatch = await app.inject({
      method: 'POST',
      url: '/api/ship-log/sessions/s1/watch',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: { watched: true },
    });
    expect(rewatch.json()).toEqual({ sessionId: 's1', watched: true });
    expect(listUnwatched()).toEqual([]);

    const setWatched = station.contracts?.setSessionWatched as (id: string, watched: boolean) => unknown;
    setWatched('s2', false);
    expect(listUnwatched()).toEqual(['s2']);
  });
});
