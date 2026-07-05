import { basename, resolve as resolvePath } from 'node:path';
import type { Command } from 'commander';
import type { FastifyInstance } from 'fastify';
import { findGitRoot } from '../repo.js';
import { listRepos, registerRepo, type RegisteredRepo } from '../daemon/registry.js';
import { rebuild, type RepoState } from '../daemon/repo-state.js';
import { buildServer, type RepoRuntime } from '../daemon/server.js';
import { startWatcher } from '../daemon/watcher.js';
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
 * registered repo's initial in-memory state, boots the Fastify daemon, starts one chokidar
 * watcher per repo, then `.listen()`s and prints the URL.
 *
 * v1.1 additions: after a successful listen the daemon writes `~/.chartroom/daemon.json` so
 * `chartroom open` can discover it (best-effort deleted again on SIGINT/SIGTERM), and it wires a
 * live registrar into `POST /api/repos/register` -- raw assets are served by a dynamic route over
 * the shared runtimes array (routes/raw.ts), so a repo registered while the daemon runs is
 * browsable immediately, no restart.
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

      const onWatcherRebuild = (repoId: string, state: RepoState): void => {
        states.set(repoId, state);
      };

      // Live registration (POST /api/repos/register, used by `chartroom open` when a daemon is
      // already running): same steps as boot, applied to one repo while running -- persist to the
      // registry, build state, push into the SHARED runtimes array (all routes read it live),
      // start a watcher.
      const registrar = async (inputPath: string) => {
        const gitRoot = findGitRoot(resolvePath(inputPath));
        const entry = registerRepo(gitRoot);
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
        startWatcher(entry.id, entry.absPath, onWatcherRebuild);
        console.log(`chartroom: live-registered '${entry.id}' -> ${entry.absPath}`);
        return { id: entry.id, name, absPath: entry.absPath, alreadyRegistered: false };
      };

      const app = buildServer(runtimes, { registrar });

      for (const repo of repos) {
        startWatcher(repo.id, repo.absPath, onWatcherRebuild);
      }

      try {
        const requestedPort = opts.port ? Number(opts.port) : DEFAULT_PORT;
        const port = await listenOnFreePort(app, requestedPort);

        writeDaemonInfo({ port, pid: process.pid, startedAt: new Date().toISOString() });
        const shutdown = () => {
          deleteDaemonInfo();
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
