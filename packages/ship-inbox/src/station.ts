import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  DECK_CLIENT_HEADER,
  type HookEventConsumer,
  type HookEventEnvelope,
  type HostContext,
  type StationDescriptor,
} from 'suite-conventions';
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
  questionToJson,
  shipInboxDbPath,
  DEFAULT_PENDING_TTL_MS,
  PERMISSION_STATUSES,
  QUESTION_STATUSES,
  type PermissionStatus,
  type QuestionStatus,
} from './db.js';
import { applyAlwaysAllowRule, SettingsWriteError } from './settings-writer.js';
import { createDecisionWaiters } from './waiters.js';

export interface ShipInboxStationOptions {
  /** Home-directory override for `~/.ship/inbox.db` -- tests never touch the real home. */
  homeDir?: string;
  now?: () => Date;
  /** Lazy-expiry TTL for pending permission requests (default 10 min). */
  pendingTtlMs?: number;
}

export interface ShipInboxStation extends StationDescriptor {
  /** Exposed for the standalone `ship-inbox` bin and tests -- the same db handle the routes
   * use. */
  readonly db: Database.Database;
}

/** Long-poll ceiling per request -- the resolver loops for longer waits (plan 06 §1.1). */
const MAX_WAIT_MS = 30_000;

const statusEnum = z.enum(PERMISSION_STATUSES);
const questionStatusEnum = z.enum(QUESTION_STATUSES);

const createPermissionBodySchema = z.object({
  sessionId: z.string(),
  cwd: z.string(),
  toolName: z.string().min(1),
  toolInput: z.unknown().optional(),
});

const decisionBodySchema = z.object({
  behavior: z.enum(['allow', 'deny']),
  message: z.string().max(2000).optional(),
  /** Present = also write this native rule into the request's project settings (the FO-named
   * risk path; see settings-writer.ts). The CLIENT composes the rule (the UI pre-fills a
   * suggestion) -- the server validates shape and applies it additively/atomically. */
  alwaysAllowRule: z.string().min(1).max(500).optional(),
});

/** Chart Room inbox item shape as served by `getContract('chartroom', 'listInbox')` -- typed
 * loosely here on purpose: ship-inbox forwards these untouched to the Deck page and must not
 * depend on chartroom's internals (Ship_Spec §2 discipline rule). */
type ChartroomInboxItem = Record<string, unknown>;

/**
 * ship-inbox as a mounted Deck station (Ship_Spec §5, plan 06 §1.1). Owns the Deck's Inbox tab.
 * Routes under `/api/ship-inbox/*`; mutations require the `x-ship-deck` local-client header
 * (the hull's CSRF posture).
 *
 * Contracts:
 *  - `hookEventConsumer`: claims Notification (-> agent questions) and PermissionRequest
 *    (-> record-only pending items) envelopes from ship-log's ingest fan-out.
 *  - `pendingCounts`: badge seam for the console package (9).
 */
