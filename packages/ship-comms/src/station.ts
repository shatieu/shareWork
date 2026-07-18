import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { DECK_CLIENT_HEADER, type HostContext, type StationDescriptor } from 'suite-conventions';
import {
  countUndelivered,
  createMessage,
  listHistory,
  messageToJson,
  openShipCommsDb,
  pollMessages,
  shipCommsDbPath,
  type MessageJson,
} from './db.js';
import { createMessageWaiters } from './waiters.js';

/** Long-poll ceiling per request -- longer waits are the poller's loop (ship-inbox convention). */
const MAX_WAIT_MS = 30_000;

/** Claude Code session ids are UUIDs; a UUID-shaped `to` is taken as an EXACT session id and
 * stored verbatim (store-and-forward -- no liveness check, delivery happens whenever that
 * session next polls). Anything else is a NAME, resolved against the live fleet. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sendBodySchema = z.object({
  from: z.string().min(1).max(500).optional(),
  to: z.string().min(1).max(500),
  text: z.string().min(1).max(20_000),
});

/** The fleetSource contract shape (typed locally -- stations never import sibling internals). */
interface FleetSessionLike {
  sessionId: string;
  name?: string;
  cwd?: string;
}
interface FleetSourceLike {
  list(): Promise<FleetSessionLike[] | null>;
}

