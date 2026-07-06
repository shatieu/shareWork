import { basename, resolve as resolvePath } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { HostContext, StationDescriptor } from 'suite-conventions';
import { findGitRoot } from './repo.js';
import { listRepos, registerRepo } from './daemon/registry.js';
import { rebuild, type RepoState } from './daemon/repo-state.js';
import type { RepoRuntime } from './daemon/server.js';
import { registerChartroomRoutes } from './daemon/register-routes.js';
import { collectInboxItems, type InboxItem } from './daemon/routes/inbox.js';
import type { RepoRegistrar } from './daemon/routes/repo-register.js';
import { startWatcher, stopWatcher, type WatchedRepo } from './daemon/watcher.js';
import { deleteDaemonInfo, writeDaemonInfo } from './daemon/daemon-info.js';

export interface ChartroomStationOptions {
  /** Overrides the home directory used for BOTH the repo registry read and the
   * `~/.chartroom/daemon.json` discovery write -- tests never touch the real home. */
  homeDir?: string;
}

/**
 * Chart Room as a mounted Deck station (plan 03 §4.4): the same startup the standalone
 * `chartroom serve` performs, packaged behind the suite's typed `StationDescriptor` contract so
 * the hull (`ship serve`) and the standalone bin share ONE codepath for state, live registration,
 * watchers, and the `daemon.json` discovery file.
 *
 * Lifecycle mapping:
 * - factory (this function): registry read once + initial `rebuild` per registered repo -- the
 *   synchronous part `serve.ts` used to do inline before booting Fastify.
 * - `registerRoutes`: all `/api` routes via `registerChartroomRoutes` (namespaces unchanged --
 *   v1.1 deep links and `chartroom open` URLs keep working under the hull).
 * - `start`: one chokidar watcher per repo + `daemon.json` write with the HOST's port -- so
 *   `chartroom open`/`associate` (v1.1) find the hull automatically.
 * - `stop`: `daemon.json` delete first (best-effort, the part that must not be lost if the
 *   process dies mid-shutdown), then watcher close.
 */
export interface ChartroomStation extends StationDescriptor {
  /** Live repo runtimes array (mutable; the registrar pushes into it) -- exposed so the
   * standalone serve command can compose `buildServer(station.runtimes, ...)` over the same
   * objects the station manages. */
  readonly runtimes: RepoRuntime[];
  /** The live-registration callback (persist -> rebuild -> push runtime -> start watcher). */
  readonly registrar: RepoRegistrar;
}

export function createChartroomStation(options: ChartroomStationOptions = {}): ChartroomStation {
  const homeDir = options.homeDir;

  const repos = listRepos(homeDir);
  const states = new Map<string, RepoState>();
  for (const repo of repos) {
    states.set(repo.id, rebuild(repo.absPath));
  }

  const runtimes: RepoRuntime[] = repos.map((repo) => ({
    id: repo.id,
    name: basename(repo.absPath),
    absPath: repo.absPath,
    getState: () => states.get(repo.id) as RepoState,
    setState: (state: RepoState) => states.set(repo.id, state),
  }));

  const watchers: WatchedRepo[] = [];
  let started = false;

  const onWatcherRebuild = (repoId: string, state: RepoState): void => {
    states.set(repoId, state);
  };

  // Live registration (POST /api/repos/register, used by `chartroom open` when a daemon is
  // already running): same steps as boot, applied to one repo while running -- persist to the
  // registry, build state, push into the SHARED runtimes array (all routes read it live),
  // start a watcher.
  const registrar: RepoRegistrar = async (inputPath: string) => {
    const gitRoot = findGitRoot(resolvePath(inputPath));
    const entry = registerRepo(gitRoot, homeDir);
    const existing = runtimes.find((runtime) => runtime.id === entry.id);
    if (existing) {
      return { id: existing.id, name: existing.name, absPath: existing.absPath, alreadyRegistered: true };
    }
    const name = basename(entry.absPath);
    states.set(entry.id, rebuild(entry.absPath));
    runtimes.push({
      id: entry.id,
      name,
      absPath: entry.absPath,
      getState: () => states.get(entry.id) as RepoState,
      setState: (state: RepoState) => states.set(entry.id, state),
    });
    // Watchers only exist between start() and stop(); a repo registered before start() (possible
    // in tests / exotic embeddings) gets its watcher when start() walks the runtimes array.
    if (started) {
      watchers.push(startWatcher(entry.id, entry.absPath, onWatcherRebuild));
    }
    console.log(`chartroom: live-registered '${entry.id}' -> ${entry.absPath}`);
    return { id: entry.id, name, absPath: entry.absPath, alreadyRegistered: false };
  };

  return {
    name: 'chartroom',
    tab: { id: 'docs', title: 'Docs' },
    runtimes,
    registrar,

    registerRoutes(app: FastifyInstance): void {
      registerChartroomRoutes(app, runtimes, { registrar });
    },

    contracts: {
      /** In-process contract for ship-inbox's one-page aggregation (Ship_Spec §5: "unanswered
       * ask-me blocks pulled from Chart Room" + "open :::actions blocks"): the same cross-repo
       * list `GET /api/inbox` serves, without the HTTP hop. Reads the live runtimes array, so
       * live-registered repos are included automatically. */
      listInbox: (): InboxItem[] => collectInboxItems(runtimes),
    },

    start(ctx: HostContext): void {
      const watchedIds = new Set(watchers.map((w) => w.repoId));
      for (const runtime of runtimes) {
        if (!watchedIds.has(runtime.id)) {
          watchers.push(startWatcher(runtime.id, runtime.absPath, onWatcherRebuild));
        }
      }
      started = true;
      if (typeof ctx.port === 'number') {
        writeDaemonInfo({ port: ctx.port, pid: process.pid, startedAt: new Date().toISOString() }, homeDir);
      }
    },

    async stop(): Promise<void> {
      started = false;
      // Discovery cleanup FIRST: if the process dies mid-shutdown, a stale daemon.json is the
      // failure that misleads `chartroom open`; a leaked watcher dies with the process anyway.
      deleteDaemonInfo(homeDir);
      const closing = watchers.splice(0, watchers.length);
      await Promise.all(closing.map((watched) => stopWatcher(watched)));
    },
  };
}
