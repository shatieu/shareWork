import { basename } from 'node:path';
import type Database from 'better-sqlite3';
import type { HookEventEnvelope } from 'suite-conventions';
import { createItem, findMirrorItem, updateItem, type ItemRow } from './db.js';

/**
 * Native Agent Teams task mirroring (Ship_Spec §3: task files "are mirrored in via
 * TaskCreated/TaskCompleted hooks -- never written back"). This module is the only ledger writer
 * for `source='native-mirror'` items and has NO code path that touches `~/.claude/tasks/` --
 * the never-write-back guarantee is structural, not a convention.
 *
 * Payload shape is the empirically verified 2.1.201 stdin JSON (report
 * 04-bridge-phase1-researcher.md R1): `{task_id, task_subject, task_description}` plus the
 * common fields; Anthropic documents no schema for these events, so every field is read
 * defensively -- a missing subject degrades to a placeholder title, never a dropped event.
 */

export const MIRROR_EVENTS = ['TaskCreated', 'TaskCompleted'] as const;

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Project label for a mirrored item: the session's directory basename (same convention as
 * ship-log's `project` column -- the two stores must agree so the console can join them). */
function projectFromCwd(cwd: string | undefined): string | null {
  if (!cwd) return null;
  const base = basename(cwd);
  return base.length > 0 ? base : null;
}

/**
 * Route one TaskCreated/TaskCompleted envelope into the ledger. Idempotent per (session, task):
 * a duplicate TaskCreated (spool re-delivery) updates subject/description without clobbering
 * `created_at`; a TaskCompleted for a task whose TaskCreated was never seen (hooks installed
 * mid-session, spool loss) inserts the item directly as done -- degraded, never dropped.
 */
export function mirrorTaskEvent(
  db: Database.Database,
  envelope: HookEventEnvelope,
  at: string,
): ItemRow | undefined {
  const payload = envelope.payload as Record<string, unknown>;
  const sessionId = str(payload.session_id) ?? envelope.session_id;
  const taskId = str(payload.task_id);
  if (!sessionId || !taskId) {
    // Unmirrorable without an identity -- nothing sensible to store. The caller's ingest path
    // treats a throw as undelivered (HTTP 500 -> emitter spools), but an identity-less event
    // will never gain one, so swallow it instead of poisoning the spool forever.
    return undefined;
  }

  const subject = str(payload.task_subject);
  const description = str(payload.task_description);
  const existing = findMirrorItem(db, sessionId, taskId);

  if (envelope.hook_event_name === 'TaskCreated') {
    if (existing) {
      // Duplicate delivery (spool drain after a slow 202, hull restart) -- refresh mutable
      // fields only; created_at and any human/agent edits to status survive.
      return updateItem(
        db,
        existing.id,
        {
          title: subject ?? existing.title,
          specMd: description ?? existing.spec_md,
        },
        at,
      );
    }
    return createItem(
      db,
      {
        title: subject ?? `Native task ${taskId}`,
        specMd: description ?? '',
        project: projectFromCwd(envelope.cwd),
        status: 'open',
        source: 'native-mirror',
        sessionRefs: [sessionId],
        nativeSessionId: sessionId,
        nativeTaskId: taskId,
      },
      at,
    );
  }

  // TaskCompleted
  if (existing) {
    return updateItem(
      db,
      existing.id,
      {
        status: 'done',
        title: subject ?? existing.title,
        specMd: description ?? existing.spec_md,
      },
      at,
    );
  }
  return createItem(
    db,
    {
      title: subject ?? `Native task ${taskId}`,
      specMd: description ?? '',
      project: projectFromCwd(envelope.cwd),
      status: 'done',
      source: 'native-mirror',
      sessionRefs: [sessionId],
      nativeSessionId: sessionId,
      nativeTaskId: taskId,
    },
    at,
  );
}
