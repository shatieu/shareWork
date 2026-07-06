import { describe, expect, it } from 'vitest';
import { MemorySeaChestStore, mintMarketplaceToken, type SeaChestStore } from '../src/store.js';
import { SupabaseSeaChestStore } from '../src/supabase-store.js';
import type { PushInput } from '../src/types.js';
import { PostgrestMock } from './postgrest-mock.js';

/**
 * ONE behavioral contract, run against BOTH store implementations -- the memory store (the
 * local mock everything tests against) and the Supabase mapping over the PostgREST mock.
 * Divergence here is exactly the bug class that would otherwise only surface live.
 */

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

function push(name: string, body: string, kind: PushInput['kind'] = 'skill'): PushInput {
  return { name, kind, description: `${name} desc`, content: { files: { 'SKILL.md': body } } };
}

const impls: [string, () => SeaChestStore][] = [
  ['MemorySeaChestStore', () => new MemorySeaChestStore()],
  ['SupabaseSeaChestStore', () => new SupabaseSeaChestStore(new PostgrestMock())],
];

describe.each(impls)('store contract: %s', (_label, makeStore) => {
  it('creates at version 1, bumps on changed content, reports unchanged on identical push', async () => {
    const store = makeStore();
    const created = await store.pushItem(USER_A, push('my-skill', '# v1'));
    expect(created.outcome).toBe('created');
    expect(created.item.version).toBe(1);
    expect(created.item.published).toBe(false);

    const unchanged = await store.pushItem(USER_A, push('my-skill', '# v1'));
    expect(unchanged.outcome).toBe('unchanged');
    expect(unchanged.item.version).toBe(1);

    const bumped = await store.pushItem(USER_A, push('my-skill', '# v2'));
    expect(bumped.outcome).toBe('bumped');
    expect(bumped.item.version).toBe(2);
    expect(bumped.item.content.files['SKILL.md']).toBe('# v2');
  });

  it('content equality is key-order independent (canonical JSON)', async () => {
    const store = makeStore();
    await store.pushItem(USER_A, {
      name: 'multi',
      kind: 'preset',
      content: { files: { 'a.md': 'a', 'b.md': 'b' } },
    });
    const rePush = await store.pushItem(USER_A, {
      name: 'multi',
      kind: 'preset',
      content: { files: { 'b.md': 'b', 'a.md': 'a' } },
    });
    expect(rePush.outcome).toBe('unchanged');
  });

  it('rejects a re-push under a different kind (kind_mismatch)', async () => {
    const store = makeStore();
    await store.pushItem(USER_A, push('my-skill', '# v1'));
    await expect(
      store.pushItem(USER_A, push('my-skill', '# v1', 'agent')),
    ).rejects.toMatchObject({ code: 'kind_mismatch' });
  });

  it('keeps full append-only version history', async () => {
    const store = makeStore();
    await store.pushItem(USER_A, push('my-skill', '# v1'));
    await store.pushItem(USER_A, push('my-skill', '# v2'));
    await store.pushItem(USER_A, push('my-skill', '# v3'));

    const versions = await store.listVersions(USER_A, 'my-skill');
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);

    const v2 = await store.getVersion(USER_A, 'my-skill', 2);
    expect(v2?.content.files['SKILL.md']).toBe('# v2');
    expect(await store.getVersion(USER_A, 'my-skill', 9)).toBeNull();
  });

  it('lists items sorted by name, with kind filter', async () => {
    const store = makeStore();
    await store.pushItem(USER_A, push('zeta', 'z'));
    await store.pushItem(USER_A, push('alpha', 'a'));
    await store.pushItem(USER_A, {
      name: 'my-agent',
      kind: 'agent',
      content: { files: { 'agent.md': 'a' } },
    });

    const all = await store.listItems(USER_A);
    expect(all.map((i) => i.name)).toEqual(['alpha', 'my-agent', 'zeta']);
    const skills = await store.listItems(USER_A, 'skill');
    expect(skills.map((i) => i.name)).toEqual(['alpha', 'zeta']);
    expect(all[0]).not.toHaveProperty('content');
  });

  it('isolates users from each other', async () => {
    const store = makeStore();
    await store.pushItem(USER_A, push('my-skill', '# v1'));
    expect(await store.listItems(USER_B)).toEqual([]);
    expect(await store.getItem(USER_B, 'my-skill')).toBeNull();
    await expect(store.listVersions(USER_B, 'my-skill')).rejects.toMatchObject({
      code: 'not_found',
    });
    // Same name in another locker is a fresh, independent item.
    const other = await store.pushItem(USER_B, push('my-skill', '# other'));
    expect(other.outcome).toBe('created');
    expect((await store.getItem(USER_A, 'my-skill'))?.content.files['SKILL.md']).toBe('# v1');
  });

  it('updates metadata (description, publish toggle) without touching version', async () => {
    const store = makeStore();
    await store.pushItem(USER_A, push('my-skill', '# v1'));
    const published = await store.updateItemMeta(USER_A, 'my-skill', { published: true });
    expect(published.published).toBe(true);
    expect(published.version).toBe(1);
    const renamedDesc = await store.updateItemMeta(USER_A, 'my-skill', { description: 'new' });
    expect(renamedDesc.description).toBe('new');
    await expect(store.updateItemMeta(USER_A, 'ghost', { published: true })).rejects.toMatchObject(
      { code: 'not_found' },
    );
  });

  it('upserts machine profiles per user', async () => {
    const store = makeStore();
    const created = await store.upsertProfile(USER_A, {
      name: 'laptop-default',
      itemNames: ['my-skill'],
    });
    expect(created.itemNames).toEqual(['my-skill']);
    const updated = await store.upsertProfile(USER_A, {
      name: 'laptop-default',
      itemNames: ['my-skill', 'crew'],
    });
    expect(updated.id).toBe(created.id);
    expect(updated.itemNames).toEqual(['my-skill', 'crew']);
    expect(await store.getProfile(USER_B, 'laptop-default')).toBeNull();
    expect((await store.listProfiles(USER_A)).length).toBe(1);
  });

  it('token lifecycle: mint → resolve → revoke → resolves null; wrong hash resolves null', async () => {
    const store = makeStore();
    const { token, tokenHash } = mintMarketplaceToken();
    expect(token.startsWith('sc_')).toBe(true);
    const info = await store.createToken(USER_A, 'laptop', tokenHash);
    expect(info.revokedAt).toBeNull();
    expect(info).not.toHaveProperty('tokenHash');

    expect(await store.resolveToken(tokenHash)).toMatchObject({ userId: USER_A });
    expect(await store.resolveToken(mintMarketplaceToken().tokenHash)).toBeNull();

    expect(await store.revokeToken(USER_B, info.id)).toBe(false); // not yours
    expect(await store.revokeToken(USER_A, info.id)).toBe(true);
    expect(await store.revokeToken(USER_A, info.id)).toBe(false); // already revoked
    expect(await store.resolveToken(tokenHash)).toBeNull();

    const listed = await store.listTokens(USER_A);
    expect(listed).toHaveLength(1);
    expect(listed[0].revokedAt).not.toBeNull();
    expect(await store.listTokens(USER_B)).toEqual([]);
  });
});
