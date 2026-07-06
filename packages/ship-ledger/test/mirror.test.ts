import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HookEventEnvelope } from 'suite-conventions';
import { listItems, openShipLedgerDb, stageProgressFor } from '../src/db.js';
import { mirrorTaskEvent } from '../src/mirror.js';

let fakeHome: string;
let db: Database.Database;

const T0 = '2026-07-06T10:00:00.000Z';
const T1 = '2026-07-06T11:00:00.000Z';

/** The empirically verified 2.1.201 stdin shape for TaskCreated/TaskCompleted (report
 * 04-bridge-phase1-researcher.md R1) wrapped in the emit.mjs wire envelope. */
function taskEnvelope(
  event: 'TaskCreated' | 'TaskCompleted',
  sessionId: string,
  taskId: string,
  fields: Record<string, unknown> = {},
): HookEventEnvelope {
  return {
    v: 1,
    hook_event_name: event,
    session_id: sessionId,
    cwd: 'C:\\repos\\live-proof-alpha',
    emitted_at: T0,
    payload: {
      session_id: sessionId,
      prompt_id: 'p-1',
      transcript_path: 'C:\\Users\\x\\t.jsonl',
      cwd: 'C:\\repos\\live-proof-alpha',
      hook_event_name: event,
      task_id: taskId,
      ...fields,
    },
  };
}

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'ship-ledger-mirror-test-'));
  db = openShipLedgerDb(fakeHome);
});

afterEach(() => {
  db.close();
  rmSync(fakeHome, { recursive: true, force: true });
});

describe('mirrorTaskEvent', () => {
  it('TaskCreated inserts a native-mirror item with subject/description/project mapped', () => {
    const row = mirrorTaskEvent(
      db,
      taskEnvelope('TaskCreated', 's-1', '1', {
        task_subject: 'Wire the ledger',
        task_description: 'Do the thing end to end',
      }),
      T0,
    )!;
    expect(row.source).toBe('native-mirror');
    expect(row.title).toBe('Wire the ledger');
    expect(row.spec_md).toBe('Do the thing end to end');
    expect(row.project).toBe('live-proof-alpha');
    expect(row.status).toBe('open');
    expect(row.native_session_id).toBe('s-1');
    expect(row.native_task_id).toBe('1');
    expect(JSON.parse(row.session_refs_json)).toEqual(['s-1']);
  });

  it('TaskCompleted flips the mirrored item to done / stage 100', () => {
    mirrorTaskEvent(db, taskEnvelope('TaskCreated', 's-1', '1', { task_subject: 'T' }), T0);
    const done = mirrorTaskEvent(db, taskEnvelope('TaskCompleted', 's-1', '1'), T1)!;
    expect(done.status).toBe('done');
    expect(done.stage_progress).toBe(100);
    expect(done.updated_at).toBe(T1);
    expect(listItems(db)).toHaveLength(1);
  });

  it('duplicate TaskCreated (spool re-delivery) is idempotent -- no second item, created_at preserved', () => {
    const first = mirrorTaskEvent(
      db,
      taskEnvelope('TaskCreated', 's-1', '1', { task_subject: 'v1' }),
      T0,
    )!;
    const again = mirrorTaskEvent(
      db,
      taskEnvelope('TaskCreated', 's-1', '1', { task_subject: 'v2 refreshed' }),
      T1,
    )!;
    expect(listItems(db)).toHaveLength(1);
    expect(again.id).toBe(first.id);
    expect(again.created_at).toBe(T0);
    expect(again.title).toBe('v2 refreshed');
  });

  it('a duplicate TaskCreated does not clobber a status a human/agent already advanced', () => {
    const row = mirrorTaskEvent(db, taskEnvelope('TaskCreated', 's-1', '1'), T0)!;
    db.prepare("UPDATE items SET status = 'in_progress' WHERE id = ?").run(row.id);
    const again = mirrorTaskEvent(db, taskEnvelope('TaskCreated', 's-1', '1'), T1)!;
    expect(again.status).toBe('in_progress');
  });

  it('TaskCompleted without a prior TaskCreated inserts directly as done (degraded, never dropped)', () => {
    const row = mirrorTaskEvent(
      db,
      taskEnvelope('TaskCompleted', 's-2', '3', { task_subject: 'Orphan finish' }),
      T1,
    )!;
    expect(row.status).toBe('done');
    expect(row.stage_progress).toBe(stageProgressFor('done'));
    expect(row.native_task_id).toBe('3');
  });

  it('same task_id in two different sessions produces two distinct items', () => {
    mirrorTaskEvent(db, taskEnvelope('TaskCreated', 's-1', '1'), T0);
    mirrorTaskEvent(db, taskEnvelope('TaskCreated', 's-2', '1'), T0);
    expect(listItems(db)).toHaveLength(2);
  });

  it('missing subject degrades to a placeholder title; identity-less events are swallowed', () => {
    const row = mirrorTaskEvent(db, taskEnvelope('TaskCreated', 's-1', '7'), T0)!;
    expect(row.title).toBe('Native task 7');

    const envelope = taskEnvelope('TaskCreated', 's-1', '9');
    envelope.payload = { ...envelope.payload, task_id: undefined };
    envelope.session_id = '';
    delete (envelope.payload as Record<string, unknown>).session_id;
    expect(mirrorTaskEvent(db, envelope, T0)).toBeUndefined();
    expect(listItems(db)).toHaveLength(1);
  });
});
