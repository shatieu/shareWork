import { readFileSync, statSync } from 'node:fs';
import { watch, type FSWatcher } from 'chokidar';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { voyageFileSchema, type VoyageItem } from 'suite-conventions';

/** `GET /api/voyage` response shape (the UI contract, plan 03 §4.3). */
export interface VoyageResponse {
  file: string;
  updatedAt: string;
  /** true when the file is currently unreadable/unparsable and `packages` is the last-good
   * snapshot (or empty if there never was one) -- the UI shows a staleness hint, never an error
   * page, because a half-written progress.json is a normal transient. */
  stale?: boolean;
  packages: VoyageItem[];
}

export interface VoyageBackend {
  register(app: FastifyInstance): void;
  /** Starts the single-file chokidar watch (researcher R5: survives atomic rename-over on
   * Windows with awaitWriteFinish; recreate-after-delete arrives as 'change' -- listen on 'all').
   * Resolves once the watcher is READY and a post-ready re-load has run -- a rename-over that
   * lands before chokidar's 'ready' fires NO event at all (verified empirically on Windows), so
   * the post-ready re-load is what closes that startup race. */
  start(): Promise<void>;
  /** Ends open SSE responses explicitly (researcher R4: deterministic teardown) + closes the watch. */
  stop(): Promise<void>;
  /** Test seam: current parsed snapshot. */
  current(): VoyageResponse;
}

const SSE_HEARTBEAT_MS = 25_000;

/**
 * The hull's Voyage data source (plan 03 §4.3): one JSON file (mission `progress.json`) served as
 * `GET /api/voyage` + live-pushed over `GET /api/voyage/events` (SSE). Parse-tolerant by design;
 * `source: 'mission'` is stamped on every item -- the future ship-ledger source will stamp
 * `'ledger'` into the same shape (plan §2, designed-for-not-built).
 */
export function createVoyageBackend(voyageFile: string): VoyageBackend {
  let snapshot: VoyageResponse = { file: voyageFile, updatedAt: new Date().toISOString(), stale: true, packages: [] };
  let watcher: FSWatcher | undefined;
  const sseClients = new Set<FastifyReply>();

  function load(): void {
    try {
      const raw = readFileSync(voyageFile, 'utf8');
      const parsed = voyageFileSchema.parse(JSON.parse(raw));
      let updatedAt: string;
      try {
        updatedAt = statSync(voyageFile).mtime.toISOString();
      } catch {
        updatedAt = new Date().toISOString();
      }
      snapshot = {
        file: voyageFile,
        updatedAt,
        packages: parsed.packages.map((item) => ({ ...item, source: item.source ?? 'mission' })),
      };
    } catch {
      // Unreadable or half-written (e.g. mid-rename): keep serving the last-good packages,
      // flagged stale. Never throw on a read path.
      snapshot = { ...snapshot, stale: true };
    }
  }

  function broadcast(): void {
    const data = `event: voyage\ndata: ${JSON.stringify(snapshot)}\n\n`;
    for (const reply of sseClients) {
      try {
        reply.raw.write(data);
      } catch {
        sseClients.delete(reply);
      }
    }
  }

  return {
    current(): VoyageResponse {
      return snapshot;
    },

    register(app: FastifyInstance): void {
      app.get('/api/voyage', async () => snapshot);

      // Bare-Fastify SSE (researcher R4): hijack() halts the normal lifecycle, then the raw
      // response is ours. Fastify v5 defaults (requestTimeout 0, keepAliveTimeout between
      // requests only) never kill an in-flight SSE response; the heartbeat keeps middleboxes
      // happy and the socket non-idle.
      app.get('/api/voyage/events', (request, reply) => {
        reply.hijack();
        reply.raw.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        reply.raw.write(`event: voyage\ndata: ${JSON.stringify(snapshot)}\n\n`);
        sseClients.add(reply);

        const heartbeat = setInterval(() => {
          try {
            reply.raw.write(': hb\n\n');
          } catch {
            /* cleanup happens on 'close' */
          }
        }, SSE_HEARTBEAT_MS);
        heartbeat.unref();

        // NOTE for test authors: light-my-request's injected stream does NOT propagate a client
        // destroy() to this 'close' handler (researcher R4) -- disconnect-cleanup tests must use
        // a real ephemeral listen. Do not "simplify" that test back to inject().
        request.raw.on('close', () => {
          clearInterval(heartbeat);
          sseClients.delete(reply);
        });
      });
    },

    async start(): Promise<void> {
      load();
      watcher = watch(voyageFile, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
      });
      // 'all' on purpose: chokidar v4 reports recreate-after-delete of a directly-watched file
      // as 'change' (not 'add') -- treat every event kind identically (researcher R5).
      watcher.on('all', () => {
        load();
        broadcast();
      });
      await new Promise<void>((resolve) => watcher?.once('ready', () => resolve()));
      // A mutation between the initial load above and 'ready' fires no event -- re-load once now
      // so the served snapshot can never be pre-ready stale.
      load();
      broadcast();
    },

    async stop(): Promise<void> {
      for (const reply of sseClients) {
        try {
          reply.raw.end();
        } catch {
          /* already gone */
        }
      }
      sseClients.clear();
      if (watcher) {
        await watcher.close();
        watcher = undefined;
      }
    },
  };
}
