import type { Command } from 'commander';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../daemon/server.js';
import { createChartroomStation } from '../station.js';

/** First port `chartroom serve` tries, per plan §4.3 -- a small hand-rolled "try listen, on
 * EADDRINUSE try next" loop rather than adding the `get-port` dependency for a two-line loop. */
const DEFAULT_PORT = 4317;
const MAX_PORT_ATTEMPTS = 20;

export async function listenOnFreePort(app: FastifyInstance, startPort: number): Promise<number> {
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
 * `chartroom serve [--port]` (plan §4.3): boots the standalone Chart Room daemon. Since the
 * Captain's Deck refactor (plan 03 §4.4) the startup lives in `station.ts::createChartroomStation`
 * -- ONE codepath shared with `ship serve` -- and this command is a thin composition: create the
 * station (registry read + initial rebuilds), `buildServer` over its live runtimes array, listen
 * on the 4317+ port walk, then `station.start()` (watchers + `daemon.json` discovery write) and
 * `station.stop()` on SIGINT/SIGTERM. Behavior is unchanged from v1.1.
 */
export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the local Chart Room viewer daemon over all registered repos.')
    .option('--port <n>', 'port to bind (default: first free port starting at 4317)')
    .action(async (opts: { port?: string }) => {
      let station: ReturnType<typeof createChartroomStation>;
      try {
        station = createChartroomStation();
      } catch (err) {
        console.error(`chartroom: fatal error: ${(err as Error).message}`);
        process.exitCode = 2;
        return;
      }

      if (station.runtimes.length === 0) {
        console.log('chartroom: no repos registered yet -- run `chartroom register <path>` first.');
      }

      const app = buildServer(station.runtimes, { registrar: station.registrar });

      try {
        const requestedPort = opts.port ? Number(opts.port) : DEFAULT_PORT;
        const port = await listenOnFreePort(app, requestedPort);

        const hostContext = {
          port,
          getContract: () => undefined,
          log: (line: string) => console.log(line),
        };
        await station.start?.(hostContext);

        const shutdown = () => {
          // stop() deletes daemon.json first (the part that must not be lost); watcher close is
          // best-effort -- the process exits immediately after, same as v1.1.
          void Promise.resolve(station.stop?.()).finally(() => process.exit(0));
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

        console.log(`chartroom: serving ${station.runtimes.length} repo(s) at http://127.0.0.1:${port}`);
      } catch (err) {
        console.error(`chartroom: fatal error: ${(err as Error).message}`);
        process.exitCode = 2;
      }
    });
}
