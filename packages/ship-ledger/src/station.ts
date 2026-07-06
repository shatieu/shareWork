import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
  DECK_CLIENT_HEADER,
  DIFFICULTIES,
  type HookEventConsumer,
  type HookEventEnvelope,
  type HostContext,
  type StationDescriptor,
} from 'suite-conventions';
import {
  createItem,
  getItem,
  itemToJson,
  listItems,
  openShipLedgerDb,
  shipLedgerDbPath,
  updateItem,
  LEDGER_PRIORITIES,
  LEDGER_SOURCES,
  LEDGER_STATUSES,
  type ItemJson,
  type LedgerSource,
  type LedgerStatus,
} from './db.js';
import { mirrorTaskEvent, MIRROR_EVENTS } from './mirror.js';

export interface ShipLedgerStationOptions {
  /** Home-directory override for `~/.ship/ledger.db` -- tests never touch the real home. */
  homeDir?: string;
  now?: () => Date;
}

export interface ShipLedgerStation extends StationDescriptor {
  /** Exposed for the standalone `ship-ledger` bin and tests -- the same db handle the routes
   * use. */
  readonly db: Database.Database;
}

const statusEnum = z.enum(LEDGER_STATUSES);
const priorityEnum = z.enum(LEDGER_PRIORITIES);
const sourceEnum = z.enum(LEDGER_SOURCES);
const difficultyEnum = z.enum(DIFFICULTIES);

const createBodySchema = z.object({
  title: z.string().min(1),
  specMd: z.string().optional(),
  project: z.string().nullish(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  /** HTTP callers are UIs and services (Ship_Spec §3) -- default source is 'human'; agents
   * write through MCP where the default is 'agent'. */
  source: sourceEnum.optional(),
  sessionRefs: z.array(z.string()).optional(),
  difficulty: difficultyEnum.nullish(),
  remainingGuessH: z.number().nonnegative().nullish(),
});

const patchBodySchema = z.object({
  title: z.string().min(1).optional(),
  specMd: z.string().optional(),
  project: z.string().nullish(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  difficulty: difficultyEnum.nullish(),
  remainingGuessH: z.number().nonnegative().nullish(),
  addSessionRef: z.string().optional(),
});

/**
 * ship-ledger as a mounted Deck station (plan 05). No `tab` -- the ledger is headless in phase
 * 2 (the console package renders it, Ship_Spec §8). Routes under `/api/ship-ledger/*`;
 * mutations require the `x-ship-deck` local-client header (the hull's CSRF posture).
 *
 * Contracts:
 *  - `hookEventConsumer` (HOOK_EVENT_CONSUMER_CONTRACT): receives TaskCreated/TaskCompleted
 *    envelopes from ship-log's ingest path and mirrors them into the ledger (Ship_Spec §3;
 *    single transport, in-process fan-out).
 *  - `listItems`: read seam for the console package (9).
 */
export function createShipLedgerStation(
  options: ShipLedgerStationOptions = {},
): ShipLedgerStation {
  const homeDir = options.homeDir;
  const db = openShipLedgerDb(homeDir);
  const now = options.now ?? (() => new Date());

  const hookEventConsumer: HookEventConsumer = {
    events: MIRROR_EVENTS,
    consume(envelope: HookEventEnvelope) {
      mirrorTaskEvent(db, envelope, now().toISOString());
    },
  };

  const station: ShipLedgerStation = {
    name: 'ship-ledger',
    db,

    registerRoutes(app: FastifyInstance, _ctx: HostContext) {
      app.get<{ Querystring: { project?: string; status?: string; source?: string } }>(
        '/api/ship-ledger/items',
        async (request, reply) => {
          const statusFilter = request.query.status;
          const sourceFilter = request.query.source;
          if (statusFilter && !statusEnum.safeParse(statusFilter).success) {
            return reply.code(400).send({ error: `invalid status '${statusFilter}'` });
          }
          if (sourceFilter && !sourceEnum.safeParse(sourceFilter).success) {
            return reply.code(400).send({ error: `invalid source '${sourceFilter}'` });
          }
          const rows = listItems(db, {
            project: request.query.project,
            status: statusFilter as LedgerStatus | undefined,
            source: sourceFilter as LedgerSource | undefined,
          });
          return rows.map(itemToJson);
        },
      );

      app.get<{ Params: { id: string } }>(
        '/api/ship-ledger/items/:id',
        async (request, reply) => {
          const row = getItem(db, request.params.id);
          if (!row) return reply.code(404).send({ error: 'no such item' });
          return itemToJson(row);
        },
      );

      app.post('/api/ship-ledger/items', async (request, reply) => {
        if (request.headers[DECK_CLIENT_HEADER] === undefined) {
          return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
        }
        const parsed = createBodySchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: parsed.error.message });
        }
        const body = parsed.data;
        const row = createItem(
          db,
          {
            title: body.title,
            specMd: body.specMd,
            project: body.project ?? null,
            status: body.status,
            priority: body.priority,
            source: body.source ?? 'human',
            sessionRefs: body.sessionRefs,
            difficulty: body.difficulty ?? null,
            remainingGuessH: body.remainingGuessH ?? null,
          },
          now().toISOString(),
        );
        const json: ItemJson = itemToJson(row);
        return reply.code(201).send(json);
      });

      app.patch<{ Params: { id: string } }>(
        '/api/ship-ledger/items/:id',
        async (request, reply) => {
          if (request.headers[DECK_CLIENT_HEADER] === undefined) {
            return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
          }
          const parsed = patchBodySchema.safeParse(request.body);
          if (!parsed.success) {
            return reply.code(400).send({ error: parsed.error.message });
          }
          const body = parsed.data;
          const row = updateItem(
            db,
            request.params.id,
            {
              title: body.title,
              specMd: body.specMd,
              project: body.project === undefined ? undefined : body.project,
              status: body.status,
              priority: body.priority,
              difficulty: body.difficulty === undefined ? undefined : body.difficulty,
              remainingGuessH:
                body.remainingGuessH === undefined ? undefined : body.remainingGuessH,
              addSessionRef: body.addSessionRef,
            },
            now().toISOString(),
          );
          if (!row) return reply.code(404).send({ error: 'no such item' });
          return itemToJson(row);
        },
      );

      app.get('/api/ship-ledger/health', async () => ({
        ok: true,
        dbPath: shipLedgerDbPath(homeDir),
        itemCount: (db.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number }).n,
      }));
    },

    async stop() {
      db.close();
    },

    contracts: {
      hookEventConsumer,
      /** In-process read seam for the console package (9). */
      listItems: (filter?: Parameters<typeof listItems>[1]) =>
        listItems(db, filter).map(itemToJson),
    },
  };

  return station;
}
