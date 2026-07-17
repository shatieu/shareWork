import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  DECK_CLIENT_HEADER,
  voyageAddItemInputSchema,
  voyageFileSchema,
  type VoyageAddItemInput,
  type VoyageItem,
} from 'suite-conventions';

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

/** Thrown by `addItem` when the CURRENT file fails to read/parse: writing then would clobber a
 * human's half-finished hand edit with server state (wave2-D honesty rule -- never write from a
 * stale snapshot). Routes map it to 409. */
export class VoyageFileConflictError extends Error {
  constructor(file: string, cause: string) {
    super(`refusing to add item: ${file} currently fails to parse (${cause}) -- fix the file by hand first`);
    this.name = 'VoyageFileConflictError';
  }
}

export interface VoyageBackend {
  /** The SSE handler body (hijack + snapshot push + heartbeat) -- route paths are owned by the
   * manager so one backend can serve both the bare back-compat path and its /:project path. */
  handleSse(request: FastifyRequest, reply: FastifyReply): void;
  /** Read-modify-rename append against the FILE (never the snapshot): fresh read, schema parse
   * (looseObject preserves unknown fields through re-serialize), append with server-assigned
   * id/status/stage_progress/updated_at, atomic temp+rename write. The chokidar watch survives
   * the rename-over (awaitWriteFinish) and broadcasts the update -- no manual snapshot mutation.
   * Throws {@link VoyageFileConflictError} when the current file fails to parse. */
  addItem(input: VoyageAddItemInput, now: Date): VoyageItem;
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
 * One Voyage data source (plan 03 §4.3): one JSON file (mission `progress.json`) served as a
 * snapshot + live-pushed over SSE. Parse-tolerant by design; `source: 'mission'` is stamped on
 * every item -- the future ship-ledger source will stamp `'ledger'` into the same shape (plan §2,
 * designed-for-not-built). Entirely self-contained per file -- the multi-project manager below
 * holds N instances.
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

    // Bare-Fastify SSE (researcher R4): hijack() halts the normal lifecycle, then the raw
    // response is ours. Fastify v5 defaults (requestTimeout 0, keepAliveTimeout between
    // requests only) never kill an in-flight SSE response; the heartbeat keeps middleboxes
    // happy and the socket non-idle.
    handleSse(request: FastifyRequest, reply: FastifyReply): void {
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
    },

