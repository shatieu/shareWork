import { describe, expect, it } from 'vitest';
import { buildSetupManifest } from '../src/setup-machine.js';
import { MemorySeaChestStore } from '../src/store.js';

const USER = '11111111-1111-1111-1111-111111111111';
const BASE = 'https://harbor.example.com';

async function seededStore() {
  const store = new MemorySeaChestStore();
  await store.pushItem(USER, {
    name: 'my-skill',
    kind: 'skill',
    content: { files: { 'SKILL.md': 's' } },
  });
  await store.pushItem(USER, {
    name: 'base-settings',
    kind: 'settings_template',
    content: { files: { 'settings.json': '{}' } },
  });
  await store.pushItem(USER, {
    name: 'global-claude-md',
    kind: 'claude_md',
    content: {
      files: { 'CLAUDE.md': '# me' },
      meta: { targetPath: '~/.claude/CLAUDE.md', writeMode: 'overwrite', services: [{ id: 'ship' }] },
    },
  });
  return store;
}

describe('buildSetupManifest', () => {
  it('without a profile covers ALL items: marketplace step + file writes + services', async () => {
    const manifest = await buildSetupManifest(await seededStore(), USER, undefined, {
      baseUrl: BASE,
      marketplaceToken: 'sc_tok',
    });
    expect(manifest.profile).toBeNull();
    expect(manifest.marketplace?.url).toBe(
      `${BASE}/u/${USER}/marketplace.json?token=sc_tok`,
    );
    expect(manifest.marketplace?.installCommands).toEqual([
      `/plugin install my-skill@sea-chest-${USER.slice(0, 8)}`,
    ]);
    // Non-pluginable kinds become file writes; pluginable ones do not.
    expect(manifest.fileWrites.map((w) => w.itemName).sort()).toEqual([
      'base-settings',
      'global-claude-md',
    ]);
    const settingsWrite = manifest.fileWrites.find((w) => w.itemName === 'base-settings')!;
    expect(settingsWrite.targetPath).toBe('~/.suite/templates/base-settings/settings.json');
    expect(settingsWrite.mode).toBe('write-if-absent');
    const claudeWrite = manifest.fileWrites.find((w) => w.itemName === 'global-claude-md')!;
    expect(claudeWrite.targetPath).toBe('~/.claude/CLAUDE.md');
    expect(claudeWrite.mode).toBe('overwrite');
    expect(manifest.services).toEqual([{ id: 'ship' }]);
  });

  it('scopes to a profile and reports missing items', async () => {
    const store = await seededStore();
    await store.upsertProfile(USER, {
      name: 'work-vm',
      itemNames: ['base-settings', 'vanished'],
    });
    const manifest = await buildSetupManifest(store, USER, 'work-vm', {
      baseUrl: BASE,
      marketplaceToken: 'sc_tok',
    });
    expect(manifest.profile).toBe('work-vm');
    expect(manifest.missingItems).toEqual(['vanished']);
    expect(manifest.marketplace).toBeNull(); // no pluginable items in this profile
    expect(manifest.fileWrites.map((w) => w.itemName)).toEqual(['base-settings']);
  });

  it('falls back to all items with a note when the profile does not exist', async () => {
    const manifest = await buildSetupManifest(await seededStore(), USER, 'ghost', {
      baseUrl: BASE,
      marketplaceToken: 'sc_tok',
    });
    expect(manifest.profile).toBeNull();
    expect(manifest.notes.join(' ')).toContain('"ghost" not found');
    expect(manifest.fileWrites.length).toBeGreaterThan(0);
  });

  it('omits the marketplace step (with a note) when token/baseUrl are unavailable', async () => {
    const manifest = await buildSetupManifest(await seededStore(), USER, undefined, {});
    expect(manifest.marketplace).toBeNull();
    expect(manifest.notes.join(' ')).toContain('marketplace step omitted');
  });

  it('multi-file item with meta.targetPath treats it as a directory', async () => {
    const store = new MemorySeaChestStore();
    await store.pushItem(USER, {
      name: 'pack',
      kind: 'settings_template',
      content: {
        files: { 'a.json': '{}', 'b.json': '{}' },
        meta: { targetPath: '~/.suite/packs/' },
      },
    });
    const manifest = await buildSetupManifest(store, USER, undefined, {});
    expect(manifest.fileWrites.map((w) => w.targetPath).sort()).toEqual([
      '~/.suite/packs/a.json',
      '~/.suite/packs/b.json',
    ]);
  });
});
