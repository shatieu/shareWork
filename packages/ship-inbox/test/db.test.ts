import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import {
  ackAgentQuestion,
  createAgentQuestion,
  createPermissionRequest,
  decidePermissionRequest,
  expirePermissionRequest,
  expireStalePending,
  getPermissionRequest,
  listAgentQuestions,
  listPermissionRequests,
  openShipInboxDb,
  permissionToJson,
  projectFromCwd,
  shipInboxDbPath,
} from '../src/db.js';

let home: string;
let db: Database.Database;

const T0 = '2026-07-06T10:00:00.000Z';

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ship-inbox-db-'));
  db = openShipInboxDb(home);
});

afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

describe('openShipInboxDb', () => {
  it('creates ~/.ship/inbox.db in WAL mode under the injected home', () => {
    expect(existsSync(shipInboxDbPath(home))).toBe(true);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
  });
});

describe('projectFromCwd', () => {
  it('takes the last segment of Windows and POSIX paths alike', () => {
    expect(projectFromCwd('C:\\work\\shareWork')).toBe('shareWork');
    expect(projectFromCwd('/home/o/projects/shareWork')).toBe('shareWork');
    expect(projectFromCwd('/trailing/slash/')).toBe('slash');
    expect(projectFromCwd('')).toBeNull();
  });
});

describe('permission requests', () => {
  it('create -> pending row with derived project and JSON tool input', () => {
    const row = createPermissionRequest(
      db,
      {
        sessionId: 's-1',
        cwd: 'C:\\work\\proj',
        toolName: 'Bash',
        toolInput: { command: 'git push' },
        source: 'resolver',
      },
      T0,
    );
    expect(row.status).toBe('pending');
    expect(row.project).toBe('proj');
    const json = permissionToJson(row);
    expect(json.toolInput).toEqual({ command: 'git push' });
    expect(json.createdAt).toBe(T0);
  });

  it('decide allows only pending rows; a second decide reports the conflict', () => {
    const row = createPermissionRequest(
      db,
      { sessionId: 's-1', cwd: '/p', toolName: 'WebFetch', source: 'resolver' },
      T0,
    );
    const decided = decidePermissionRequest(db, row.id, { behavior: 'deny', message: 'nope' }, T0);
    expect(decided?.status).toBe('denied');
    expect(decided?.decision_message).toBe('nope');

    expect(decidePermissionRequest(db, row.id, { behavior: 'allow' }, T0)).toBeUndefined();
    expect(expirePermissionRequest(db, row.id, T0)).toBeUndefined();
  });

  it('expireStalePending flips only pending rows older than the TTL', () => {
    const stale = createPermissionRequest(
      db,
      { sessionId: 's-1', cwd: '/p', toolName: 'Bash', source: 'resolver' },
      '2026-07-06T09:00:00.000Z',
    );
    const fresh = createPermissionRequest(
      db,
      { sessionId: 's-2', cwd: '/p', toolName: 'Bash', source: 'resolver' },
      '2026-07-06T09:59:30.000Z',
    );
    const decided = createPermissionRequest(
      db,
      { sessionId: 's-3', cwd: '/p', toolName: 'Bash', source: 'resolver' },
      '2026-07-06T08:00:00.000Z',
    );
    decidePermissionRequest(db, decided.id, { behavior: 'allow' }, '2026-07-06T08:00:10.000Z');

    const flipped = expireStalePending(db, T0, 10 * 60_000);
    expect(flipped).toBe(1);
    expect(getPermissionRequest(db, stale.id)?.status).toBe('expired');
    expect(getPermissionRequest(db, fresh.id)?.status).toBe('pending');
    expect(getPermissionRequest(db, decided.id)?.status).toBe('allowed');
  });

  it('list filters by status, newest first', () => {
    createPermissionRequest(db, { sessionId: 'a', cwd: '/p', toolName: 'X', source: 'hook' }, '2026-07-06T09:00:00.000Z');
    createPermissionRequest(db, { sessionId: 'b', cwd: '/p', toolName: 'Y', source: 'resolver' }, '2026-07-06T09:30:00.000Z');
    const pending = listPermissionRequests(db, { status: 'pending' });
    expect(pending.map((r) => r.session_id)).toEqual(['b', 'a']);
    expect(listPermissionRequests(db)).toHaveLength(2);
  });
});

describe('agent questions', () => {
  it('stores kind/message and derives project', () => {
    const { row, created } = createAgentQuestion(
      db,
      { sessionId: 's-1', cwd: '/home/o/proj', kind: 'agent_needs_input', message: 'Which env?' },
      T0,
    );
    expect(created).toBe(true);
    expect(row.status).toBe('open');
    expect(row.project).toBe('proj');
  });

  it('dedupes identical OPEN questions; re-creates after ack', () => {
    const input = { sessionId: 's-1', cwd: '/p', kind: 'permission_prompt', message: 'Bash needs approval' };
    const first = createAgentQuestion(db, input, T0);
    const dupe = createAgentQuestion(db, input, T0);
    expect(dupe.created).toBe(false);
    expect(dupe.row.id).toBe(first.row.id);
    expect(listAgentQuestions(db, { status: 'open' })).toHaveLength(1);

    expect(ackAgentQuestion(db, first.row.id, T0)?.status).toBe('acknowledged');
    expect(ackAgentQuestion(db, first.row.id, T0)).toBeUndefined();

    const again = createAgentQuestion(db, input, T0);
    expect(again.created).toBe(true);
  });
});