    addItem(input: VoyageAddItemInput, now: Date): VoyageItem {
      let parsed;
      try {
        parsed = voyageFileSchema.parse(JSON.parse(readFileSync(voyageFile, 'utf8')));
      } catch (err) {
        throw new VoyageFileConflictError(voyageFile, (err as Error).message.split('\n')[0]);
      }
      let maxId = 0;
      for (const item of parsed.packages) {
        if (typeof item.id === 'number' && Number.isFinite(item.id) && item.id > maxId) maxId = item.id;
      }
      const item: VoyageItem = {
        id: maxId + 1,
        title: input.title,
        status: 'pending',
        stage_progress: 0,
        difficulty: input.difficulty ?? null,
        remaining_guess_h: null,
        updated_at: now.toISOString(),
        ...(input.note !== undefined && input.note !== '' ? { note: input.note } : {}),
      };
      parsed.packages.push(item);
      // Atomic temp+rename in the same directory; the temp sibling is invisible to the
      // single-file watch, and the rename-over is exactly what awaitWriteFinish tolerates.
      const tmp = `${voyageFile}.tmp-${process.pid}-${Date.now()}`;
      writeFileSync(tmp, JSON.stringify(parsed, null, 2), 'utf8');
      renameSync(tmp, voyageFile);
      return item;
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

/* ── multi-project manager (wave2-D) ─────────────────────────────────── */

/** Where a chartroom-registered repo's own progress file lives (in-repo `.ship/` state dir
 * convention, same family as `.ship/lookout/`). Missing file = project absent, not an error. */
export const REPO_VOYAGE_RELPATH = join('.ship', 'voyage', 'progress.json');

/** The key the explicit `--voyage` file is registered under (and the bare back-compat routes
 * alias to). */
export const DEFAULT_VOYAGE_PROJECT = 'default';

/** Shape of chartroom's `listRepoDirs` in-process contract. */
export interface VoyageRepoDir {
  id: string;
  name: string;
  absPath: string;
}

export interface VoyageProjectInfo {
  id: string;
  name: string;
  file: string;
  isDefault: boolean;
}

export interface VoyageManagerOptions {
  /** The explicit/default `--voyage` file, registered as project `default`. */
  defaultFile: string;
  /** Live registered-repo list (chartroom's `listRepoDirs` contract), resolved lazily on every
   * rescan so live-registered repos appear without a restart. Absent = default project only. */
  listRepoDirs?: () => VoyageRepoDir[];
  /** Clock seam for add-item `updated_at` stamps (tests inject a fixed clock). */
  clock?: () => Date;
}

/**
 * The hull's Voyage front (wave2-D): a Map of per-file backends -- the `--voyage` file as project
 * `default` plus one per chartroom-registered repo that HAS `<repo>/.ship/voyage/progress.json`.
 * Routes are registered ONCE (Fastify routes are fixed after listen); per-project lookups resolve
 * against the live map, and `/api/voyage/projects` re-scans the repo list cheaply per call.
 * Bare `/api/voyage` + `/api/voyage/events` stay aliased to `default` for back-compat.
 */
export interface VoyageManager {
  register(app: FastifyInstance): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

interface ProjectEntry {
  name: string;
  file: string;
  isDefault: boolean;
  backend: VoyageBackend;
}

export function createVoyageManager(options: VoyageManagerOptions): VoyageManager {
  const clock = options.clock ?? ((): Date => new Date());
  const entries = new Map<string, ProjectEntry>();
  entries.set(DEFAULT_VOYAGE_PROJECT, {
    name: DEFAULT_VOYAGE_PROJECT,
    file: options.defaultFile,
    isDefault: true,
    backend: createVoyageBackend(options.defaultFile),
  });
  let started = false;

  /** Cheap re-scan: existsSync per registered repo. Adds newly-appeared projects (starting their
   * watcher when the manager is live) and drops projects whose file or registration vanished.
   * The default entry is never dropped -- it was explicitly configured. */
  async function rescan(): Promise<void> {
    const repos = options.listRepoDirs?.() ?? [];
    const seen = new Set<string>([DEFAULT_VOYAGE_PROJECT]);
    for (const repo of repos) {
      if (repo.id === DEFAULT_VOYAGE_PROJECT) continue; // the default key is reserved
      seen.add(repo.id);
      const file = join(repo.absPath, REPO_VOYAGE_RELPATH);
      const existing = entries.get(repo.id);
      if (existsSync(file)) {
        if (!existing) {
          const backend = createVoyageBackend(file);
          entries.set(repo.id, { name: repo.name, file, isDefault: false, backend });
          if (started) await backend.start();
        }
      } else if (existing) {
        await existing.backend.stop();
        entries.delete(repo.id);
      }
    }
    for (const [key, entry] of entries) {
      if (!entry.isDefault && !seen.has(key)) {
        await entry.backend.stop();
        entries.delete(key);
      }
    }
  }

  /** Map lookup with one rescan on miss -- a repo project hit directly (deep link) before any
   * /projects call still resolves. */
  async function resolveEntry(project: string): Promise<ProjectEntry | undefined> {
    const direct = entries.get(project);
    if (direct) return direct;
    await rescan();
    return entries.get(project);
  }

  function listProjects(): VoyageProjectInfo[] {
    return [...entries.entries()].map(([id, entry]) => ({
      id,
      name: entry.name,
      file: entry.file,
      isDefault: entry.isDefault,
    }));
  }

  const defaultEntry = (): ProjectEntry => entries.get(DEFAULT_VOYAGE_PROJECT) as ProjectEntry;

  return {
    register(app: FastifyInstance): void {
      // Back-compat aliases for the default project -- the Deck's tab probe and old deep links.
      app.get('/api/voyage', async () => defaultEntry().backend.current());
      app.get('/api/voyage/events', (request, reply) => {
        defaultEntry().backend.handleSse(request, reply);
      });

      app.get('/api/voyage/projects', async () => {
        await rescan();
        return listProjects();
      });

      app.get<{ Params: { project: string } }>('/api/voyage/:project', async (request, reply) => {
        const entry = await resolveEntry(request.params.project);
        if (!entry) return reply.code(404).send({ error: `unknown voyage project '${request.params.project}'` });
        return entry.backend.current();
      });

      app.get<{ Params: { project: string } }>('/api/voyage/:project/events', async (request, reply) => {
        const entry = await resolveEntry(request.params.project);
        if (!entry) return reply.code(404).send({ error: `unknown voyage project '${request.params.project}'` });
        entry.backend.handleSse(request, reply);
      });

      app.post<{ Params: { project: string } }>('/api/voyage/:project/items', async (request, reply) => {
        // Mutating route -> Deck CSRF header required, same rail as every station's writes.
        if (request.headers[DECK_CLIENT_HEADER] === undefined) {
          return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
        }
        const entry = await resolveEntry(request.params.project);
        if (!entry) return reply.code(404).send({ error: `unknown voyage project '${request.params.project}'` });
        const body = voyageAddItemInputSchema.safeParse(request.body ?? {});
        if (!body.success) {
          const detail = body.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
          return reply.code(400).send({ error: `invalid item: ${detail}` });
        }
        try {
          const item = entry.backend.addItem(body.data, clock());
          return reply.code(201).send({ item });
        } catch (err) {
          if (err instanceof VoyageFileConflictError) {
            return reply.code(409).send({ error: err.message });
          }
          throw err;
        }
      });
    },

    async start(): Promise<void> {
      started = true;
      for (const entry of entries.values()) {
        await entry.backend.start();
      }
      // Initial repo scan AFTER started=true so discovered backends start their watchers.
      await rescan();
    },

    async stop(): Promise<void> {
      started = false;
      for (const entry of entries.values()) {
        await entry.backend.stop();
      }
    },
  };
}
