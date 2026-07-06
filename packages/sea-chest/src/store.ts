import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  canonicalContentJson,
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

/**
 * The Sea Chest persistence seam (Locker_Spec §3). Every operation is user-scoped by
 * construction -- there is no "list everything" surface. Two implementations ship:
 * `MemorySeaChestStore` (tests, acceptance, `sea-chest serve-local`) and
 * `SupabaseSeaChestStore` (supabase-store.ts) which Harbor constructs with its own client.
 */
export interface SeaChestStore {
  listItems(userId: string, kind?: LockerKind): Promise<LockerItemSummary[]>;
  getItem(userId: string, name: string): Promise<LockerItem | null>;
  /** Create (version 1) or version-bump on content change; identical content is `unchanged`.
   * Pushing an existing name with a different kind is a `kind_mismatch` error. */
  pushItem(userId: string, input: PushInput): Promise<PushResult>;
  updateItemMeta(
    userId: string,
    name: string,
    patch: { description?: string; published?: boolean },
  ): Promise<LockerItem>;
  listVersions(userId: string, name: string): Promise<LockerVersionSummary[]>;
  getVersion(userId: string, name: string, version: number): Promise<LockerVersion | null>;

  listProfiles(userId: string): Promise<MachineProfile[]>;
  getProfile(userId: string, name: string): Promise<MachineProfile | null>;
  upsertProfile(
    userId: string,
    input: { name: string; itemNames: string[] },
  ): Promise<MachineProfile>;

  /** Stores only the sha-256 hash; the plaintext token exists client-side only. */
  createToken(userId: string, label: string, tokenHash: string): Promise<MarketplaceTokenInfo>;
  listTokens(userId: string): Promise<MarketplaceTokenInfo[]>;
  revokeToken(userId: string, tokenId: string): Promise<boolean>;
  /** Marketplace-side lookup: hash → owner. Revoked/unknown tokens resolve to null. */
  resolveToken(tokenHash: string): Promise<{ userId: string; tokenId: string } | null>;
}

/** Mint a marketplace token. The plaintext (`sc_...`) is shown once and never stored;
 * only its sha-256 hex goes into the store. */
export function mintMarketplaceToken(): { token: string; tokenHash: string } {
  const token = `sc_${randomBytes(24).toString('base64url')}`;
  return { token, tokenHash: hashMarketplaceToken(token) };
}

export function hashMarketplaceToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time hex comparison (both sides are fixed-length sha-256 hex). */
export function tokenHashEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

interface MemoryItemRow {
  item: LockerItem;
  versions: LockerVersion[];
}

/**
 * Full-fidelity in-memory store. This is the "local mock" the whole test/acceptance surface
 * runs against; the contract test suite (test/store-contract.test.ts) runs against BOTH this
 * and the Supabase mapping to keep them behaviorally identical.
 */
export class MemorySeaChestStore implements SeaChestStore {
  private itemsByUser = new Map<string, Map<string, MemoryItemRow>>();
  private profilesByUser = new Map<string, Map<string, MachineProfile>>();
  private tokens = new Map<string, MarketplaceTokenInfo & { tokenHash: string }>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  private userItems(userId: string): Map<string, MemoryItemRow> {
    let m = this.itemsByUser.get(userId);
    if (!m) {
      m = new Map();
      this.itemsByUser.set(userId, m);
    }
    return m;
  }

