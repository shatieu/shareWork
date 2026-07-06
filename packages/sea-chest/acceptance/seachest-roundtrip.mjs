#!/usr/bin/env node
/**
 * Sea Chest acceptance (Locker_Spec §7 phases 1-3, demonstrated AGAINST LOCAL MOCKS -- the
 * live-platform halves of these acceptance lines are Captain-only, see CAPTAIN-TODO):
 *
 *  1. "push a skill from one machine, pull on another via MCP" -> two real MCP client
 *     sessions (SDK in-memory transports) over one shared store: push on A, pull on B,
 *     byte-identical files; re-push bumps the version, history intact.
 *  2. "native /plugin install of your own locker item" -> the projection + serving halves:
 *     token-authed marketplace manifest over real HTTP, npm packument, tarball whose bytes
 *     unpack to the documented plugin layout; bad token rejected. (The actual `claude plugin`
 *     invocation needs the live platform + CLI -- parked, never faked.)
 *  3. "fresh laptop -> add MCP -> set me up" -> locker_setup_machine over MCP with a machine
 *     profile: returns marketplace add command + file writes; executing the writes into a
 *     temp dir yields the expected tree.
 *
 * Run after `pnpm build`: node acceptance/seachest-roundtrip.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  MemorySeaChestStore,
  mintMarketplaceToken,
  registerSeaChestTools,
  readTar,
} from '../dist/index.js';
import { serveLocal } from '../dist/cli.js';

const USER = '11111111-1111-1111-1111-111111111111';
let step = 0;
const ok = (msg) => console.log(`ok ${++step}: ${msg}`);

/** One "machine" = one real MCP client session against the platform's tool surface. */
async function machineSession(store, options = {}) {
  const server = new McpServer({ name: 'harbor-acceptance', version: '0.0.1' });
  registerSeaChestTools(server, store, { getUserId: () => USER, ...options });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'machine', version: '0.0.1' });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return async (name, args) => {
    const res = await client.callTool({ name, arguments: args });
    assert.notEqual(res.isError, true, `tool ${name} errored: ${res.content?.[0]?.text}`);
    return JSON.parse(res.content[0].text);
  };
}

// ---------------------------------------------------------------------------------------
// Phase 1: push from machine A, pull on machine B via MCP.
// ---------------------------------------------------------------------------------------
const store = new MemorySeaChestStore();
const skillFiles = {
  'SKILL.md': '# Release checklist\n\nSteps with ümläuts, `code`, and\nmultiple lines.\n',
  'reference/steps.md': '1. build\n2. test\n3. ship\n',
};

const machineA = await machineSession(store);
const pushed = await machineA('locker_push', {
  name: 'release-checklist',
  kind: 'skill',
  files: skillFiles,
  description: 'my release skill',
});
assert.deepEqual(
  { outcome: pushed.outcome, version: pushed.version },
  { outcome: 'created', version: 1 },
);
ok('machine A pushed a skill via MCP (version 1)');

const rePush = await machineA('locker_push', {
  name: 'release-checklist',
  kind: 'skill',
  files: { ...skillFiles, 'SKILL.md': skillFiles['SKILL.md'] + '\nEdited.\n' },
});
assert.equal(rePush.outcome, 'bumped');
assert.equal(rePush.version, 2);
ok('re-push bumped to version 2');

const machineB = await machineSession(store);
const listed = await machineB('locker_list', { kind: 'skill' });
assert.deepEqual(listed.items.map((i) => i.name), ['release-checklist']);
const pulled = await machineB('locker_pull', { item: 'release-checklist' });
assert.equal(pulled.version, 2);
assert.equal(pulled.files['reference/steps.md'], skillFiles['reference/steps.md']);
assert.equal(pulled.files['SKILL.md'], skillFiles['SKILL.md'] + '\nEdited.\n');
const pulledV1 = await machineB('locker_pull', { item: 'release-checklist', version: 1 });
assert.equal(pulledV1.files['SKILL.md'], skillFiles['SKILL.md']);
ok('machine B listed + pulled byte-identical files via MCP (latest AND version 1)');

const diff = await machineB('locker_diff', {
  item: 'release-checklist',
  local_files: { ...pulled.files, 'SKILL.md': 'drifted locally\n' },
});
assert.equal(diff.clean, false);
assert.equal(diff.files.find((f) => f.path === 'SKILL.md').status, 'modified');
ok('locker_diff detects local drift');

