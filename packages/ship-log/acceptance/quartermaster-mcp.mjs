#!/usr/bin/env node
// Acceptance: package 08 (Crew, Bridge phase 4) -- the deterministic, CI-able half of the
// Ship_Spec §9.4 Quartermaster line:
//
//   "Quartermaster answers a cross-week progress question correctly"
//
// The Quartermaster is an agent; its charter says: answer "where are we with X?" by querying
// the ledger (ship-ledger MCP) and the changelog (ship-log MCP) and reconciling the two. This
// script drives EXACTLY that tool chain, with nothing faked:
//   - the REAL `ship-ledger mcp` and `ship-log mcp` stdio servers, spawned from their built
//     CLIs as separate child processes against an isolated HOME/USERPROFILE (report 02 R5:
//     os.homedir() honors the override);
//   - a real @modelcontextprotocol/sdk Client per server (same protocol path an agent takes);
//   - a two-week "auth rework" history: ledger item created + status-updated THROUGH the
//     ledger MCP write tools, changelog entries seeded across two ISO weeks via the real
//     ship-log db layer (entries are only ever written by capture, not by any MCP tool --
//     seeding through the db IS the honest path), plus a stored rollup.
// It then asks the Quartermaster's literal questions -- ledger_list for status,
// log_entries since/until for "what happened since last week", log_rollup for the digest --
// and asserts every fact needed for a correct cross-week answer comes back.
//
// The full agent-loop version (a live session where the quartermaster agent itself runs these
// tools and phrases the answer) needs the per-machine `claude mcp add` registration
// (plugins/crew/README.md) and real model spend; this script is the spend-free floor under it.
//
// Exit code: non-zero on any failed assertion.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIP_LOG_CLI = join(HERE, '..', 'dist', 'cli.js');
const SHIP_LEDGER_CLI = join(HERE, '..', '..', 'ship-ledger', 'dist', 'cli.js');

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
}

function firstTextJson(result) {
  return JSON.parse(result.content[0].text);
}

async function main() {
  const fakeHome = mkdtempSync(join(tmpdir(), 'qm-acceptance-home-'));
  console.log(`sandbox home: ${fakeHome}`);

  // --- Seed the changelog: three captured sessions across two ISO weeks + one stored rollup.
  const { openShipLogDb, insertEntry, upsertRollup, upsertSessionStart } = await import(
    new URL('../dist/db.js', import.meta.url).href
  );
  const logDb = openShipLogDb(fakeHome);
  const seed = (sessionId, date, summary) => {
    upsertSessionStart(logDb, {
      sessionId,
      cwd: 'C:/repos/auth-app',
      project: 'auth-app',
      startedAt: `${date}T09:00:00.000Z`,
    });
    insertEntry(logDb, {
      sessionId,
      date,
      project: 'auth-app',
      repoRoot: 'C:/repos/auth-app',
      branch: 'auth-rework',
      commits: [{ hash: date.replaceAll('-', ''), subject: summary }],
      files: ['src/auth.ts'],
      summary,
      createdAt: `${date}T17:00:00.000Z`,
    });
  };
  seed('qm-s1', '2026-06-24', 'auth rework: extracted session middleware'); // week 26
  seed('qm-s2', '2026-06-30', 'auth rework: token refresh path landed'); // week 27
  seed('qm-s3', '2026-07-03', 'auth rework: e2e tests green, migration drafted'); // week 27
  upsertRollup(logDb, {
    date: '2026-07-03',
    digest_md: '## 2026-07-03\n- auth-app: e2e green, migration drafted',
    model: 'seed',
    entry_count: 1,
    created_at: '2026-07-03T23:59:00.000Z',
  });
  logDb.close();

  // --- Spawn both REAL stdio MCP servers against the sandbox home.
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
  const clients = {};
  for (const [name, cli] of [
    ['ship-ledger', SHIP_LEDGER_CLI],
    ['ship-log', SHIP_LOG_CLI],
  ]) {
    const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp'], env });
    const client = new Client({ name: `qm-acceptance-${name}`, version: '0.0.0' });
    await client.connect(transport);
    clients[name] = client;
  }

  // --- The ledger side of the story, written through the REAL MCP write tools.
  const created = firstTextJson(
    await clients['ship-ledger'].callTool({
      name: 'ledger_create',
      arguments: {
        title: 'Auth rework',
        project: 'auth-app',
        status: 'in_progress',
        spec_md: 'Replace session cookies with rotating tokens.',
        difficulty: 'L',
      },
    }),
  );
  await clients['ship-ledger'].callTool({
    name: 'ledger_update',
    arguments: { id: created.id, status: 'in_review', add_session_ref: 'qm-s3' },
  });

  // --- Now ask the Quartermaster's literal cross-week questions.
  // Q: "where are we with the auth rework?" -- ledger state:
  const items = firstTextJson(
    await clients['ship-ledger'].callTool({ name: 'ledger_list', arguments: { project: 'auth-app' } }),
  );
  assert(items.length === 1 && items[0].title === 'Auth rework', 'ledger_list finds the auth-rework item');
  assert(items[0].status === 'in_review', 'item status reflects the MCP update (in_review)');
  assert(
    Array.isArray(items[0].session_refs ?? items[0].sessionRefs) &&
      JSON.stringify(items[0]).includes('qm-s3'),
    'item carries the linking session ref',
  );

  // Q: "...and what actually happened since two weeks ago?" -- changelog range query:
  const entries = firstTextJson(
    await clients['ship-log'].callTool({
      name: 'log_entries',
      arguments: { since: '2026-06-22', until: '2026-07-05', project: 'auth-app' },
    }),
  );
  assert(entries.length === 3, `range query returns all three cross-week entries (got ${entries.length})`);
  assert(
    entries[0].date === '2026-07-03' && entries[2].date === '2026-06-24',
    'entries span both ISO weeks, newest first',
  );
  assert(
    entries.every((e) => Array.isArray(e.commits) && e.commits.length > 0),
    'commits come back decoded (no *_json parsing left to the agent)',
  );
  const lastWeekOnly = firstTextJson(
    await clients['ship-log'].callTool({
      name: 'log_entries',
      arguments: { since: '2026-06-29', project: 'auth-app' },
    }),
  );
  assert(lastWeekOnly.length === 2, '"since last week" narrows correctly to 2 entries');

  // Q: "what does the daily digest say?" -- stored rollup, and a miss lists what exists:
  const rollup = firstTextJson(
    await clients['ship-log'].callTool({ name: 'log_rollup', arguments: { date: '2026-07-03' } }),
  );
  assert(rollup.digest_md?.includes('migration drafted'), 'stored rollup digest retrieved');
  const rollupMiss = firstTextJson(
    await clients['ship-log'].callTool({ name: 'log_rollup', arguments: { date: '2026-07-04' } }),
  );
  assert(
    rollupMiss.rollup === null && rollupMiss.available_dates.includes('2026-07-03'),
    'rollup miss degrades to an available-dates listing (never builds)',
  );

  // Session metadata is reachable too (drift checks lean on started/ended times):
  const sessions = firstTextJson(
    await clients['ship-log'].callTool({ name: 'log_sessions', arguments: { project: 'auth-app' } }),
  );
  assert(sessions.length === 3 && sessions[0].session_id === 'qm-s3', 'log_sessions newest first');

  for (const client of Object.values(clients)) await client.close();

  // Everything a correct answer needs is now on the table: current status (in_review), the
  // three dated facts across two weeks, and the digest. That IS the §9.4 Quartermaster floor.
  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nquartermaster-mcp acceptance: ALL OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
