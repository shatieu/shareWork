import { describe, expect, it } from 'vitest';
import { SupabaseSeaChestStore } from '../src/supabase-store.js';
import { PostgrestMock } from './postgrest-mock.js';

const USER_A = '11111111-1111-1111-1111-111111111111';

const SKILL = {
  name: 'my-skill',
  kind: 'skill' as const,
  content: { files: { 'SKILL.md': '# v1' } },
};

describe('SupabaseSeaChestStore mapping specifics', () => {
  it('scopes EVERY item/profile/token query by user_id in code (defense in depth under a service-role client)', async () => {
    const mock = new PostgrestMock();
    const store = new SupabaseSeaChestStore(mock);
    await store.pushItem(USER_A, SKILL);
    await store.listItems(USER_A);
    await store.getItem(USER_A, 'my-skill');
    await store.updateItemMeta(USER_A, 'my-skill', { published: true });
    await store.listProfiles(USER_A);
    await store.upsertProfile(USER_A, { name: 'p', itemNames: [] });
    await store.createToken(USER_A, 'l', 'a'.repeat(64));
    await store.listTokens(USER_A);

    const unscoped = mock.log.filter((entry) => {
      if (entry.table === 'locker_versions') return false; // scoped via owner-checked item_id
      if (entry.op === 'insert') return false; // insert carries user_id in its row values
      return !entry.filters.some((f) => f.column === 'user_id' && f.value === USER_A);
    });
    expect(unscoped).toEqual([]);
  });

  it('inserts user_id on every insert row', async () => {
    const mock = new PostgrestMock();
    const store = new SupabaseSeaChestStore(mock);
    await store.pushItem(USER_A, SKILL);
    await store.upsertProfile(USER_A, { name: 'p', itemNames: [] });
    await store.createToken(USER_A, 'l', 'b'.repeat(64));
    for (const table of ['locker_items', 'machine_profiles', 'marketplace_tokens']) {
      for (const row of mock.table(table)) expect(row.user_id).toBe(USER_A);
    }
  });

  it('writes a locker_versions row for create and for every bump', async () => {
    const mock = new PostgrestMock();
    const store = new SupabaseSeaChestStore(mock);
    await store.pushItem(USER_A, SKILL);
    await store.pushItem(USER_A, { ...SKILL, content: { files: { 'SKILL.md': '# v2' } } });
    await store.pushItem(USER_A, { ...SKILL, content: { files: { 'SKILL.md': '# v2' } } }); // unchanged
    expect(mock.table('locker_versions').map((r) => r.version)).toEqual([1, 2]);
  });

  it('optimistic concurrency: a version raced away mid-bump is a typed conflict, not a lost update', async () => {
    const mock = new PostgrestMock();
    const store = new SupabaseSeaChestStore(mock);
    await store.pushItem(USER_A, SKILL);

    mock.beforeExecute = (entry) => {
      if (entry.op === 'update' && entry.table === 'locker_items') {
        // Another session bumped between our read and our update.
        mock.beforeExecute = null;
        const row = mock.table('locker_items')[0];
        row.version = 5;
      }
    };
    await expect(
      store.pushItem(USER_A, { ...SKILL, content: { files: { 'SKILL.md': '# mine' } } }),
    ).rejects.toMatchObject({ code: 'conflict' });
    // No phantom version row for the failed bump.
    expect(mock.table('locker_versions').map((r) => r.version)).toEqual([1]);
  });

  it('create/insert race (23505) falls through to the bump path instead of erroring', async () => {
    const mock = new PostgrestMock();
    const store = new SupabaseSeaChestStore(mock);

    let raced = false;
    mock.beforeExecute = (entry) => {
      if (!raced && entry.op === 'insert' && entry.table === 'locker_items') {
        raced = true;
        // Another session created the same (user_id, name) first.
        mock.table('locker_items').push({
          id: 'aaaaaaaa-0000-0000-0000-00000000000a',
          user_id: USER_A,
          team_id: null,
          kind: 'skill',
          name: 'my-skill',
          description: '',
          content: { files: { 'SKILL.md': '# theirs' } },
          version: 1,
          published: false,
          created_at: '2026-07-06T00:00:00.000Z',
          updated_at: '2026-07-06T00:00:00.000Z',
        });
      }
    };
    const result = await store.pushItem(USER_A, SKILL);
    expect(result.outcome).toBe('bumped');
    expect(result.item.version).toBe(2);
  });

  it('surfaces backend errors as typed store_error', async () => {
    const mock = new PostgrestMock();
    const store = new SupabaseSeaChestStore(mock);
    await expect(
      store.createToken(USER_A, 'dup', 'c'.repeat(64)).then(() => store.createToken(USER_A, 'dup', 'c'.repeat(64))),
    ).rejects.toMatchObject({ code: 'store_error' });
  });

  it('honors an optional table prefix', async () => {
    const mock = new PostgrestMock();
    const store = new SupabaseSeaChestStore(mock, { tablePrefix: 'sea_' });
    await store.listItems(USER_A).catch(() => undefined);
    expect(mock.log[0]?.table).toBe('sea_locker_items');
  });
});
