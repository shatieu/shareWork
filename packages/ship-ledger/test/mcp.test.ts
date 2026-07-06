import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { listItems, openShipLedgerDb, stageProgressFor } from '../src/db.js';
import { createLedgerMcpServer } from '../src/mcp.js';

let fakeHome: string;
let db: Database.Database;
let client: Client;

const NOW = new Date('2026-07-06T12:00:00.000Z');

/** Real MCP client <-> real MCP server over the SDK's linked in-memory transport pair -- the
 * same protocol path a stdio agent takes, minus the child process. */
async function connect() {
  const server = createLedgerMcpServer(db, { now: () => NOW });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'ship-ledger-test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
}

function firstTextJson(result: { content?: unknown }): any {
  const content = result.content as Array<{ type: string; text: string }>;
  expect(content?.[0]?.type).toBe('text');
  return JSON.parse(content[0].text);
}

beforeEach(async () => {
  fakeHome = mkdtempSync(join(tmpdir(), 'ship-ledger-mcp-test-'));
  db = openShipLedgerDb(fakeHome);
  await connect();
});

afterEach(async () => {
  await client.close();
  db.close();
  rmSync(fakeHome, { recursive: true, force: true });
});

describe('ledger MCP server', () => {
  it('lists the four ledger tools', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'ledger_create',
      'ledger_get',
      'ledger_list',
      'ledger_update',
    ]);
  });

  it('ledger_create writes an agent-sourced item into the store', async () => {
    const result = await client.callTool({
      name: 'ledger_create',
      arguments: {
        title: 'Ship the ledger',
        spec_md: '## do it',
        project: 'sharework',
        session_id: 's-42',
        difficulty: 'M',
        remaining_guess_h: 2,
      },
    });
    const item = firstTextJson(result);
    expect(item.source).toBe('agent');
    expect(item.sessionRefs).toEqual(['s-42']);
    expect(item.stageProgress).toBe(0);
    expect(item.createdAt).toBe(NOW.toISOString());
    expect(listItems(db)).toHaveLength(1);
  });

  it('ledger_update patches status and recomputes stage_progress; ledger_get reads it back', async () => {
    const created = firstTextJson(
      await client.callTool({ name: 'ledger_create', arguments: { title: 'w' } }),
    );
    const updated = firstTextJson(
      await client.callTool({
        name: 'ledger_update',
        arguments: { id: created.id, status: 'in_progress', add_session_ref: 's-43' },
      }),
    );
    expect(updated.status).toBe('in_progress');
    expect(updated.stageProgress).toBe(stageProgressFor('in_progress'));
    expect(updated.sessionRefs).toContain('s-43');

    const fetched = firstTextJson(
      await client.callTool({ name: 'ledger_get', arguments: { id: created.id } }),
    );
    expect(fetched).toEqual(updated);
  });

  it('ledger_list filters by status', async () => {
    await client.callTool({ name: 'ledger_create', arguments: { title: 'a' } });
    const b = firstTextJson(
      await client.callTool({ name: 'ledger_create', arguments: { title: 'b' } }),
    );
    await client.callTool({
      name: 'ledger_update',
      arguments: { id: b.id, status: 'done' },
    });
    const all = firstTextJson(await client.callTool({ name: 'ledger_list', arguments: {} }));
    expect(all).toHaveLength(2);
    const done = firstTextJson(
      await client.callTool({ name: 'ledger_list', arguments: { status: 'done' } }),
    );
    expect(done.map((i: any) => i.title)).toEqual(['b']);
  });

  it('unknown id and invalid input surface as tool errors, not crashes', async () => {
    const missing = await client.callTool({
      name: 'ledger_get',
      arguments: { id: 'does-not-exist' },
    });
    expect(missing.isError).toBe(true);

    const invalid = await client.callTool({
      name: 'ledger_create',
      arguments: { title: 'x', status: 'not-a-status' },
    });
    expect(invalid.isError).toBe(true);
    expect(listItems(db)).toHaveLength(0);
  });
});
