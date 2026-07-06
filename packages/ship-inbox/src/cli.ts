#!/usr/bin/env node
import { Command } from 'commander';
import Fastify from 'fastify';
import { isAllowedHostHeader } from 'suite-conventions';
import {
  expireStalePending,
  listAgentQuestions,
  listPermissionRequests,
  openShipInboxDb,
  permissionToJson,
  questionToJson,
} from './db.js';
import { createShipInboxStation } from './station.js';

const program = new Command();

program
  .name('ship-inbox')
  .description(
    "The Ship's human-action inbox standalone bin (Ship_Spec §5) -- permission queue, agent questions, and the always-allow native-rule writer. Normally mounted into `ship serve`; this bin is the degraded standalone mode (Ship_Spec §2: every module keeps its own bin).",
  )
  .version('0.1.0');

program
  .command('serve')
  .description('Standalone station server (degraded mode, no Deck, no Chart Room section) -- 127.0.0.1 only.')
  .option('--port <n>', 'port to bind (default: 4320)')
  .action(async (opts: { port?: string }) => {
    const port = opts.port ? Number(opts.port) : 4320;
    const app = Fastify({ logger: false });

    app.addHook('onRequest', async (request, reply) => {
      if (!isAllowedHostHeader(request.headers.host, port)) {
        return reply.code(403).send({ error: 'forbidden host' });
      }
    });

    const station = createShipInboxStation();
    await station.registerRoutes(app, {
      port: undefined,
      getContract: () => undefined,
      log: (line: string) => console.log(line),
    });

    await app.listen({ port, host: '127.0.0.1' });
    console.log(`ship-inbox: standalone station at http://127.0.0.1:${port}`);

    const shutdown = () => {
      void Promise.resolve(station.stop?.()).finally(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program
  .command('list')
  .description('Print the inbox (pending permissions + open questions) as JSON.')
  .option('--all', 'include decided/expired/acknowledged items')
  .action((opts: { all?: boolean }) => {
    const db = openShipInboxDb();
    try {
      expireStalePending(db, new Date().toISOString());
      const permissions = listPermissionRequests(db, opts.all ? {} : { status: 'pending' });
      const questions = listAgentQuestions(db, opts.all ? {} : { status: 'open' });
      console.log(
        JSON.stringify(
          {
            permissions: permissions.map(permissionToJson),
            questions: questions.map(questionToJson),
          },
          null,
          2,
        ),
      );
    } finally {
      db.close();
    }
  });

program.parse();
