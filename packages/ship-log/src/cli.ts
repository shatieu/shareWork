#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { Command } from 'commander';
import Fastify from 'fastify';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createShipLogMcpServer } from './mcp.js';
import { isAllowedHostHeader } from 'suite-conventions';
import { ingestEnvelope } from './ingest.js';
import { openShipLogDb } from './db.js';
import { createCaptureContext, sweepOrphans } from './capture.js';
import { defaultRollupSummarizer, defaultSummarizer } from './summarize.js';
import { buildRollup } from './rollup.js';
import { createShipLogStation } from './station.js';

const program = new Command();

program
  .name('ship-log')
  .description(
    "The Ship's changelog service standalone bin -- capture/rollup/build/serve without a hull (Ship_Spec §2: every module keeps its own bin).",
  )
  .version('0.1.0');

program
  .command('capture')
  .description('Read one hook-event envelope from stdin and capture it directly (no hull needed -- degraded/standalone mode).')
  .action(async () => {
    const raw = await readStdin();
    let envelope: unknown;
    try {
      envelope = JSON.parse(raw);
    } catch (err) {
      console.error(`ship-log: invalid JSON on stdin: ${(err as Error).message}`);
      process.exitCode = 2;
      return;
    }
    const db = openShipLogDb();
    const ctx = createCaptureContext(db, defaultSummarizer);
    try {
      const result = await ingestEnvelope(ctx, envelope);
      console.log(`ship-log: captured (${result.stored})`);
    } catch (err) {
      console.error(`ship-log: capture failed: ${(err as Error).message}`);
      process.exitCode = 2;
    } finally {
      db.close();
    }
  });

program
  .command('rollup')
  .description("Build (or rebuild) the daily rollup digest and print it.")
  .option('--date <YYYY-MM-DD>', 'defaults to today (local date)')
  .action(async (opts: { date?: string }) => {
    const date = opts.date ?? localDateToday();
    const db = openShipLogDb();
    try {
      const ctx = createCaptureContext(db, defaultSummarizer);
      await sweepOrphans(ctx);
      const row = await buildRollup({ db, date, summarizer: defaultRollupSummarizer, now: () => new Date() });
      console.log(row.digest_md);
    } finally {
      db.close();
    }
  });

program
  .command('build')
  .description('Concatenate a repo`s changelog fragments (newest-first) into a committed CHANGELOG.md -- deterministic, no LLM.')
  .option('--repo <path>', 'repo root (default: cwd)')
  .option('--out <path>', 'output file, relative to --repo (default: CHANGELOG.md)')
  .action((opts: { repo?: string; out?: string }) => {
    const repoRoot = resolvePath(opts.repo ?? process.cwd());
    const outPath = join(repoRoot, opts.out ?? 'CHANGELOG.md');
    const entriesDir = join(repoRoot, 'changelog', 'entries');

    if (!existsSync(entriesDir)) {
      console.log(`ship-log: no fragments directory at ${entriesDir}; nothing to build.`);
      return;
    }

    const files = readdirSync(entriesDir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .reverse(); // filenames are date-prefixed -- lexical reverse sort = newest first

    const sections = files.map((f) => readFileSync(join(entriesDir, f), 'utf8').trimEnd());
    const content = ['# Changelog', '', ...sections.map((s) => s + '\n')].join('\n');
    writeFileSync(outPath, content, 'utf8');
    console.log(`ship-log: wrote ${outPath} from ${files.length} fragment(s).`);
  });

program
  .command('mcp')
  .description(
    'Run the read-only changelog MCP server on stdio (register with `claude mcp add ship-log -- ship-log mcp`, or point --mcp-config at it). The Quartermaster reads entries/rollups/sessions through its tools.',
  )
  .action(async () => {
    // stdout is the JSON-RPC channel -- nothing else may write to it (no console.log anywhere
    // on this path; ship-ledger's proven pattern). Diagnostics go to stderr only.
    const db = openShipLogDb();
    const server = createShipLogMcpServer(db, { version: '0.1.0' });
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
  .option('--port <n>', 'port to bind (default: 4318)')
  .action(async (opts: { port?: string }) => {
    const port = opts.port ? Number(opts.port) : 4318;
    const app = Fastify({ logger: false });

    // Standalone bin knows its port upfront (no free-port scan like the hull's `listenOnFreePort`
    // -- a fixed `--port` or the 4318 default), so the Host-allowlist guard can check against it
    // from the start, unlike the hull's `undefined`-until-`.listen()` pattern.
    app.addHook('onRequest', async (request, reply) => {
      if (!isAllowedHostHeader(request.headers.host, port)) {
        return reply.code(403).send({ error: 'forbidden host' });
      }
    });

    const station = createShipLogStation();
    await station.registerRoutes(app, {
      port: undefined,
      getContract: () => undefined,
      log: (line: string) => console.log(line),
    });

    await app.listen({ port, host: '127.0.0.1' });
    await station.start?.({ port, getContract: () => undefined, log: (line: string) => console.log(line) });
    console.log(`ship-log: standalone station at http://127.0.0.1:${port}`);

    const shutdown = () => {
      void station.stop?.()?.then(() => process.exit(0));
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

function readStdin(): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolvePromise(data));
    process.stdin.on('error', reject);
  });
}

function localDateToday(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

program.parse();