function tokensOf(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Token-scored fuzzy name resolution -- the same scoring as ship-voice's resolveSessionName
 * (fleet.ts), literal-duplicated on purpose per the stations-never-import-siblings rule; ties
 * surface as candidates, never a guess (the honest-ambiguity posture wave2-E proved). */
function resolveByName(
  query: string,
  sessions: FleetSessionLike[],
): { match?: FleetSessionLike; candidates: FleetSessionLike[] } {
  const queryTokens = tokensOf(query);
  if (queryTokens.length === 0) return { candidates: [] };

  const scored = sessions
    .map((session) => {
      const haystack = new Set([
        ...tokensOf(session.name ?? ''),
        ...tokensOf(session.cwd?.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''),
      ]);
      const hits = queryTokens.filter((t) => haystack.has(t)).length;
      return { session, score: hits / queryTokens.length };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return { candidates: [] };
  const best = scored[0].score;
  const top = scored.filter((s) => s.score === best);
  if (top.length === 1) return { match: top[0].session, candidates: [top[0].session] };
  return { candidates: top.map((s) => s.session) };
}

function candidateLabel(session: FleetSessionLike): string {
  return session.name ?? session.cwd?.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? session.sessionId;
}

export type SendResolvedVia = 'exact-id' | 'name';

export type SendOutcome =
  | { ok: true; message: MessageJson; resolvedVia: SendResolvedVia }
  | { ok: false; status: 404 | 409 | 503; error: string; candidates?: string[] };

export interface SendInput {
  from?: string;
  to: string;
  text: string;
}

export interface ShipCommsStationOptions {
  /** Home-directory override for `~/.ship/ship-comms.db` -- tests never touch the real home. */
  homeDir?: string;
  now?: () => Date;
}

export interface ShipCommsStation extends StationDescriptor {
  readonly db: Database.Database;
}

/**
 * ship-comms as a headless Deck station (agent-comms plan §4 Option A): a durable point-to-point
 * message store with pull delivery. Routes under `/api/ship-comms/*`; EVERY route requires the
 * `x-ship-deck` local-client header -- messages are session-addressed data, so even reads are
 * gated (stricter than sibling GET conventions, on purpose).
 *
 * Contracts:
 *  - `sendMessage(input)`: in-process send for sibling stations -- same resolution + store path
 *    as the HTTP route, no HTTP needed.
 */
export function createShipCommsStation(options: ShipCommsStationOptions = {}): ShipCommsStation {
  const homeDir = options.homeDir;
  const db = openShipCommsDb(homeDir);
  const now = options.now ?? (() => new Date());
  const nowIso = (): string => now().toISOString();
  const waiters = createMessageWaiters();

  /** ctx is late-bound in registerRoutes so the sendMessage contract can resolve names through
   * the fleetSource contract; the hull registers every station's routes before serving anything,
   * so consumers never see the unbound state in practice. */
  let hostCtx: HostContext | undefined;

  const send = async (input: SendInput): Promise<SendOutcome> => {
    let toSession: string;
    let resolvedVia: SendResolvedVia;

    if (UUID_RE.test(input.to)) {
      toSession = input.to;
      resolvedVia = 'exact-id';
    } else {
      const fleetSource = hostCtx?.getContract<FleetSourceLike>('ship-voice', 'fleetSource');
      if (!fleetSource) {
        return {
          ok: false,
          status: 503,
          error: 'name addressing needs the fleet, and ship-voice is not aboard -- use an exact session id',
        };
      }
      let sessions: FleetSessionLike[] | null = null;
      try {
        sessions = await fleetSource.list();
      } catch {
        sessions = null;
      }
      if (sessions === null) {
        return { ok: false, status: 503, error: 'the fleet is unreadable right now -- use an exact session id' };
      }
      const { match, candidates } = resolveByName(input.to, sessions);
      if (!match) {
        if (candidates.length > 1) {
          return {
            ok: false,
            status: 409,
            error: `ambiguous session name '${input.to}' -- more than one match`,
            candidates: candidates.map(candidateLabel),
          };
        }
        return { ok: false, status: 404, error: `no live session matches '${input.to}'` };
      }
      toSession = match.sessionId;
      resolvedVia = 'name';
    }

    const row = createMessage(
      db,
      { fromSession: input.from ?? 'unknown', toSession, text: input.text },
      nowIso(),
    );
    waiters.notify(toSession);
    return { ok: true, message: messageToJson(row), resolvedVia };
  };

  const station: ShipCommsStation = {
    name: 'ship-comms',
    db,

    registerRoutes(app: FastifyInstance, ctx: HostContext) {
      hostCtx = ctx;

      const requireDeckHeader = (headers: Record<string, unknown>): boolean =>
        headers[DECK_CLIENT_HEADER] !== undefined;

      app.post('/api/ship-comms/send', async (request, reply) => {
        if (!requireDeckHeader(request.headers)) {
          return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
        }
        const parsed = sendBodySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: parsed.error.message });
        }
        const outcome = await send(parsed.data);
        if (!outcome.ok) {
          return reply.code(outcome.status).send({
            error: outcome.error,
            ...(outcome.candidates ? { candidates: outcome.candidates } : {}),
          });
        }
        return reply.code(201).send({ ...outcome.message, resolvedVia: outcome.resolvedVia });
      });

      app.get<{ Querystring: { session?: string; waitMs?: string } }>(
        '/api/ship-comms/poll',
        async (request, reply) => {
          if (!requireDeckHeader(request.headers)) {
            return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
          }
          const session = request.query.session;
          if (!session) return reply.code(400).send({ error: 'session query parameter required' });

          let rows = pollMessages(db, session, nowIso());
          const waitMs = Math.min(Math.max(Number(request.query.waitMs) || 0, 0), MAX_WAIT_MS);
          if (rows.length === 0 && waitMs > 0) {
            await waiters.wait(session, waitMs);
            rows = pollMessages(db, session, nowIso());
          }
          return { session, messages: rows.map(messageToJson) };
        },
      );

      app.get<{ Querystring: { session?: string } }>(
        '/api/ship-comms/history',
        async (request, reply) => {
          if (!requireDeckHeader(request.headers)) {
            return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
          }
          const session = request.query.session;
          if (!session) return reply.code(400).send({ error: 'session query parameter required' });
          return { session, messages: listHistory(db, session).map(messageToJson) };
        },
      );

      app.get('/api/ship-comms/health', async (request, reply) => {
        if (!requireDeckHeader(request.headers)) {
          return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
        }
        return {
          ok: true,
          dbPath: shipCommsDbPath(homeDir),
          parkedWaiters: waiters.size(),
          undelivered: countUndelivered(db),
        };
      });
    },

    async stop() {
      db.close();
    },

    contracts: {
      /** In-process send for sibling stations (same resolution + store + waiter-wake path as
       * the HTTP route). */
      sendMessage: send,
    },
  };

  return station;
}
