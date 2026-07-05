import { basename, resolve as resolvePath } from 'node:path';
import type { Command } from 'commander';
import type { FastifyInstance } from 'fastify';
import { findGitRoot } from '../repo.js';
import { listRepos, registerRepo, type RegisteredRepo } from '../daemon/registry.js';
import { rebuild, type RepoState } from '../daemon/repo-state.js';
import { buildServer, type RepoRuntime } from '../daemon/server.js';
import { startWatcher } from '../daemon/watcher.js';
import { ActivityLog } from '../daemon/activity.js';
import { RebuildPipeline, type RepoIdentity } from '../daemon/rebuild-pipeline.js';
import { deleteDaemonInfo, writeDaemonInfo } from '../daemon/daemon-info.js';

/** First port `chartroom serve` tries, per plan §4.3 -- a small hand-rolled "try listen, on
 * EADDRINUSE try next" loop rather than adding the `get-port` dependency for a two-line loop. */
const DEFAULT_PORT = 4317;
const MAX_PORT_ATTEMPTS = 20;

async function listenOnFreePort(app: FastifyInstance, startPort: number): Promise<number> {
  let port = startPort;
  for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt += 1) {
    try {
      await app.listen({ port, host: '127.0.0.1' });
      return port;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        port += 1;
        continue;
      }
      throw err;
    }
  }
  throw new Error(`chartroom: could not find a free port starting at ${startPort}`);
}

/**
 * `chartroom serve [--port]` (plan §4.3): reads the registry once at startup, builds each
 * registered repo's initial in-memory state, boots the Fastify daemon (all static mounts fixed at
 * this point -- registering a repo while `serve` is already running requires a restart, plan §5),
 * starts one chokidar watcher per repo, then `.listen()`s and prints the URL.
 *
 * Wave 2 additions: every rebuild (boot and watcher-triggered) flows through
 * `rebuild-pipeline.ts::RebuildPipeline` -- automatic link repair plus activity-feed events --
 * and after a successful listen the daemon writes `~/.chartroom/daemon.json` so `chartroom open`
 * can discover it (best-effort deleted again on SIGINT/SIGTERM).
 */
export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the local Chart Room viewer daemon over all registered repos.')
    .option('--port <n>', 'port to bind (default: first free port starting at 4317)')
    .action(async (opts: { port?: string }) => {
      let repos: RegisteredRepo[];
      try {
        repos = listRepos();
      } catch (err) {
        console.error(`chartroom: fatal error: ${(err as Error).message}`);
        process.exitCode = 2;
        return;
      }

      if (repos.length === 0) {
        console.log('chartroom: no repos registered yet -- run `chartroom register <path>` first.');
      }

      const activity = new ActivityLog();
      const pipeline = new RebuildPipeline(activity);

      const identities = new Map<string, RepoIdentity>(
        repos.map((repo) => [repo.id, { id: repo.id, name: basename(repo.absPath), absPath: repo.absPath }]),
      );

      const states = new Map<string, RepoState>();
      for (const repo of repos) {
        const identity = identities.get(repo.id) as RepoIdentity;
        // Boot rebuild goes through the pipeline too: repos that accumulated stale links while no
        // daemon was running get repaired the moment one starts, not on the next file change.
        states.set(repo.id, pipeline.process(identity, rebuild(repo.absPath)));
      }

      const runtimes: RepoRuntime[] = repos.map((repo) => ({
        id: repo.id,
        name: basename(repo.absPath),
        absPath: repo.absPath,
        getState: () => states.get(repo.id) as RepoState,
        setState: (state: RepoState) => states.set(repo.id, state),
      }));

      const onWatcherRebuild = (repoId: string, state: RepoState): void => {
        const identity = identities.get(repoId) as RepoIdentity;
        // The pipeline may write repaired files (triggering the watcher again -- idempotent, it
        // settles) and returns the post-repair state, which is what we install.
        states.set(repoId, pipeline.process(identity, state));
      };

      // Live registration for the UI's folder picker (POST /api/repos/register): same steps as
      // boot, applied to one repo while running -- persist to the registry, build state through
      // the pipeline, push into the SHARED runtimes array (all routes read it live), start a
      // watcher. Raw assets are served dynamically (routes/raw.ts), so no restart is needed.
      const registrar = async (inputPath: string) => {
        const gitRoot = findGitRoot(resolvePath(inputPath));
        const entry = registerRepo(gitRoot);
        const existing = runtimes.find((runtime) => runtime.id === entry.id);
        if (existing) {
          return { id: existing.id, name: existing.name, absPath: existing.absPath, alreadyRegistered: true };
        }
        const identity: RepoIdentity = { id: entry.id, name: basename(entry.absPath), absPath: entry.absPath };
        identities.set(entry.id, identity);
        states.set(entry.id, pipeline.process(identity, rebuild(entry.absPath)));
        runtimes.push({
          id: entry.id,
          name: identity.name,
          absPath: entry.absPath,
          getState: () => states.get(entry.id) as RepoState,
          setState: (state: RepoState) => states.set(entry.id, state),
        });
        startWatcher(entry.id, entry.absPath, onWatcherRebuild);
        activity.log({
          ts: new Date().toISOString(),
          repoId: entry.id,
          repoName: identity.name,
          kind: 'rebuild',
          summary: 'repo registered',
          detail: entry.absPath,
        });
        return { id: entry.id, name: identity.name, absPath: entry.absPath, alreadyRegistered: false };
      };

      const app = buildServer(runtimes, { activity, registrar });

      for (const repo of repos) {
        startWatcher(repo.id, repo.absPath, onWatcherRebuild);
      }

      try {
        const requestedPort = opts.port ? Number(opts.port) : DEFAULT_PORT;
        const port = await listenOnFreePort(app, requestedPort);

        writeDaemonInfo({ port, pid: process.pid, startedAt: new Date().toISOString() });
        const shutdown = () => {
          deleteDaemonInfo();
          activity.flush();
          process.exit(0);
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        console.log(`chartroom: serving ${repos.length} repo(s) at http://127.0.0.1:${port}`);
      } catch (err) {
        console.error(`chartroom: fatal error: ${(err as Error).message}`);
        process.exitCode = 2;
      }
    });
}