export function createShipInboxStation(options: ShipInboxStationOptions = {}): ShipInboxStation {
  const homeDir = options.homeDir;
  const db = openShipInboxDb(homeDir);
  const now = options.now ?? (() => new Date());
  const nowIso = (): string => now().toISOString();
  const ttlMs = options.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;
  const waiters = createDecisionWaiters();

  const pendingCounts = (): { permissionsPending: number; questionsOpen: number } => {
    expireStalePending(db, nowIso(), ttlMs);
    return {
      permissionsPending: listPermissionRequests(db, { status: 'pending' }).length,
      questionsOpen: listAgentQuestions(db, { status: 'open' }).length,
    };
  };

  const hookEventConsumer: HookEventConsumer = {
    events: ['Notification', 'PermissionRequest'],
    consume(envelope: HookEventEnvelope) {
      const payload = envelope.payload as Record<string, unknown>;
      if (envelope.hook_event_name === 'Notification') {
        // Every Notification is stored (nothing silently dropped once this station claims the
        // event away from ship-log's unknown sidecar); the UI decides what to surface.
        createAgentQuestion(
          db,
          {
            sessionId: envelope.session_id,
            cwd: envelope.cwd,
            kind: String(payload.notification_type ?? 'unknown'),
            message: String(payload.message ?? ''),
          },
          nowIso(),
        );
      } else if (envelope.hook_event_name === 'PermissionRequest') {
        // Over the ingest transport there is no live hook process long-polling for the answer,
        // so this is a record-only queue item ('hook' source) -- the live-resolvable path is
        // the resolver's own POST (source 'resolver').
        createPermissionRequest(
          db,
          {
            sessionId: envelope.session_id,
            cwd: envelope.cwd,
            toolName: String(payload.tool_name ?? 'Unknown'),
            toolInput: payload.tool_input,
            source: 'hook',
          },
          nowIso(),
        );
      }
    },
  };

  const station: ShipInboxStation = {
    name: 'ship-inbox',
    tab: { id: 'inbox', title: 'Inbox' },
    db,

    registerRoutes(app: FastifyInstance, ctx: HostContext) {
      /* ── permission queue ── */

      app.post('/api/ship-inbox/permissions', async (request, reply) => {
        if (request.headers[DECK_CLIENT_HEADER] === undefined) {
          return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
        }
        const parsed = createPermissionBodySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: parsed.error.message });
        }
        const row = createPermissionRequest(db, { ...parsed.data, source: 'resolver' }, nowIso());
        return reply.code(201).send(permissionToJson(row));
      });

      app.get<{ Querystring: { status?: string } }>(
        '/api/ship-inbox/permissions',
        async (request, reply) => {
          const statusFilter = request.query.status;
          if (statusFilter && !statusEnum.safeParse(statusFilter).success) {
            return reply.code(400).send({ error: `invalid status '${statusFilter}'` });
          }
          expireStalePending(db, nowIso(), ttlMs);
          return listPermissionRequests(db, {
            status: statusFilter as PermissionStatus | undefined,
          }).map(permissionToJson);
        },
      );

      // The resolver hook's long-poll: parks up to min(waitMs, 30s), returns the current status
      // either way. GET + no header -- read-only, safe, and the resolver keeps zero state.
      app.get<{ Params: { id: string }; Querystring: { waitMs?: string } }>(
        '/api/ship-inbox/permissions/:id/decision',
        async (request, reply) => {
          const row = getPermissionRequest(db, request.params.id);
          if (!row) return reply.code(404).send({ error: 'no such permission request' });

          const answer = (current: typeof row) => ({
            status: current.status,
            behavior:
              current.status === 'allowed' ? 'allow' : current.status === 'denied' ? 'deny' : undefined,
            message: current.decision_message ?? undefined,
          });

          if (row.status !== 'pending') return answer(row);

          const waitMs = Math.min(Math.max(Number(request.query.waitMs) || 0, 0), MAX_WAIT_MS);
          if (waitMs > 0) {
            await waiters.wait(row.id, waitMs);
          }
          const fresh = getPermissionRequest(db, row.id) ?? row;
          return answer(fresh);
        },
      );

      app.post<{ Params: { id: string } }>(
        '/api/ship-inbox/permissions/:id/decision',
        async (request, reply) => {
          if (request.headers[DECK_CLIENT_HEADER] === undefined) {
            return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
          }
          const parsed = decisionBodySchema.safeParse(request.body);
          if (!parsed.success) {
            return reply.code(400).send({ error: parsed.error.message });
          }
          const body = parsed.data;

          expireStalePending(db, nowIso(), ttlMs);
          const row = getPermissionRequest(db, request.params.id);
          if (!row) return reply.code(404).send({ error: 'no such permission request' });
          if (row.status !== 'pending') {
            return reply.code(409).send({ error: `already ${row.status}` });
          }

          // "Always allow" runs FIRST: if the native-rule write fails, no decision is recorded
          // and the human retries (or decides without the rule) -- a decision that claims a rule
          // it never wrote would be a lie (plan 06 §1.1).
          let ruleBackupPath: string | undefined;
          if (body.alwaysAllowRule !== undefined) {
            if (body.behavior !== 'allow') {
              return reply.code(400).send({ error: 'alwaysAllowRule requires behavior "allow"' });
            }
            try {
              const result = applyAlwaysAllowRule({
                projectDir: row.cwd,
                rule: body.alwaysAllowRule,
                now,
              });
              ruleBackupPath = result.backupPath;
            } catch (err) {
              if (err instanceof SettingsWriteError) {
                const status = err.code === 'invalid-rule' ? 400 : 500;
                return reply.code(status).send({ error: err.message, code: err.code });
              }
              throw err;
            }
          }

          const decided = decidePermissionRequest(
            db,
            row.id,
            {
              behavior: body.behavior,
              message: body.message,
              alwaysAllowRule: body.alwaysAllowRule,
              ruleBackupPath,
            },
            nowIso(),
          );
          if (!decided) return reply.code(409).send({ error: 'already decided' });
          waiters.notify(row.id);
          return permissionToJson(decided);
        },
      );

      // The resolver's own timeout report: flip pending -> expired so the page never shows an
      // actionable Allow for a prompt whose hook has already given up (fail-open at the CLI).
      app.post<{ Params: { id: string } }>(
        '/api/ship-inbox/permissions/:id/expire',
        async (request, reply) => {
          if (request.headers[DECK_CLIENT_HEADER] === undefined) {
            return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
          }
          const row = expirePermissionRequest(db, request.params.id, nowIso());
          if (!row) {
            const current = getPermissionRequest(db, request.params.id);
            if (!current) return reply.code(404).send({ error: 'no such permission request' });
            return reply.code(409).send({ error: `already ${current.status}` });
          }
          waiters.notify(row.id);
          return permissionToJson(row);
        },
      );

      /* ── agent questions ── */

      app.get<{ Querystring: { status?: string } }>(
        '/api/ship-inbox/questions',
        async (request, reply) => {
          const statusFilter = request.query.status;
          if (statusFilter && !questionStatusEnum.safeParse(statusFilter).success) {
            return reply.code(400).send({ error: `invalid status '${statusFilter}'` });
          }
          return listAgentQuestions(db, {
            status: statusFilter as QuestionStatus | undefined,
          }).map(questionToJson);
        },
      );

      app.post<{ Params: { id: string } }>(
        '/api/ship-inbox/questions/:id/ack',
        async (request, reply) => {
          if (request.headers[DECK_CLIENT_HEADER] === undefined) {
            return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
          }
          const row = ackAgentQuestion(db, request.params.id, nowIso());
          if (!row) return reply.code(404).send({ error: 'no such open question' });
          return questionToJson(row);
        },
      );

      /* ── the one page (Ship_Spec §5) ── */

      app.get('/api/ship-inbox/items', async () => {
        expireStalePending(db, nowIso(), ttlMs);
        const listInbox = ctx.getContract<() => ChartroomInboxItem[]>('chartroom', 'listInbox');
        return {
          permissions: listPermissionRequests(db, { status: 'pending' }).map(permissionToJson),
          questions: listAgentQuestions(db, { status: 'open' }).map(questionToJson),
          // Feature-unavailable = empty, never an error (HostContext contract rule).
          docs: listInbox ? listInbox() : [],
        };
      });

      app.get('/api/ship-inbox/summary', async () => {
        const counts = pendingCounts();
        const listInbox = ctx.getContract<() => ChartroomInboxItem[]>('chartroom', 'listInbox');
        const docsOpen = listInbox ? listInbox().length : 0;
        return {
          ...counts,
          docsOpen,
          total: counts.permissionsPending + counts.questionsOpen + docsOpen,
        };
      });

      app.get('/api/ship-inbox/health', async () => ({
        ok: true,
        dbPath: shipInboxDbPath(homeDir),
        parkedWaiters: waiters.size(),
        ...pendingCounts(),
      }));
    },

    async stop() {
      db.close();
    },

    contracts: {
      hookEventConsumer,
      /** Badge seam for the console package (9). */
      pendingCounts,
    },
  };

  return station;
}
