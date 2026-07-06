import { z } from 'zod';

/**
 * Suite-wide hook-event shapes (Ship_Spec §2: the plugin installs http hooks for
 * `PermissionRequest`, `Notification`, `Stop`, `SessionStart/End`, `TaskCreated/TaskCompleted`).
 *
 * These are the *suite's own envelope convention* that packages 4-6 (ledger/inbox/console) build
 * against -- a stable common core (event name, session id, project, cwd, ISO timestamp) plus a
 * per-event payload. Claude Code's raw hook JSON carries more fields and evolves with the CLI;
 * every schema here is `.loose()` on purpose so real hook payloads with extra fields always
 * validate -- consumers read the guaranteed core and pass the rest through untouched.
 */

const eventCore = {
  /** Claude Code session id the event originated from. */
  sessionId: z.string(),
  /** Project directory name/label when known (hooks are installed per-project by the plugin). */
  project: z.string().optional(),
  /** Absolute working directory of the session. */
  cwd: z.string().optional(),
  /** ISO-8601 timestamp (the receiver stamps its own clock when the hook payload has none). */
  timestamp: z.string(),
};

export const permissionRequestEventSchema = z
  .looseObject({
    ...eventCore,
    event: z.literal('PermissionRequest'),
    payload: z
      .looseObject({
        /** e.g. 'Bash', 'Write', an MCP tool name... */
        toolName: z.string(),
        /** Raw tool input the permission prompt is about. */
        toolInput: z.unknown().optional(),
        /** Correlates the eventual approve/deny response back to the live prompt. */
        requestId: z.string().optional(),
      }),
  });

export const notificationEventSchema = z
  .looseObject({
    ...eventCore,
    event: z.literal('Notification'),
    payload: z
      .looseObject({
        /** e.g. 'agent_needs_input' (Ship_Spec §5). */
        kind: z.string(),
        message: z.string().optional(),
      }),
  });

export const stopEventSchema = z
  .looseObject({
    ...eventCore,
    event: z.literal('Stop'),
    payload: z
      .looseObject({
        /** last assistant message / stop reason when the hook provides one. */
        reason: z.string().optional(),
      })
      .optional(),
  });

export const sessionStartEventSchema = z
  .looseObject({
    ...eventCore,
    event: z.literal('SessionStart'),
    payload: z
      .looseObject({
        model: z.string().optional(),
        source: z.string().optional(),
      })
      .optional(),
  });

export const sessionEndEventSchema = z
  .looseObject({
    ...eventCore,
    event: z.literal('SessionEnd'),
    payload: z
      .looseObject({
        reason: z.string().optional(),
      })
      .optional(),
  });

/** Native Agent Teams task mirror events (Ship_Spec §3: mirrored in, never written back). */
export const taskCreatedEventSchema = z
  .looseObject({
    ...eventCore,
    event: z.literal('TaskCreated'),
    payload: z
      .looseObject({
        taskId: z.string(),
        subject: z.string().optional(),
        assignee: z.string().optional(),
      }),
  });

export const taskCompletedEventSchema = z
  .looseObject({
    ...eventCore,
    event: z.literal('TaskCompleted'),
    payload: z
      .looseObject({
        taskId: z.string(),
        outcome: z.string().optional(),
      }),
  });

export const shipHookEventSchema = z.discriminatedUnion('event', [
  permissionRequestEventSchema,
  notificationEventSchema,
  stopEventSchema,
  sessionStartEventSchema,
  sessionEndEventSchema,
  taskCreatedEventSchema,
  taskCompletedEventSchema,
]);

/**
 * The raw wire envelope (Bridge phase 1, package 4 §3.2/§0.2): what `plugins/crew/hooks/emit.mjs`
 * actually POSTs to `/api/ship-log/events` (and appends to the spool on failure) -- one JSON
 * object per Claude Code hook invocation, built directly from the *real* installed-CLI stdin
 * shape (verified empirically, report `04-bridge-phase1-researcher.md` R1: snake_case field
 * names, `hook_event_name` not `event`, no guaranteed `project`). This is a **different, lower
 * layer than `ShipHookEvent` above** -- that union is the suite's already-normalized envelope
 * convention (camelCase core + typed payload) that packages 5-6 consume; this one is the
 * untouched wire shape ship-log's ingest route validates before it does any of its own
 * normalization. Both are additive; neither replaces the other.
 *
 * `.looseObject()` on purpose: the CLI's hook JSON carries more fields than these and evolves
 * across versions (R1's inventory lists 29 event names total; phase 1 only registers a subset) --
 * unknown fields must always pass through untouched rather than fail validation.
 */
export const hookEventEnvelopeSchema = z.looseObject({
  /** Envelope format version -- bump only on a breaking wire-shape change. */
  v: z.literal(1),
  /** Raw Claude Code hook name, e.g. 'SessionStart', 'Stop', 'SessionEnd' (R1 inventory; not
   * every name in R1's 29-event list is registered by the Crew plugin in phase 1). */
  hook_event_name: z.string(),
  session_id: z.string(),
  transcript_path: z.string().optional(),
  cwd: z.string(),
  /** Receiver-independent capture timestamp the emitter stamps (ISO-8601) -- distinct from any
   * timestamp the raw payload itself may or may not carry. */
  emitted_at: z.string(),
  /** The full raw hook stdin JSON, forwarded verbatim -- nothing is dropped even for event names
   * ship-log doesn't yet understand (those land in the `events_unknown` sidecar, plan §3.5). */
  payload: z.record(z.string(), z.unknown()),
});

export type HookEventEnvelope = z.infer<typeof hookEventEnvelopeSchema>;

export type PermissionRequestEvent = z.infer<typeof permissionRequestEventSchema>;
export type NotificationEvent = z.infer<typeof notificationEventSchema>;
export type StopEvent = z.infer<typeof stopEventSchema>;
export type SessionStartEvent = z.infer<typeof sessionStartEventSchema>;
export type SessionEndEvent = z.infer<typeof sessionEndEventSchema>;
export type TaskCreatedEvent = z.infer<typeof taskCreatedEventSchema>;
export type TaskCompletedEvent = z.infer<typeof taskCompletedEventSchema>;
export type ShipHookEvent = z.infer<typeof shipHookEventSchema>;
