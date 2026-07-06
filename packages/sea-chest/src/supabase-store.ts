import {
  canonicalContentJson,
  type LockerContent,
  type LockerItem,
  type LockerItemSummary,
  type LockerKind,
  type LockerVersion,
  type LockerVersionSummary,
  type MachineProfile,
  type MarketplaceTokenInfo,
  type PushInput,
  type PushResult,
  SeaChestError,
} from './types.js';
import type { SeaChestStore } from './store.js';

/**
 * Structural subset of the PostgREST query-builder surface this store uses. Harbor passes its
 * existing `@supabase/supabase-js` client (which satisfies this shape at runtime); tests pass
 * the in-memory mock (test/postgrest-mock.ts). Kept structural on purpose so `sea-chest` has
 * ZERO Supabase dependency -- the client is the seam.
 *
 * NOT PROVEN HERE: compile-time assignability of the real supabase-js client type (the dep is
 * deliberately absent). The runtime method subset (from/select/insert/update/eq/is/order/
 * maybeSingle/single, awaitable builder) is the stable public PostgREST-js API.
 */
export interface PgRow {
  [column: string]: unknown;
}

export interface PgResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

export interface PgBuilder extends PromiseLike<PgResult<PgRow[]>> {
  select(columns?: string): PgBuilder;
  insert(values: PgRow | PgRow[]): PgBuilder;
  update(values: PgRow): PgBuilder;
  eq(column: string, value: unknown): PgBuilder;
  is(column: string, value: null): PgBuilder;
  order(column: string, opts?: { ascending?: boolean }): PgBuilder;
  maybeSingle(): PromiseLike<PgResult<PgRow>>;
  single(): PromiseLike<PgResult<PgRow>>;
}

export interface PostgrestLikeClient {
  from(table: string): PgBuilder;
}

const ITEM_SUMMARY_COLS =
  'id,user_id,team_id,kind,name,description,version,published,created_at,updated_at';
const ITEM_COLS = `${ITEM_SUMMARY_COLS},content`;

export interface SupabaseSeaChestStoreOptions {
  now?: () => Date;
  /** Table name prefix, default none (tables live in the platform schema as-is). */
  tablePrefix?: string;
}

/**
 * Supabase/PostgREST mapping of the Sea Chest store (Locker_Spec §3 tables; DDL in
 * supabase/migrations/). Every query is explicitly filtered by `user_id` IN CODE even though
 * RLS enforces the same server-side -- defense in depth, and it keeps behavior identical when
 * Harbor constructs this with a service-role client (required for `resolveToken`, which runs
 * in the unauthenticated marketplace request path; see README "Mount: marketplace route").
 */
export class SupabaseSeaChestStore implements SeaChestStore {
  private readonly now: () => Date;
  private readonly t: (name: string) => string;

  constructor(
    private readonly client: PostgrestLikeClient,
    options: SupabaseSeaChestStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    const prefix = options.tablePrefix ?? '';
    this.t = (name) => `${prefix}${name}`;
  }

  async listItems(userId: string, kind?: LockerKind): Promise<LockerItemSummary[]> {
    let q = this.client
      .from(this.t('locker_items'))
      .select(ITEM_SUMMARY_COLS)
      .eq('user_id', userId);
    if (kind) q = q.eq('kind', kind);
    const { data, error } = await q.order('name', { ascending: true });
    if (error) throw storeError(error);
    return (data ?? []).map(rowToSummary);
  }

  async getItem(userId: string, name: string): Promise<LockerItem | null> {
    const { data, error } = await this.client
      .from(this.t('locker_items'))
      .select(ITEM_COLS)
      .eq('user_id', userId)
      .eq('name', name)
      .maybeSingle();
    if (error) throw storeError(error);
    return data ? rowToItem(data) : null;
  }

