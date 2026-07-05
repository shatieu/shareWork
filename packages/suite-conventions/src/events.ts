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

export type PermissionRequestEvent = z.infer<typeof permissionRequestEventSchema>;
export type NotificationEvent = z.infer<typeof notificationEventSchema>;
export type StopEvent = z.infer<typeof stopEventSchema>;
export type SessionStartEvent = z.infer<typeof sessionStartEventSchema>;
export type SessionEndEvent = z.infer<typeof sessionEndEventSchema>;
export type TaskCreatedEvent = z.infer<typeof taskCreatedEventSchema>;
export type TaskCompletedEvent = z.infer<typeof taskCompletedEventSchema>;
export type ShipHookEvent = z.infer<typeof shipHookEventSchema>;
