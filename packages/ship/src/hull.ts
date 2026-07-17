import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  clearHullRegistration,
  isAllowedHostHeader,
  writeHullRegistration,
  type HostContext,
  type StationDescriptor,
} from 'suite-conventions';
import { createChapelBackend } from './chapel.js';
import { createVoyageManager, type VoyageManager, type VoyageRepoDir } from './voyage.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** `ship`'s own `dist/public` -- where `scripts/copy-ui-dist.mjs` copies the built Deck bundle. */
const DEFAULT_UI_DIST_DIR = join(HERE, '..', 'dist', 'public');

export interface HullOptions {
  /** Overrides where the Deck static bundle is served from -- tests point this at a temp/missing
   * directory rather than depending on a built UI. */
  uiDistDir?: string;
  /** Absolute path to a voyage `progress.json`, served as project `default`. Absent = Voyage
   * disabled (`/api/voyage` 404s and the Deck hides the tab). When present, every
   * chartroom-registered repo with `<repo>/.ship/voyage/progress.json` is additionally served as
   * its own voyage project (wave2-D). */
  voyageFile?: string;
  /** Clock seam for voyage add-item `updated_at` stamps (default `() => new Date()`). */
  clock?: () => Date;
  /** Home-directory override for `~/.suite/services.json` AND the Chapel state dir
   * `~/.ship/chaplain` -- tests never touch the real home. */
  homeDir?: string;
  /** Working directory the Chapel's Chaplain session terminal opens in (default `process.cwd()`,
   * which is the repo `ship serve` was started from). */
  repoRoot?: string;
  /** Log sink (default console.log). */
  log?: (line: string) => void;
}

/**
 * The assembled hull (plan 03 §4.3): a Fastify app with every station's routes registered but NOT
 * listening yet -- same testability discipline as chartroom's `buildServer` (tests drive it via
 * `app.inject()`). `start(port)` runs post-listen lifecycle (station watchers/discovery files +
 * the hull's own `~/.suite/services.json` registration); `stop()` unwinds it.
 */
export interface Hull {
  app: FastifyInstance;
  stations: StationDescriptor[];
  /** Post-listen lifecycle: informs the Host guard of the bound port, fans out station
   * `start()`, starts the voyage watcher, writes the services.json hull registration. */
  start(port: number): Promise<void>;
  /** Reverse teardown: stations stopped in reverse mount order, voyage stopped, hull
   * registration cleared. Best-effort; never throws. */
  stop(): Promise<void>;
}

/**
 * Hull factory (Ship_Spec §2 one-hull revision; plan 03 §4.3). Registers, in order:
 *
 * 1. A global `onRequest` Host-allowlist guard -- 403 for any Host header that isn't loopback
 *    (kills DNS rebinding; the FO-approved local security posture together with the serve
 *    command's 127.0.0.1-only bind and the per-route x-ship-deck CSRF header).
 * 2. Deck UI static at `/` (skip-if-absent, same pattern as chartroom).
 * 3. `GET /api/hull/stations` -> `[{ name, tab }]` -- the Deck builds its tab bar from this.
 * 4. Voyage routes (`/api/voyage`, `/api/voyage/events`) when a voyage file is configured.
 * 5. Chapel routes (`/api/chapel/*`) -- ALWAYS registered (confessions must work before the first
 *    chaplain session ever runs); every chapel route requires the x-ship-deck header.
 * 6. Every station's `registerRoutes` (mount order = array order). Duplicate Deck tab ids are a
 *    boot error -- two stations silently sharing a tab is a bug, not a preference.
 */
export async function createHull(stations: StationDescriptor[], options: HullOptions = {}): Promise<Hull> {
  const log = options.log ?? ((line: string) => console.log(line));

  const seenTabs = new Map<string, string>();
  for (const station of stations) {
    if (station.tab) {
      const owner = seenTabs.get(station.tab.id);
      if (owner) {
        throw new Error(
          `ship: duplicate Deck tab id '${station.tab.id}' (stations '${owner}' and '${station.name}')`,
        );
      }
      seenTabs.set(station.tab.id, station.name);
    }
  }

  const app = Fastify({ logger: false });

  let boundPort: number | undefined;
  app.addHook('onRequest', async (request, reply) => {
    if (!isAllowedHostHeader(request.headers.host, boundPort)) {
      return reply.code(403).send({ error: 'forbidden host' });
    }
  });

  const uiDistDir = options.uiDistDir ?? DEFAULT_UI_DIST_DIR;
  if (existsSync(uiDistDir)) {
    void app.register(fastifyStatic, {
      root: uiDistDir,
      prefix: '/',
    });
  }

  app.get('/api/hull/stations', async () =>
    stations.map((station) => ({ name: station.name, tab: station.tab })),
  );

  const contextFor = (port?: number): HostContext => ({
    port,
    getContract<T>(stationName: string, contractName: string): T | undefined {
      const station = stations.find((s) => s.name === stationName);
      return station?.contracts?.[contractName] as T | undefined;
    },
    log: (line: string) => log(line),
  });

  let voyage: VoyageManager | undefined;
  if (options.voyageFile) {
    voyage = createVoyageManager({
      defaultFile: options.voyageFile,
      // Lazy per rescan: live-registered repos appear without a restart; no chartroom station
      // mounted (tests, exotic embeddings) = default project only.
      listRepoDirs: () =>
        contextFor(undefined).getContract<() => VoyageRepoDir[]>('chartroom', 'listRepoDirs')?.() ?? [],
      clock: options.clock,
    });
    voyage.register(app);
  }

  // Chapel (deck-chapel-tab plan): unconditional, unlike Voyage -- missing state files are
  // 200-with-null, and /api/chapel/session resolves the chartroom spawnTerminal contract lazily
  // per request (501 when the station isn't mounted).
  const chapel = createChapelBackend({ homeDir: options.homeDir, repoRoot: options.repoRoot });
  chapel.register(app, contextFor(undefined));

  for (const station of stations) {
    await station.registerRoutes(app, contextFor(undefined));
  }

  return {
    app,
    stations,

    async start(port: number): Promise<void> {
      boundPort = port;
      await voyage?.start();
      for (const station of stations) {
        await station.start?.(contextFor(port));
      }
      writeHullRegistration(
        {
          port,
          pid: process.pid,
          startedAt: new Date().toISOString(),
          stations: stations.map((s) => s.name),
        },
        options.homeDir,
      );
    },

    async stop(): Promise<void> {
      // Discovery cleanup FIRST (same rationale as the chartroom station): a stale
      // services.json is the failure mode that misleads other tools; leaked watchers die with
      // the process anyway.
      try {
        clearHullRegistration(options.homeDir);
      } catch {
        /* best-effort */
      }
      for (const station of [...stations].reverse()) {
        try {
          await station.stop?.();
        } catch (err) {
          log(`ship: station '${station.name}' stop failed: ${(err as Error).message}`);
        }
      }
      try {
        await voyage?.stop();
      } catch {
        /* best-effort */
      }
    },
  };
}