  async pushItem(userId: string, input: PushInput): Promise<PushResult> {
    const existing = await this.getItem(userId, input.name);
    const at = this.now().toISOString();

    if (!existing) {
      const { data, error } = await this.client
        .from(this.t('locker_items'))
        .insert({
          user_id: userId,
          kind: input.kind,
          name: input.name,
          description: input.description ?? '',
          content: input.content,
          version: 1,
          published: false,
          created_at: at,
          updated_at: at,
        })
        .select(ITEM_COLS)
        .single();
      if (error) {
        // Unique-violation race (another session created it between read and insert):
        // fall through to the bump path exactly once.
        if (error.code === '23505') return this.pushItem(userId, input);
        throw storeError(error);
      }
      const item = rowToItem(data!);
      await this.insertVersionRow(item.id, 1, input.content, at);
      return { item, outcome: 'created' };
    }

    if (existing.kind !== input.kind) {
      throw new SeaChestError(
        'kind_mismatch',
        `item "${input.name}" already exists with kind "${existing.kind}" (pushed "${input.kind}")`,
      );
    }

    if (canonicalContentJson(existing.content) === canonicalContentJson(input.content)) {
      if (input.description !== undefined && input.description !== existing.description) {
        const updated = await this.updateItemMeta(userId, input.name, {
          description: input.description,
        });
        return { item: updated, outcome: 'unchanged' };
      }
      return { item: existing, outcome: 'unchanged' };
    }

    const nextVersion = existing.version + 1;
    const patch: PgRow = {
      version: nextVersion,
      content: input.content,
      updated_at: at,
    };
    if (input.description !== undefined) patch.description = input.description;
    const { data, error } = await this.client
      .from(this.t('locker_items'))
      .update(patch)
      .eq('id', existing.id)
      .eq('user_id', userId)
      // Optimistic concurrency: only bump from the version we read.
      .eq('version', existing.version)
      .select(ITEM_COLS)
      .maybeSingle();
    if (error) throw storeError(error);
    if (!data) {
      throw new SeaChestError(
        'conflict',
        `concurrent update of "${input.name}" -- re-read and push again`,
      );
    }
    const item = rowToItem(data);
    await this.insertVersionRow(item.id, nextVersion, input.content, at);
    return { item, outcome: 'bumped' };
  }

  private async insertVersionRow(
    itemId: string,
    version: number,
    content: LockerContent,
    at: string,
  ): Promise<void> {
    const { error } = await this.client.from(this.t('locker_versions')).insert({
      item_id: itemId,
      version,
      content,
      created_at: at,
    });
    if (error && error.code !== '23505') throw storeError(error);
  }

