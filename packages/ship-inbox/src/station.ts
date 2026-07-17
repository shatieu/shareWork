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
  getAgentQuestion,
  getPermissionRequest,
  listAgentQuestions,
  listAlwaysAllowedRules,
  listPermissionRequests,
  openShipInboxDb,
  permissionToJson,
  questionToJson,
  respondAgentQuestion,
  shipInboxDbPath,
  DEFAULT_PENDING_TTL_MS,
  PERMISSION_STATUSES,
  QUESTION_STATUSES,
  type PermissionStatus,
  type QuestionStatus,
} from './db.js';
import {
  isValidAskHumanSessionId,
  listAskHumanSessions,
  readAskHumanSpec,
  writeAskHumanAnswers,
  type AskHumanAnswerInput,
} from './askhuman.js';
import { applyAlwaysAllowRule, SettingsWriteError } from './settings-writer.js';
import { createDecisionWaiters } from './waiters.js';

/** Outcome of one text-to-session delivery attempt. `delivered` is honest spawn-level truth:
 * the transport is ship-voice's fire-and-forget `claude -p <text> --resume <sessionId>`, which
 * appends to the session's TRANSCRIPT (picked up on resume / a headless sibling turn) -- it is
 * NOT mid-task injection into the running interactive session (agent-comms plan §1.2/§3). */
export interface SessionDelivery {
  delivered: boolean;
  detail?: string;
}

/** Transport seam (wave2-E findings §c recommendation): every respond/send path goes through
 * `deliver(sessionId, text)` so the transcript-resume transport can be swapped for a real
 * mid-task channel (agent-comms plan Option A) without touching routes or callers. */
export type SessionDeliverer = (sessionId: string, text: string) => Promise<SessionDelivery>;

