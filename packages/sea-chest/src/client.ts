import type { SetupManifest } from './setup-machine.js';
import type {
  LockerItem,
  LockerItemSummary,
  LockerKind,
  LockerVersion,
  LockerVersionSummary,
  MachineProfile,
  MarketplaceTokenInfo,
} from './types.js';

/**
 * The UI's view of the locker API (api.ts). Components depend on THIS interface, never on
 * fetch directly -- tests inject a mock, Harbor injects `createFetchSeaChestClient` pointed
 * at wherever it mounted the API handler.
 */
export interface SeaChestClient {
  listItems(kind?: LockerKind): Promise<LockerItemSummary[]>;
  getItem(name: string): Promise<LockerItem>;
  updateItemMeta(
    name: string,
    patch: { description?: string; published?: boolean },
  ): Promise<LockerItem>;
  listVersions(name: string): Promise<LockerVersionSummary[]>;
  getVersion(name: string, version: number): Promise<LockerVersion>;
  installSnippet(name: string): Promise<{ snippet: string; note?: string }>;
  listProfiles(): Promise<MachineProfile[]>;
  saveProfile(name: string, itemNames: string[]): Promise<MachineProfile>;
  listTokens(): Promise<MarketplaceTokenInfo[]>;
  createToken(label: string): Promise<{ token: string; info: MarketplaceTokenInfo }>;
  revokeToken(tokenId: string): Promise<void>;
  setupManifest(profile?: string): Promise<SetupManifest>;
}

export class SeaChestClientError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SeaChestClientError';
  }
}

/** Fetch-backed client. `baseUrl` is where the host mounted api.ts, e.g. `/api/sea-chest`. */
export function createFetchSeaChestClient(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): SeaChestClient {
  const base = baseUrl.replace(/\/+$/, '');

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let payload: unknown = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      // fall through with empty payload; error path below reports the status
    }
    if (!res.ok) {
      const message =
        payload && typeof payload === 'object' && 'error' in payload
          ? String((payload as { error: unknown }).error)
          : `request failed (${res.status})`;
      throw new SeaChestClientError(res.status, message);
    }
    return payload as T;
  }

  return {
    listItems: async (kind) =>
      (
        await call<{ items: LockerItemSummary[] }>(
          'GET',
          kind ? `/items?kind=${encodeURIComponent(kind)}` : '/items',
        )
      ).items,
    getItem: async (name) =>
      (await call<{ item: LockerItem }>('GET', `/items/${encodeURIComponent(name)}`)).item,
    updateItemMeta: async (name, patch) =>
      (await call<{ item: LockerItem }>('PATCH', `/items/${encodeURIComponent(name)}`, patch))
        .item,
    listVersions: async (name) =>
      (
        await call<{ versions: LockerVersionSummary[] }>(
          'GET',
          `/items/${encodeURIComponent(name)}/versions`,
        )
      ).versions,
    getVersion: async (name, version) =>
      (
        await call<{ version: LockerVersion }>(
          'GET',
          `/items/${encodeURIComponent(name)}/versions/${version}`,
        )
      ).version,
    installSnippet: (name) =>
      call<{ snippet: string; note?: string }>(
        'GET',
        `/items/${encodeURIComponent(name)}/install-snippet`,
      ),
    listProfiles: async () => (await call<{ profiles: MachineProfile[] }>('GET', '/profiles')).profiles,
    saveProfile: async (name, itemNames) =>
      (
        await call<{ profile: MachineProfile }>('PUT', `/profiles/${encodeURIComponent(name)}`, {
          itemNames,
        })
      ).profile,
    listTokens: async () => (await call<{ tokens: MarketplaceTokenInfo[] }>('GET', '/tokens')).tokens,
    createToken: (label) =>
      call<{ token: string; info: MarketplaceTokenInfo }>('POST', '/tokens', { label }),
    revokeToken: async (tokenId) => {
      await call('POST', `/tokens/${encodeURIComponent(tokenId)}/revoke`);
    },
    setupManifest: async (profile) =>
      (
        await call<{ manifest: SetupManifest }>('POST', '/setup-manifest', {
          ...(profile ? { profile } : {}),
        })
      ).manifest,
  };
}