// ---------------------------------------------------------------------------------------
// Phase 2: token-authed marketplace serving + plugin-bundle projection over real HTTP.
// ---------------------------------------------------------------------------------------
const http = await serveLocal({ port: 0, user: USER, seed: false });
const base = `http://127.0.0.1:${http.port}`;
// Mint a token through the locker API (as the web UI would).
const mintRes = await fetch(`${base}/api/sea-chest/tokens`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-sea-chest-user': USER },
  body: JSON.stringify({ label: 'acceptance' }),
});
assert.equal(mintRes.status, 201);
const { token } = await mintRes.json();
// Push the same skill into the HTTP harness's own store via the API.
const apiPush = await fetch(`${base}/api/sea-chest/items`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-sea-chest-user': USER },
  body: JSON.stringify({ name: 'release-checklist', kind: 'skill', files: skillFiles }),
});
assert.equal(apiPush.status, 201);
ok('minted a marketplace token + pushed the skill through the locker HTTP API');

const manifestRes = await fetch(`${base}/u/${USER}/marketplace.json?token=${token}`);
assert.equal(manifestRes.status, 200);
const manifest = await manifestRes.json();
assert.deepEqual(manifest.plugins.map((p) => p.name), ['release-checklist']);
assert.equal(manifest.plugins[0].source.source, 'npm');
ok('marketplace manifest served with a valid token (npm-source projection, researcher R1/R4)');

const badToken = await fetch(`${base}/u/${USER}/marketplace.json?token=sc_wrong`);
assert.equal(badToken.status, 401);
const noToken = await fetch(`${base}/u/${USER}/marketplace.json`);
assert.equal(noToken.status, 401);
ok('marketplace rejects missing/invalid tokens (401)');

const packumentRes = await fetch(
  `${manifest.plugins[0].source.registry}/${manifest.plugins[0].source.package}`,
);
assert.equal(packumentRes.status, 200);
const packument = await packumentRes.json();
const latest = packument['dist-tags'].latest;
const tarballRes = await fetch(packument.versions[latest].dist.tarball);
assert.equal(tarballRes.status, 200);
const entries = readTar(gunzipSync(Buffer.from(await tarballRes.arrayBuffer())));
const names = entries.map((e) => e.name).sort();
assert.ok(names.includes('package/.claude-plugin/plugin.json'), 'plugin.json in bundle');
assert.ok(names.includes('package/skills/release-checklist/SKILL.md'), 'skill in plugin layout');
const pluginJson = JSON.parse(
  entries.find((e) => e.name === 'package/.claude-plugin/plugin.json').content,
);
assert.equal(pluginJson.name, 'release-checklist');
assert.equal(
  entries.find((e) => e.name === 'package/skills/release-checklist/SKILL.md').content,
  skillFiles['SKILL.md'],
);
ok('registry serves packument + tarball; bytes unpack to the documented plugin layout');

// ---------------------------------------------------------------------------------------
// Phase 3: machine profile + locker_setup_machine -> executable setup manifest.
// ---------------------------------------------------------------------------------------
await store.pushItem(USER, {
  name: 'base-settings',
  kind: 'settings_template',
  content: {
    files: { 'settings.template.json': '{\n  "permissions": {}\n}\n' },
    meta: { targetPath: '~/.suite/templates/base-settings/settings.template.json' },
  },
});
await store.upsertProfile(USER, {
  name: 'laptop-default',
  itemNames: ['release-checklist', 'base-settings'],
});
const minted = mintMarketplaceToken();
await store.createToken(USER, 'setup', minted.tokenHash);

const machineC = await machineSession(store, {
  baseUrl: 'https://harbor.example.com',
  getMarketplaceToken: async () => minted.token,
});
const setup = await machineC('locker_setup_machine', { profile: 'laptop-default' });
assert.equal(setup.profile, 'laptop-default');
assert.deepEqual(setup.missingItems, []);
assert.ok(setup.marketplace.addCommand.startsWith('claude plugin marketplace add '));
assert.deepEqual(setup.marketplace.installCommands, [
  `/plugin install release-checklist@sea-chest-${USER.slice(0, 8)}`,
]);
ok('locker_setup_machine returned marketplace add + install commands for the profile');

// Execute the manifest's file writes into a temp "home", as the calling session would.
const fakeHome = mkdtempSync(join(tmpdir(), 'seachest-accept-'));
try {
  for (const write of setup.fileWrites) {
    const target = join(fakeHome, write.targetPath.replace(/^~[/\\]/, ''));
    if (write.mode === 'write-if-absent' && existsSync(target)) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, write.content, 'utf8');
  }
  const written = readFileSync(
    join(fakeHome, '.suite/templates/base-settings/settings.template.json'),
    'utf8',
  );
  assert.equal(written, '{\n  "permissions": {}\n}\n');
  ok('executing the manifest file writes produced the expected tree in a fresh (temp) home');
} finally {
  rmSync(fakeHome, { recursive: true, force: true }); // temp dir, not repo content
}

await http.close();
console.log(`\nACCEPTANCE PASSED: ${step} checks (phases 1-3 against local mocks).`);
console.log(
  'NOT covered here (live, Captain-only): applying migrations, mounting on Harbor,' +
    ' and a real `claude plugin marketplace add` + `/plugin install` against the hosted endpoint.',
);
