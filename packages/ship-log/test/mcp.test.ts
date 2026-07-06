import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { insertEntry, openShipLogDb, upsertRollup, upsertSessionStart } from '../src/db.js';
import { createShipLogMcpServer, listRollupDates, queryEntries } from '../src/mcp.js';

/** Real MCP client <-> real MCP server over the SDK's linked in-memory transport pair -- the
 * same protocol path a stdio agent (the Quartermaster) takes, minus the child process.
 * ship-ledger's proven test pattern (package 5). */

let fakeHome: string;
let db: Database.Database;
let client: Client;

async function connect() {
  const server = createShipLogMcpServer(db);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'ship-log-test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
}

function firstTextJson(result: { content?: unknown }): any {
  const content = result.content as Array<{ type: string; text: string }>;
  expect(content?.[0]?.type).toBe('text');
  return JSON.parse(content[0].text);
}

function seedEntry(opts: {
  sessionId: string;
  date: string;
  project?: string;
  summary?: string;
  createdAt?: string;
}) {
  insertEntry(db, {
    sessionId: opts.sessionId,
    date: opts.date,
    project: opts.project ?? 'proj-a',
    repoRoot: `C:/repos/${opts.project ?? 'proj-a'}`,
    branch: 'main',
    commits: [{ hash: 'abc1234', subject: `work on ${opts.date}` }],
    files: ['src/a.ts'],
    summary: opts.summary ?? `did things on ${opts.date}`,
    summaryModel: null,
    fragmentPath: null,
    createdAt: opts.createdAt ?? `${opts.date}T12:00:00.000Z`,
    partial: false,
  });
}

beforeEach(async () => {
  fakeHome = mkdtempSync(join(tmpdir(), 'ship-log-mcp-test-'));
  db = openShipLogDb(fakeHome);
  await connect();
});

afterEach(async () => {
  await client.close();
  db.close();
  // fakeHome dirs are left for the OS temp cleaner -- deletion is banned mission-wide.
});

describe('ship-log MCP server', () => {
  it('exposes exactly the three read-only tools', async () => {
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual(['log_entries', 'log_rollup', 'log_sessions']);
  });

  it('log_entries returns decoded commits/files, newest first', async () => {
    seedEntry({ sessionId: 's1', date: '2026-06-25' });
    seedEntry({ sessionId: 's2', date: '2026-07-02' });
    const result = await client.callTool({ name: 'log_entries', arguments: {} });
    const rows = firstTextJson(result);
    expect(rows).toHaveLength(2);
    expect(rows[0].date).toBe('2026-07-02'); // newest first
    expect(rows[0].commits[0].hash).toBe('abc1234'); // decoded, not commits_json
    expect(rows[0].files).toEqual(['src/a.ts']);
    expect(rows[0].partial).toBe(false);
  });

  it('log_entries since/until range + project filter answers the cross-week shape', async () => {
    seedEntry({ sessionId: 's1', date: '2026-06-20', project: 'auth-rework' });
    seedEntry({ sessionId: 's2', date: '2026-06-29', project: 'auth-rework' });
    seedEntry({ sessionId: 's3', date: '2026-07-03', project: 'auth-rework' });
    seedEntry({ sessionId: 's4', date: '2026-07-03', project: 'other' });
    const result = await client.callTool({
      name: 'log_entries',
      arguments: { since: '2026-06-28', until: '2026-07-04', project: 'auth-rework' },
    });
    const rows = firstTextJson(result);
    expect(rows.map((r: any) => r.session_id)).toEqual(['s3', 's2']);
  });

  it('log_entries rejects a malformed date as a tool-level validation error', async () => {
    const result = await client.callTool({ name: 'log_entries', arguments: { date: 'yesterday' } });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain('Input validation error');
  });

  it('log_rollup returns the stored digest and never builds', async () => {
    upsertRollup(db, {
      date: '2026-07-01',
      digest_md: '## digest for 2026-07-01',
      model: 'fallback',
      entry_count: 3,
      created_at: '2026-07-01T23:59:00.000Z',
    });
    const hit = firstTextJson(
      await client.callTool({ name: 'log_rollup', arguments: { date: '2026-07-01' } }),
    );
    expect(hit.digest_md).toContain('digest for 2026-07-01');

    const miss = firstTextJson(
      await client.callTool({ name: 'log_rollup', arguments: { date: '2026-07-02' } }),
    );
    expect(miss.rollup).toBeNull();
    expect(miss.available_dates).toEqual(['2026-07-01']);
    // building is not the read surface's job: still exactly one stored rollup afterwards
    expect(listRollupDates(db)).toEqual(['2026-07-01']);
  });

  it('log_sessions lists recent sessions newest first with project filter', async () => {
    upsertSessionStart(db, {
      sessionId: 'old',
      cwd: 'C:/repos/a',
      project: 'a',
      startedAt: '2026-07-01T08:00:00.000Z',
    });
    upsertSessionStart(db, {
      sessionId: 'new',
      cwd: 'C:/repos/a',
      project: 'a',
      startedAt: '2026-07-05T08:00:00.000Z',
    });
    upsertSessionStart(db, {
      sessionId: 'other',
      cwd: 'C:/repos/b',
      project: 'b',
      startedAt: '2026-07-06T08:00:00.000Z',
    });
    const rows = firstTextJson(
      await client.callTool({ name: 'log_sessions', arguments: { project: 'a' } }),
    );
    expect(rows.map((r: any) => r.session_id)).toEqual(['new', 'old']);
    expect(rows[0].captured).toBe(false);
  });

  it('queryEntries clamps limit and orders deterministically within a date', () => {
    seedEntry({ sessionId: 'e1', date: '2026-07-03', createdAt: '2026-07-03T09:00:00.000Z' });
    seedEntry({ sessionId: 'e2', date: '2026-07-03', createdAt: '2026-07-03T18:00:00.000Z' });
    const rows = queryEntries(db, { limit: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0].session_id).toBe('e2'); // same date -> newest created_at first
  });
});
