import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import {
  DECK_CLIENT_HEADER,
  HOOK_EVENT_CONSUMER_CONTRACT,
  hookEventEnvelopeSchema,
  type HookEventConsumer,
  type HostContext,
  type StationDescriptor,
} from 'suite-conventions';
import {
  listEntries,
  listUnwatchedSessionIds,
  openShipLogDb,
  setSessionWatched,
  type EntryRow,
} from './db.js';
import { createCaptureContext, sweepOrphans, type CaptureContext } from './capture.js';
import { ingestEnvelope } from './ingest.js';
import { drainSpool, spoolPending } from './spool.js';
import { buildRollup, getStoredRollup } from './rollup.js';
import { buildRounds, isoDate, runPendingRounds, type RoundsDeps, type RoundsRunResult } from './rounds.js';
import { defaultRollupSummarizer, defaultSummarizer } from './summarize.js';
import { shipLogDbPath } from './db.js';

export interface ShipLogStationOptions {
  /** Home-directory override for `~/.ship/*` -- tests never touch the real home. */
  homeDir?: string;
  summarizer?: Parameters<typeof createCaptureContext>[1];
  rollupSummarizer?: typeof defaultRollupSummarizer;
  now?: () => Date;
  fragmentPolicy?: 'changed-only' | 'always';
  /** Station names probed (lazily, per event) for a `hookEventConsumer` contract -- the
   * in-process fan-out targets for hook events ship-log itself doesn't capture (Bridge phase 2:
   * ship-ledger mirrors TaskCreated/TaskCompleted). Names, not imports: stations never import
   * each other's internals (Ship_Spec §2 discipline rule). */
  consumerStations?: readonly string[];
}

export interface ShipLogStation extends StationDescriptor {
  /** Exposed for the standalone `ship-log` bin and tests -- the same db handle the routes use. */
  readonly db: Database.Database;
  readonly captureCtx: CaptureContext;
}

/**
 * ship-log as a mounted Deck station (plan §3.3). No `tab` -- phase 1 has no Deck UI (console
 * package 9 owns the timeline). Routes registered under `/api/ship-log/*` (plan §3.5);
 * `start()` drains the spool + sweeps orphan sessions; `stop()` closes the db.
 */