export interface ShipInboxStationOptions {
  /** Home-directory override for `~/.ship/inbox.db` -- tests never touch the real home. */
  homeDir?: string;
  now?: () => Date;
  /** Lazy-expiry TTL for pending permission requests (default 10 min). */
  pendingTtlMs?: number;
  /** Delivery-transport override (tests / future comms station). Default: resolve the exact
   * sessionId against the `ship-voice.fleetSource` contract, then inject the sibling's own
   * `/api/ship-voice/send_to_session` route (ship-voice's inject-vs-HTTP convention). */
  deliver?: SessionDeliverer;
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

const respondBodySchema = z.object({
  text: z.string().min(1).max(20_000),
});

const sendBodySchema = z.object({
  text: z.string().min(1).max(20_000),
});

const askHumanAnswersBodySchema = z.object({
  cwd: z.string().min(1),
  session: z.string().min(1).max(200),
  answers: z
    .array(
      z.object({
        id: z.string().min(1),
        type: z.string().min(1),
        value: z.union([z.string(), z.number(), z.array(z.string())]),
        attachments: z
          .array(z.object({ filename: z.string().optional(), dataUrl: z.string().optional() }))
          .optional(),
      }),
    )
    .min(1),
});

/** Last path segment of a cwd (both separators) -- the fallback fleet address for a nameless
 * session, mirroring ship-voice's speakable-name derivation. */
function folderOf(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  const folder = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return folder && folder.length > 0 ? folder : undefined;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** The fleetSource contract shape (typed locally -- stations never import sibling internals). */
interface FleetSessionLike {
  sessionId: string;
  name?: string;
  cwd?: string;
}

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
      /**
       * Default transport: exact-sessionId resolution against `ship-voice.fleetSource`, then an
       * inject call to the sibling's `/api/ship-voice/send_to_session`. The sibling route
       * addresses by fuzzy NAME only, so the exact session's own name (else its cwd folder) is
       * passed -- a tie among same-named sessions surfaces as an honest 'ambiguous' failure
       * rather than a misdelivery. Swappable via options.deliver (findings §c: keep the
       * transport behind a deliver(sessionId, text) seam).
       */
      const deliver: SessionDeliverer =
        options.deliver ??
        (async (sessionId, text) => {
          const fleetSource = ctx.getContract<{ list(): Promise<FleetSessionLike[] | null> }>(
            'ship-voice',
            'fleetSource',
          );
          if (!fleetSource) {
            return { delivered: false, detail: 'ship-voice is not aboard (no fleet access)' };
          }
          let sessions: FleetSessionLike[] | null = null;
          try {
            sessions = await fleetSource.list();
          } catch {
            sessions = null;
          }
          if (sessions === null) return { delivered: false, detail: 'the fleet is unreadable right now' };
          const target = sessions.find((session) => session.sessionId === sessionId);
          if (!target) return { delivered: false, detail: 'session is not in the live fleet' };
          const name = target.name ?? folderOf(target.cwd);
          if (!name) return { delivered: false, detail: 'session has no addressable name' };

          const res = await app.inject({
            method: 'POST',
            url: '/api/ship-voice/send_to_session',
            headers: { host: '127.0.0.1', [DECK_CLIENT_HEADER]: '1' },
            payload: { name, text },
          });
          if (res.statusCode === 200) return { delivered: true };
          if (res.statusCode === 409) {
            return { delivered: false, detail: `ambiguous session name '${name}' -- more than one match` };
          }
          if (res.statusCode === 404) {
            return { delivered: false, detail: `no ship-voice send route, or '${name}' resolved to nothing` };
          }
          return { delivered: false, detail: `send_to_session answered ${res.statusCode}` };
        });

      /** Every delivery answer the Deck sees carries the transport truth label. */
      const deliveryJson = (delivery: SessionDelivery) => ({
        ...delivery,
        transport: 'transcript-resume' as const,
      });

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

          // Deny reasons (defect D2): the PermissionRequest hook's decision JSON is
          // behavior-only -- verified against the hooks docs 2026-07-17
          // (code.claude.com/docs/en/hooks.md#PermissionRequest: `decision` carries `behavior`
          // + optional `updatedInput`, no reason/message field; PreToolUse's
          // `permissionDecisionReason` has no counterpart here). So the note is delivered to
          // the session's TRANSCRIPT via the deliver seam instead, and the outcome is reported
          // honestly, never assumed.
          let messageDelivery: ReturnType<typeof deliveryJson> | undefined;
          if (body.behavior === 'deny' && body.message) {
            messageDelivery = deliveryJson(
              await deliver(
                row.session_id,
                `The captain denied your "${row.tool_name}" permission request with this note: ${body.message}`,
              ),
            );
          }
          return { ...permissionToJson(decided), ...(messageDelivery ? { messageDelivery } : {}) };
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

      // Defect D1 (wave2-E): questions become answerable. The reply is stored on the row AND
      // delivered to the asking session via the deliver seam. The emitting Notification hook is
      // long gone (fire-and-forget), so delivery goes to the session's transcript -- stored
      // either way; a failed delivery is reported, never hidden (the reply survives on the row).
      app.post<{ Params: { id: string } }>(
        '/api/ship-inbox/questions/:id/respond',
        async (request, reply) => {
          if (request.headers[DECK_CLIENT_HEADER] === undefined) {
            return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
          }
          const parsed = respondBodySchema.safeParse(request.body);
          if (!parsed.success) {
            return reply.code(400).send({ error: parsed.error.message });
          }
          const row = getAgentQuestion(db, request.params.id);
          if (!row) return reply.code(404).send({ error: 'no such question' });
          if (row.status !== 'open') {
            return reply.code(409).send({ error: `already ${row.status}` });
          }

          const delivery = await deliver(
            row.session_id,
            `Captain's reply from the Ship inbox (re: "${clip(row.message, 160)}"): ${parsed.data.text}`,
          );
          const updated = respondAgentQuestion(
            db,
            row.id,
            { text: parsed.data.text, delivered: delivery.delivered },
            nowIso(),
          );
          if (!updated) return reply.code(409).send({ error: 'already decided' });
          return { ...questionToJson(updated), delivery: deliveryJson(delivery) };
        },
      );

      /* ── free-text send to any tracked session (defect D4: session-shaped, not row-shaped) ── */

      app.post<{ Params: { sessionId: string } }>(
        '/api/ship-inbox/sessions/:sessionId/send',
        async (request, reply) => {
          if (request.headers[DECK_CLIENT_HEADER] === undefined) {
            return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
          }
          const parsed = sendBodySchema.safeParse(request.body);
          if (!parsed.success) {
            return reply.code(400).send({ error: parsed.error.message });
          }
          const delivery = await deliver(request.params.sessionId, parsed.data.text);
          if (!delivery.delivered) {
            return reply
              .code(502)
              .send({ error: delivery.detail ?? 'delivery failed', ...deliveryJson(delivery) });
          }
          return { sessionId: request.params.sessionId, ...deliveryJson(delivery) };
        },
      );

      /* ── ask-human bridge (wave2-E item 4): list/read specs, write byte-compatible answers ──
       * All three carry the deck header (the GETs too -- they read filesystem paths taken from
       * the query string, same guarded-family posture as the hull's /api/fs routes). */

      app.get<{ Querystring: { cwd?: string } }>('/api/ship-inbox/askhuman', async (request, reply) => {
        if (request.headers[DECK_CLIENT_HEADER] === undefined) {
          return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
        }
        const cwd = request.query.cwd;
        if (!cwd) return reply.code(400).send({ error: 'cwd query parameter required' });
        return { cwd, sessions: listAskHumanSessions(cwd) };
      });

      app.get<{ Querystring: { cwd?: string; session?: string } }>(
        '/api/ship-inbox/askhuman/spec',
        async (request, reply) => {
          if (request.headers[DECK_CLIENT_HEADER] === undefined) {
            return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
          }
          const { cwd, session } = request.query;
          if (!cwd || !session) {
            return reply.code(400).send({ error: 'cwd and session query parameters required' });
          }
          if (!isValidAskHumanSessionId(session)) {
            return reply.code(400).send({ error: `invalid session id '${session}'` });
          }
          const questions = readAskHumanSpec(cwd, session);
          if (!questions) return reply.code(404).send({ error: 'no valid spec.json for that session' });
          return { cwd, sessionId: session, questions };
        },
      );

      app.post('/api/ship-inbox/askhuman/answers', async (request, reply) => {
        if (request.headers[DECK_CLIENT_HEADER] === undefined) {
          return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
        }
        const parsed = askHumanAnswersBodySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: parsed.error.message });
        }
        const { cwd, session, answers } = parsed.data;
        if (!isValidAskHumanSessionId(session)) {
          return reply.code(400).send({ error: `invalid session id '${session}'` });
        }
        if (!readAskHumanSpec(cwd, session)) {
          return reply.code(404).send({ error: 'no valid spec.json for that session' });
        }
        const written = writeAskHumanAnswers(cwd, session, answers as AskHumanAnswerInput[]);
        return { ok: true, path: written.path };
      });

      /* ── the one page (Ship_Spec §5) ── */

      app.get('/api/ship-inbox/items', async () => {
        expireStalePending(db, nowIso(), ttlMs);
        const listInbox = ctx.getContract<() => ChartroomInboxItem[]>('chartroom', 'listInbox');
        const questions = listAgentQuestions(db, { status: 'open' }).map(questionToJson);
        // Pending ask-human forms discoverable from each question's cwd (one filesystem scan per
        // unique cwd; a scan failure means "none", never a 500) -- the Deck links these to the
        // ask-questions page.
        const askHumanByCwd = new Map<string, string[]>();
        for (const question of questions) {
          if (askHumanByCwd.has(question.cwd)) continue;
          let pending: string[] = [];
          try {
            pending = listAskHumanSessions(question.cwd)
              .filter((session) => !session.answered)
              .map((session) => session.sessionId);
          } catch {
            pending = [];
          }
          askHumanByCwd.set(question.cwd, pending);
        }
        return {
          permissions: listPermissionRequests(db, { status: 'pending' }).map(permissionToJson),
          questions: questions.map((question) => ({
            ...question,
            askHumanPending: askHumanByCwd.get(question.cwd) ?? [],
          })),
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
      /** Origin labels for the settings manager (Trio_Specs §B Ship integration): every native
       * always-allow rule this inbox wrote, with cwd + date + backup path. Revocation itself
       * happens through the settings manager's rails, not here. */
      alwaysAllowedRules: () => listAlwaysAllowedRules(db),
    },
  };

  return station;
}