  async updateItemMeta(
    userId: string,
    name: string,
    patch: { description?: string; published?: boolean },
  ): Promise<LockerItem> {
    const row: PgRow = { updated_at: this.now().toISOString() };
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.published !== undefined) row.published = patch.published;
    const { data, error } = await this.client
      .from(this.t('locker_items'))
      .update(row)
      .eq('user_id', userId)
      .eq('name', name)
      .select(ITEM_COLS)
      .maybeSingle();
    if (error) throw storeError(error);
    if (!data) throw new SeaChestError('not_found', `no item "${name}"`);
    return rowToItem(data);
  }

  async listVersions(userId: string, name: string): Promise<LockerVersionSummary[]> {
    const item = await this.getItem(userId, name);
    if (!item) throw new SeaChestError('not_found', `no item "${name}"`);
    const { data, error } = await this.client
      .from(this.t('locker_versions'))
      .select('item_id,version,created_at')
      .eq('item_id', item.id)
      .order('version', { ascending: false });
    if (error) throw storeError(error);
    return (data ?? []).map((r) => ({
      itemId: String(r.item_id),
      version: Number(r.version),
      createdAt: String(r.created_at),
    }));
  }

  async getVersion(userId: string, name: string, version: number): Promise<LockerVersion | null> {
    const item = await this.getItem(userId, name);
    if (!item) throw new SeaChestError('not_found', `no item "${name}"`);
    const { data, error } = await this.client
      .from(this.t('locker_versions'))
      .select('item_id,version,content,created_at')
      .eq('item_id', item.id)
      .eq('version', version)
      .maybeSingle();
    if (error) throw storeError(error);
    if (!data) return null;
    return {
      itemId: String(data.item_id),
      version: Number(data.version),
      content: data.content as LockerContent,
      createdAt: String(data.created_at),
    };
  }

  async listProfiles(userId: string): Promise<MachineProfile[]> {
    const { data, error } = await this.client
      .from(this.t('machine_profiles'))
      .select('*')
      .eq('user_id', userId)
      .order('name', { ascending: true });
    if (error) throw storeError(error);
    return (data ?? []).map(rowToProfile);
  }

  async getProfile(userId: string, name: string): Promise<MachineProfile | null> {
    const { data, error } = await this.client
      .from(this.t('machine_profiles'))
      .select('*')
      .eq('user_id', userId)
      .eq('name', name)
      .maybeSingle();
    if (error) throw storeError(error);
    return data ? rowToProfile(data) : null;
  }

  async upsertProfile(
    userId: string,
    input: { name: string; itemNames: string[] },
  ): Promise<MachineProfile> {
    const at = this.now().toISOString();
    const existing = await this.getProfile(userId, input.name);
    if (existing) {
      const { data, error } = await this.client
        .from(this.t('machine_profiles'))
        .update({ item_names: input.itemNames, updated_at: at })
        .eq('user_id', userId)
        .eq('name', input.name)
        .select('*')
        .maybeSingle();
      if (error) throw storeError(error);
      if (!data) throw new SeaChestError('conflict', `profile "${input.name}" vanished mid-update`);
      return rowToProfile(data);
    }
    const { data, error } = await this.client
      .from(this.t('machine_profiles'))
      .insert({
        user_id: userId,
        name: input.name,
        item_names: input.itemNames,
        created_at: at,
        updated_at: at,
      })
      .select('*')
      .single();
    if (error) throw storeError(error);
    return rowToProfile(data!);
  }

  async createToken(
    userId: string,
    label: string,
    tokenHash: string,
  ): Promise<MarketplaceTokenInfo> {
    const { data, error } = await this.client
      .from(this.t('marketplace_tokens'))
      .insert({
        user_id: userId,
        label,
        token_hash: tokenHash,
        created_at: this.now().toISOString(),
        revoked_at: null,
      })
      .select('id,user_id,label,created_at,revoked_at')
      .single();
    if (error) throw storeError(error);
    return rowToToken(data!);
  }

  async listTokens(userId: string): Promise<MarketplaceTokenInfo[]> {
    const { data, error } = await this.client
      .from(this.t('marketplace_tokens'))
      .select('id,user_id,label,created_at,revoked_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw storeError(error);
    return (data ?? []).map(rowToToken);
  }

  async revokeToken(userId: string, tokenId: string): Promise<boolean> {
    const { data, error } = await this.client
      .from(this.t('marketplace_tokens'))
      .update({ revoked_at: this.now().toISOString() })
      .eq('id', tokenId)
      .eq('user_id', userId)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle();
    if (error) throw storeError(error);
    return data != null;
  }

  async resolveToken(tokenHash: string): Promise<{ userId: string; tokenId: string } | null> {
    const { data, error } = await this.client
      .from(this.t('marketplace_tokens'))
      .select('id,user_id')
      .eq('token_hash', tokenHash)
      .is('revoked_at', null)
      .maybeSingle();
    if (error) throw storeError(error);
    return data ? { userId: String(data.user_id), tokenId: String(data.id) } : null;
  }
}

function storeError(error: { message: string; code?: string }): SeaChestError {
  return new SeaChestError('store_error', `${error.code ?? 'pg'}: ${error.message}`);
}

function rowToSummary(row: PgRow): LockerItemSummary {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    teamId: row.team_id == null ? null : String(row.team_id),
    kind: row.kind as LockerItemSummary['kind'],
    name: String(row.name),
    description: String(row.description ?? ''),
    version: Number(row.version),
    published: Boolean(row.published),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToItem(row: PgRow): LockerItem {
  return { ...rowToSummary(row), content: row.content as LockerContent };
}

function rowToProfile(row: PgRow): MachineProfile {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    name: String(row.name),
    itemNames: (row.item_names as string[] | null) ?? [],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToToken(row: PgRow): MarketplaceTokenInfo {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    label: String(row.label ?? ''),
    createdAt: String(row.created_at),
    revokedAt: row.revoked_at == null ? null : String(row.revoked_at),
  };
}