export function createShipLogStation(options: ShipLogStationOptions = {}): ShipLogStation {
  const homeDir = options.homeDir;
  const db = openShipLogDb(homeDir);
  const summarizer = options.summarizer ?? defaultSummarizer;
  const rollupSummarizer = options.rollupSummarizer ?? defaultRollupSummarizer;
  const now = options.now ?? (() => new Date());
  const captureCtx = createCaptureContext(db, summarizer, {
    now,
    fragmentPolicy: options.fragmentPolicy,
  });
  // Default fan-out targets: ship-ledger (TaskCreated/TaskCompleted, phase 2) and ship-inbox
  // (Notification/PermissionRequest, phase 3). Names, not imports.
  const consumerStations = options.consumerStations ?? ['ship-ledger', 'ship-inbox'];

  // Chaplain rounds (wave2-J): the daily all-projects digest written to
  // `~/.ship/chaplain/rounds/<date>.md`. Same summarizer knob as the rollup -- one haiku call
  // per rounds run through the identical spawn/fallback posture.
  const roundsDeps: RoundsDeps = { db, summarizer: rollupSummarizer, now, homeDir };
  /** Serializer for rounds runs: concurrent triggers (station start, a SessionEnd capture, the
   * Deck button) queue behind each other, so the file-exists check inside `runPendingRounds`
   * makes the second lazy run a no-op instead of double-spending the day's one haiku call. */
  let roundsChain: Promise<unknown> = Promise.resolve();
  const enqueueRounds = <T,>(job: () => Promise<T>): Promise<T> => {
    const run = roundsChain.then(job);
    roundsChain = run.catch(() => undefined); // the chain survives a failed run
    return run;
  };
  /** Lazy trigger (fire-and-forget: never blocks a hull boot or a capture reply on a summarizer
   * call): first capture/boot of a new day builds the completed prior days' rounds. Chosen over
   * a rounds-read trigger because rounds READS live in the ship hull's chapel backend, which
   * only reaches ship-log via contracts -- capture time is the point where ship-log itself
   * already knows a new day has data. */
  const nudgePendingRounds = (log: (line: string) => void): void => {
    void enqueueRounds(() => runPendingRounds(roundsDeps)).catch((err) => {
      log(`ship-log: rounds run failed: ${(err as Error).message}`);
    });
  };

  /** Resolve the mounted hook-event consumers at call time (never captured at registration:
   * `getContract` searches the hull's full station array, and standalone mode's stub context
   * simply returns undefined -> Task events fall through to the unknown sidecar as in phase 1). */
  const consumersFrom = (ctx: HostContext): HookEventConsumer[] =>
    consumerStations
      .map((name) => ctx.getContract<HookEventConsumer>(name, HOOK_EVENT_CONSUMER_CONTRACT))
      .filter((c): c is HookEventConsumer => c !== undefined);

  const station: ShipLogStation = {
    name: 'ship-log',
    db,
    captureCtx,

    registerRoutes(app: FastifyInstance, ctx: HostContext) {
      app.post('/api/ship-log/events', async (request, reply) => {
        if (request.headers[DECK_CLIENT_HEADER] === undefined) {
          return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
        }
        const parseResult = hookEventEnvelopeSchema.safeParse(request.body);
        if (!parseResult.success) {
          return reply.code(400).send({ error: parseResult.error.message });
        }
        const envelope = parseResult.data;

        if (envelope.hook_event_name === 'SessionEnd') {
          // Slow path only (git delta + transcript read + up-to-60s summarizer call): reply
          // first, capture after (plan §3.5) -- SessionEnd's correctness never depends on WHEN
          // it runs, the session row's snapshot is already frozen.
          reply.code(202).send({ queued: true });
          void ingestEnvelope(captureCtx, envelope, homeDir)
            .then(() => {
              // First capture of a new day lazily builds the completed prior days' rounds
              // (rounds.ts: file-exists check = at-most-once-per-day, so this is a cheap no-op
              // on every same-day capture after the first).
              nudgePendingRounds(ctx.log);
            })
            .catch((err) => {
              ctx.log(`ship-log: async ingest failed: ${(err as Error).message}`);
            });
          return;
        }

        // SessionStart/Stop (and the unknown-event sidecar) are cheap, order-critical writes:
        // process them BEFORE the reply (reviewer finding, 2026-07-06: replying first let the
        // session's own first commit land before the async git snapshot ran, so `head_start`
        // recorded the post-commit HEAD -> empty delta -> silently missing fragment). The sync
        // cost is 1-3 `git rev-parse` spawns (~ms even on huge repos -- rev-parse never scans
        // the working tree) against emit.mjs's 700ms budget; and even a pathological overrun is
        // safe: the emitter times out -> spools -> the next drain re-delivers, and
        // upsertSessionStart preserves the original head_start/started_at on conflict
        // (no clobber, no loss).
        // Task events (TaskCreated/TaskCompleted) ride the same sync path: cheap SQLite writes
        // in the ledger's consumer, and Created->Completed ordering matters.
        try {
          const result = await ingestEnvelope(captureCtx, envelope, homeDir, consumersFrom(ctx));
          return reply.code(202).send({ queued: false, stored: result.stored });
        } catch (err) {
          // Fail loud (non-2xx), not fail-silent: the emitter treats non-2xx as undelivered and
          // spools the event for the next drain instead of losing it behind a lying 202.
          ctx.log(`ship-log: ingest failed: ${(err as Error).message}`);
          return reply.code(500).send({ error: 'ingest failed' });
        }
      });

      app.get<{ Querystring: { date?: string; project?: string } }>(
        '/api/ship-log/entries',
        async (request) => {
          const rows: EntryRow[] = listEntries(db, {
            date: request.query.date,
            project: request.query.project,
          });
          return rows.map((r) => ({
            id: r.id,
            sessionId: r.session_id,
            date: r.date,
            project: r.project,
            repoRoot: r.repo_root,
            branch: r.branch,
            commits: JSON.parse(r.commits_json),
            files: JSON.parse(r.files_json),
            summary: r.summary,
            summaryModel: r.summary_model,
            fragmentPath: r.fragment_path,
            createdAt: r.created_at,
            partial: Boolean(r.partial),
          }));
        },
      );

      app.get<{ Params: { date: string } }>(
        '/api/ship-log/rollup/:date',
        async (request, reply) => {
          const row = getStoredRollup(db, request.params.date);
          if (!row) return reply.code(404).send({ error: 'no rollup for that date' });
          return row;
        },
      );

      app.post<{ Params: { date: string } }>(
        '/api/ship-log/rollup/:date',
        async (request, reply) => {
          if (request.headers[DECK_CLIENT_HEADER] === undefined) {
            return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
          }
          await drainSpool(async (raw) => {
            await ingestEnvelope(captureCtx, raw, homeDir, consumersFrom(ctx));
          }, homeDir); // plan §3.7
          await sweepOrphans(captureCtx); // orphan sweep before rollup build, plan §3.8
          const row = await buildRollup({ db, date: request.params.date, summarizer: rollupSummarizer, now });
          return row;
        },
      );

      // Chaplain rounds run (wave2-J): builds (or rebuilds -- an explicit run always overwrites)
      // the rounds digest for one date, default today. Deck-gated like every mutating route.
      // The Deck reaches this through the chapel backend's proxy (ship hull), which calls the
      // `runRounds` contract below rather than this HTTP leg.
      app.post('/api/ship-log/rounds/run', async (request, reply) => {
        if (request.headers[DECK_CLIENT_HEADER] === undefined) {
          return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
        }
        const body = (request.body ?? {}) as { date?: unknown };
        let date = isoDate(now());
        if (body.date !== undefined) {
          if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
            return reply.code(400).send({ error: 'date must be YYYY-MM-DD' });
          }
          date = body.date;
        }
        return enqueueRounds(() => buildRounds(roundsDeps, date));
      });

      // Fleet-view watch flag (wave2-E): the sessions table is the suite's only persisted
      // session store, so ship-log owns the unwatch/rewatch mutation; fleet views (ship-console
      // overview) consume the hide-list via the listUnwatchedSessionIds contract.
      app.post<{ Params: { sessionId: string } }>(
        '/api/ship-log/sessions/:sessionId/watch',
        async (request, reply) => {
          if (request.headers[DECK_CLIENT_HEADER] === undefined) {
            return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
          }
          const body = request.body as { watched?: unknown } | null;
          if (body === null || typeof body !== 'object' || typeof body.watched !== 'boolean') {
            return reply.code(400).send({ error: 'body must be { watched: boolean }' });
          }
          const row = setSessionWatched(db, request.params.sessionId, body.watched, now().toISOString());
          return { sessionId: row.session_id, watched: row.watched === 1 };
        },
      );

      app.get('/api/ship-log/health', async () => ({
        ok: true,
        dbPath: shipLogDbPath(homeDir),
        spoolPending: spoolPending(homeDir),
      }));
    },

    async start(ctx: HostContext) {
      await drainSpool(async (raw) => {
        await ingestEnvelope(captureCtx, raw, homeDir, consumersFrom(ctx));
      }, homeDir);
      await sweepOrphans(captureCtx);
      // Boot leg of the lazy rounds trigger (a hull booting on a new day is often the first
      // "capture activity" that day). Fire-and-forget: never delays hull start on a haiku call.
      nudgePendingRounds(ctx.log);
    },

    async stop() {
      db.close();
    },

    contracts: {
      /** In-process contract for the console package (9) -- `HostContext.getContract('ship-log',
       * 'getRollup')`. Kept as a plain function reference, never the db itself. */
      getRollup: (date: string) => getStoredRollup(db, date),
      /** Fleet-view hide-list (wave2-E): session ids the human unwatched. Consumed by
       * ship-console's overview filter; plain function, never the db. */
      listUnwatchedSessionIds: () => listUnwatchedSessionIds(db),
      /** Unwatch/rewatch mutation seam for siblings (the HTTP route above is the Deck's leg). */
      setSessionWatched: (sessionId: string, watched: boolean) =>
        setSessionWatched(db, sessionId, watched, now().toISOString()),
      /** Chaplain rounds run (wave2-J), serialized with the lazy trigger. The ship hull's chapel
       * backend proxies its POST /api/chapel/rounds/run through this -- names, not imports. */
      runRounds: (date?: string): Promise<RoundsRunResult> =>
        enqueueRounds(() => buildRounds(roundsDeps, date ?? isoDate(now()))),
    },
  };

  return station;
}
