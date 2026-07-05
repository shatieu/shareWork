import { basename } from 'node:path';
import type { Command } from 'commander';
import type { FastifyInstance } from 'fastify';
import { listRepos, type RegisteredRepo } from '../daemon/registry.js';
import { rebuild, type RepoState } from '../daemon/repo-state.js';
import { buildServer, type RepoRuntime } from '../daemon/server.js';
import { startWatcher } from '../daemon/watcher.js';

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

      const app = buildServer(runtimes);

      for (const repo of repos) {
        startWatcher(repo.id, repo.absPath, (repoId, state) => {
          states.set(repoId, state);
        });
      }

      try {
        const requestedPort = opts.port ? Number(opts.port) : DEFAULT_PORT;
        const port = await listenOnFreePort(app, requestedPort);
        console.log(`chartroom: serving ${repos.length} repo(s) at http://127.0.0.1:${port}`);
      } catch (err) {
        console.error(`chartroom: fatal error: ${(err as Error).message}`);
        process.exitCode = 2;
      }
    });
}