  async listItems(userId: string, kind?: LockerKind): Promise<LockerItemSummary[]> {
    const rows = [...this.userItems(userId).values()]
      .map((r) => summaryOf(r.item))
      .filter((s) => (kind ? s.kind === kind : true));
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getItem(userId: string, name: string): Promise<LockerItem | null> {
    const row = this.userItems(userId).get(name);
    return row ? clone(row.item) : null;
  }

  async pushItem(userId: string, input: PushInput): Promise<PushResult> {
    const items = this.userItems(userId);
    const existing = items.get(input.name);
    const at = this.now().toISOString();
    if (!existing) {
      const item: LockerItem = {
        id: randomUUID(),
        userId,
        teamId: null,
        kind: input.kind,
        name: input.name,
        description: input.description ?? '',
        content: clone(input.content),
        version: 1,
        published: false,
        createdAt: at,
        updatedAt: at,
      };
      items.set(input.name, {
        item,
        versions: [{ itemId: item.id, version: 1, content: clone(input.content), createdAt: at }],
      });
      return { item: clone(item), outcome: 'created' };
    }
    if (existing.item.kind !== input.kind) {
      throw new SeaChestError(
        'kind_mismatch',
        `item "${input.name}" already exists with kind "${existing.item.kind}" (pushed "${input.kind}")`,
      );
    }
    if (canonicalContentJson(existing.item.content) === canonicalContentJson(input.content)) {
      if (input.description !== undefined && input.description !== existing.item.description) {
        existing.item.description = input.description;
        existing.item.updatedAt = at;
      }
      return { item: clone(existing.item), outcome: 'unchanged' };
    }
    existing.item.version += 1;
    existing.item.content = clone(input.content);
    if (input.description !== undefined) existing.item.description = input.description;
    existing.item.updatedAt = at;
    existing.versions.push({
      itemId: existing.item.id,
      version: existing.item.version,
      content: clone(input.content),
      createdAt: at,
    });
    return { item: clone(existing.item), outcome: 'bumped' };
  }

  async updateItemMeta(
    userId: string,
    name: string,
    patch: { description?: string; published?: boolean },
  ): Promise<LockerItem> {
    const row = this.userItems(userId).get(name);
    if (!row) throw new SeaChestError('not_found', `no item "${name}"`);
    if (patch.description !== undefined) row.item.description = patch.description;
    if (patch.published !== undefined) row.item.published = patch.published;
    row.item.updatedAt = this.now().toISOString();
    return clone(row.item);
  }

  async listVersions(userId: string, name: string): Promise<LockerVersionSummary[]> {
    const row = this.userItems(userId).get(name);
    if (!row) throw new SeaChestError('not_found', `no item "${name}"`);
    return row.versions
      .map(({ itemId, version, createdAt }) => ({ itemId, version, createdAt }))
      .sort((a, b) => b.version - a.version);
  }

  async getVersion(userId: string, name: string, version: number): Promise<LockerVersion | null> {
    const row = this.userItems(userId).get(name);
    if (!row) throw new SeaChestError('not_found', `no item "${name}"`);
    const v = row.versions.find((x) => x.version === version);
    return v ? clone(v) : null;
  }

  private userProfiles(userId: string): Map<string, MachineProfile> {
    let m = this.profilesByUser.get(userId);
    if (!m) {
      m = new Map();
      this.profilesByUser.set(userId, m);
    }
    return m;
  }

  async listProfiles(userId: string): Promise<MachineProfile[]> {
    return [...this.userProfiles(userId).values()]
      .map(clone)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async getProfile(userId: string, name: string): Promise<MachineProfile | null> {
    const p = this.userProfiles(userId).get(name);
    return p ? clone(p) : null;
  }

  async upsertProfile(
    userId: string,
    input: { name: string; itemNames: string[] },
  ): Promise<MachineProfile> {
    const profiles = this.userProfiles(userId);
    const at = this.now().toISOString();
    const existing = profiles.get(input.name);
    if (existing) {
      existing.itemNames = [...input.itemNames];
      existing.updatedAt = at;
      return clone(existing);
    }
    const profile: MachineProfile = {
      id: randomUUID(),
      userId,
      name: input.name,
      itemNames: [...input.itemNames],
      createdAt: at,
      updatedAt: at,
    };
    profiles.set(input.name, profile);
    return clone(profile);
  }

  async createToken(
    userId: string,
    label: string,
    tokenHash: string,
  ): Promise<MarketplaceTokenInfo> {
    const info: MarketplaceTokenInfo & { tokenHash: string } = {
      id: randomUUID(),
      userId,
      label,
      createdAt: this.now().toISOString(),
      revokedAt: null,
      tokenHash,
    };
    this.tokens.set(info.id, info);
    const { tokenHash: _omit, ...pub } = info;
    return { ...pub };
  }

  async listTokens(userId: string): Promise<MarketplaceTokenInfo[]> {
    return [...this.tokens.values()]
      .filter((t) => t.userId === userId)
      .map(({ tokenHash: _omit, ...pub }) => ({ ...pub }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async revokeToken(userId: string, tokenId: string): Promise<boolean> {
    const t = this.tokens.get(tokenId);
    if (!t || t.userId !== userId || t.revokedAt) return false;
    t.revokedAt = this.now().toISOString();
    return true;
  }

  async resolveToken(tokenHash: string): Promise<{ userId: string; tokenId: string } | null> {
    for (const t of this.tokens.values()) {
      if (!t.revokedAt && tokenHashEquals(t.tokenHash, tokenHash)) {
        return { userId: t.userId, tokenId: t.id };
      }
    }
    return null;
  }
}

function summaryOf(item: LockerItem): LockerItemSummary {
  const { content: _omit, ...summary } = item;
  return { ...summary };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
