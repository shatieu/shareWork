import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describe, expect, it } from 'vitest';
import { MemorySeaChestStore, mintMarketplaceToken } from '../src/store.js';
import { registerSeaChestTools } from '../src/tools.js';

/**
 * Real MCP protocol round-trips (SDK in-memory transport) against the memory store --
 * the same wiring Harbor will do on /api/mcp, minus the HTTP transport and real auth.
 */

const USER_A = '11111111-1111-1111-1111-111111111111';

async function connect(
  store: MemorySeaChestStore,
  userId: string,
  extras?: { baseUrl?: string; getMarketplaceToken?: (u: string) => Promise<string | null> },
) {
  const server = new McpServer({ name: 'harbor-test', version: '0.0.1' });
  registerSeaChestTools(server, store, { getUserId: () => userId, ...extras });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
    const isError = result.isError === true;
    return { isError, payload: !isError && text ? JSON.parse(text) : null, text };
  };
  return { client, call };
}

describe('Sea Chest MCP tools', () => {
  it('exposes the five Locker_Spec §2.2 tools', async () => {
    const { client } = await connect(new MemorySeaChestStore(), USER_A);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'locker_diff',
      'locker_list',
      'locker_pull',
      'locker_push',
      'locker_setup_machine',
    ]);
  });

  it('push → list → pull round-trip preserves file bytes', async () => {
    const store = new MemorySeaChestStore();
    const { call } = await connect(store, USER_A);
    const files = { 'SKILL.md': '# My skill\n\nBody with ümläuts + `code`\n' };

    const pushed = await call('locker_push', {
      name: 'my-skill',
      kind: 'skill',
      files,
      description: 'from machine A',
    });
    expect(pushed.isError).toBe(false);
    expect(pushed.payload).toMatchObject({ outcome: 'created', version: 1 });

    const listed = await call('locker_list', {});
    expect(listed.payload.items).toHaveLength(1);

    const pulled = await call('locker_pull', { item: 'my-skill' });
    expect(pulled.payload.files).toEqual(files);
    expect(pulled.payload.target_path).toBe('.claude/skills/my-skill/');
  });

  it('re-push bumps and old versions stay pullable', async () => {
    const store = new MemorySeaChestStore();
    const { call } = await connect(store, USER_A);
    await call('locker_push', { name: 's', kind: 'skill', files: { 'SKILL.md': 'v1' } });
    const again = await call('locker_push', {
      name: 's',
      kind: 'skill',
      files: { 'SKILL.md': 'v2' },
    });
    expect(again.payload).toMatchObject({ outcome: 'bumped', version: 2 });

    const old = await call('locker_pull', { item: 's', version: 1 });
    expect(old.payload.files['SKILL.md']).toBe('v1');
    expect(old.payload.version).toBe(1);
  });

  it('locker_diff reports drift per file', async () => {
    const store = new MemorySeaChestStore();
    const { call } = await connect(store, USER_A);
    await call('locker_push', {
      name: 's',
      kind: 'skill',
      files: { 'SKILL.md': 'line1\nline2\n' },
    });
    const clean = await call('locker_diff', {
      item: 's',
      local_files: { 'SKILL.md': 'line1\nline2\n' },
    });
    expect(clean.payload.clean).toBe(true);

    const drifted = await call('locker_diff', {
      item: 's',
      local_files: { 'SKILL.md': 'line1\nCHANGED\n', 'extra.md': 'new' },
    });
    expect(drifted.payload.clean).toBe(false);
    const byPath = Object.fromEntries(
      (drifted.payload.files as { path: string; status: string }[]).map((f) => [f.path, f.status]),
    );
    expect(byPath).toEqual({ 'SKILL.md': 'modified', 'extra.md': 'added' });
  });

  it('missing items surface as tool errors (isError), not protocol failures', async () => {
    const { call } = await connect(new MemorySeaChestStore(), USER_A);
    const res = await call('locker_pull', { item: 'ghost' });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('not_found');
  });

  it('locker_setup_machine returns marketplace command + file writes for a profile', async () => {
    const store = new MemorySeaChestStore();
    const minted = mintMarketplaceToken();
    await store.createToken(USER_A, 'setup', minted.tokenHash);
    await store.pushItem(USER_A, {
      name: 'my-skill',
      kind: 'skill',
      content: { files: { 'SKILL.md': 'v1' } },
    });
    await store.pushItem(USER_A, {
      name: 'base-settings',
      kind: 'settings_template',
      content: { files: { 'settings.json': '{}' }, meta: { targetPath: '~/.claude/settings.template.json' } },
    });
    await store.upsertProfile(USER_A, {
      name: 'laptop-default',
      itemNames: ['my-skill', 'base-settings', 'gone-item'],
    });

    const { call } = await connect(store, USER_A, {
      baseUrl: 'https://harbor.example.com',
      getMarketplaceToken: async () => minted.token,
    });
    const res = await call('locker_setup_machine', { profile: 'laptop-default' });
    expect(res.isError).toBe(false);
    const manifest = res.payload;
    expect(manifest.profile).toBe('laptop-default');
    expect(manifest.missingItems).toEqual(['gone-item']);
    expect(manifest.marketplace.addCommand).toContain('claude plugin marketplace add');
    expect(manifest.marketplace.addCommand).toContain(minted.token);
    expect(manifest.marketplace.installCommands).toEqual([
      `/plugin install my-skill@sea-chest-${USER_A.slice(0, 8)}`,
    ]);
    expect(manifest.fileWrites).toEqual([
      expect.objectContaining({
        itemName: 'base-settings',
        targetPath: '~/.claude/settings.template.json',
        mode: 'write-if-absent',
      }),
    ]);
  });

  it('user scoping comes from getUserId -- another user sees an empty locker', async () => {
    const store = new MemorySeaChestStore();
    await store.pushItem(USER_A, {
      name: 's',
      kind: 'skill',
      content: { files: { 'SKILL.md': 'v1' } },
    });
    const { call } = await connect(store, 'someone-else');
    const listed = await call('locker_list', {});
    expect(listed.payload.items).toEqual([]);
  });
});
