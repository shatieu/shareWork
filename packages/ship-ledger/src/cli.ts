#!/usr/bin/env node
import { Command } from 'commander';
import Fastify from 'fastify';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { isAllowedHostHeader } from 'suite-conventions';
import { itemToJson, listItems, openShipLedgerDb, type LedgerSource, type LedgerStatus } from './db.js';
import { createLedgerMcpServer } from './mcp.js';
import { createShipLedgerStation } from './station.js';

const program = new Command();

program
  .name('ship-ledger')
  .description(
    "The Ship's persistent cross-project ledger standalone bin -- MCP server, standalone HTTP station, and a quick list view (Ship_Spec §2: every module keeps its own bin).",
  )
  .version('0.1.0');

program
  .command('mcp')
  .description(
    'Run the ledger MCP server on stdio (register with `claude mcp add ship-ledger -- ship-ledger mcp`, or point --mcp-config at it). Agents read/write the ledger through its tools.',
  )
  .action(async () => {
    // stdout is the JSON-RPC channel -- nothing else may write to it (no console.log anywhere
    // on this path). Diagnostics go to stderr only.
    const db = openShipLedgerDb();
    const server = createLedgerMcpServer(db);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    const shutdown = () => {
      try {
        db.close();
      } catch {
        /* best-effort */
      }
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program
  .command('serve')
  .description('Standalone station server (degraded mode, no Deck) -- 127.0.0.1 only.')
  .option('--port <n>', 'port to bind (default: 4319)')
  .action(async (opts: { port?: string }) => {
    const port = opts.port ? Number(opts.port) : 4319;
    const app = Fastify({ logger: false });

    app.addHook('onRequest', async (request, reply) => {
      if (!isAllowedHostHeader(request.headers.host, port)) {
        return reply.code(403).send({ error: 'forbidden host' });
      }
    });

    const station = createShipLedgerStation();
    await station.registerRoutes(app, {
      port: undefined,
      getContract: () => undefined,
      log: (line: string) => console.log(line),
    });

    await app.listen({ port, host: '127.0.0.1' });
    console.log(`ship-ledger: standalone station at http://127.0.0.1:${port}`);

    const shutdown = () => {
      void Promise.resolve(station.stop?.()).finally(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

program
  .command('list')
  .description('Print ledger items as JSON (optionally filtered).')
  .option('--project <name>')
  .option('--status <status>')
  .option('--source <source>')
  .action((opts: { project?: string; status?: string; source?: string }) => {
    const db = openShipLedgerDb();
    try {
      const rows = listItems(db, {
        project: opts.project,
        status: opts.status as LedgerStatus | undefined,
        source: opts.source as LedgerSource | undefined,
      });
      console.log(JSON.stringify(rows.map(itemToJson), null, 2));
    } finally {
      db.close();
    }
  });

program.parse();
