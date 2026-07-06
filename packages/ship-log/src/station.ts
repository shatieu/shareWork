import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import {
  DECK_CLIENT_HEADER,
  hookEventEnvelopeSchema,
  type HostContext,
  type StationDescriptor,
} from 'suite-conventions';
import { openShipLogDb, listEntries, type EntryRow } from './db.js';
import { createCaptureContext, sweepOrphans, type CaptureContext } from './capture.js';
import { ingestEnvelope } from './ingest.js';
import { drainSpool, spoolPending } from './spool.js';
import { buildRollup, getStoredRollup } from './rollup.js';
import { defaultRollupSummarizer, defaultSummarizer } from './summarize.js';
import { shipLogDbPath } from './db.js';

export interface ShipLogStationOptions {
  /** Home-directory override for `~/.ship/*` -- tests never touch the real home. */
  homeDir?: string;
  summarizer?: Parameters<typeof createCaptureContext>[1];
  rollupSummarizer?: typeof defaultRollupSummarizer;
  now?: () => Date;
  fragmentPolicy?: 'changed-only' | 'always';
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
          void ingestEnvelope(captureCtx, envelope, homeDir).catch((err) => {
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
        try {
          await ingestEnvelope(captureCtx, envelope, homeDir);
          return reply.code(202).send({ queued: false });
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
            await ingestEnvelope(captureCtx, raw, homeDir);
          }, homeDir); // plan §3.7
          await sweepOrphans(captureCtx); // orphan sweep before rollup build, plan §3.8
          const row = await buildRollup({ db, date: request.params.date, summarizer: rollupSummarizer, now });
          return row;
        },
      );

      app.get('/api/ship-log/health', async () => ({
        ok: true,
        dbPath: shipLogDbPath(homeDir),
        spoolPending: spoolPending(homeDir),
      }));
    },

    async start(_ctx: HostContext) {
      await drainSpool(async (raw) => {
        await ingestEnvelope(captureCtx, raw, homeDir);
      }, homeDir);
      await sweepOrphans(captureCtx);
    },

    async stop() {
      db.close();
    },

    contracts: {
      /** In-process contract for the console package (9) -- `HostContext.getContract('ship-log',
       * 'getRollup')`. Kept as a plain function reference, never the db itself. */
      getRollup: (date: string) => getStoredRollup(db, date),
    },
  };

  return station;
}
