import { itemNpmName, itemPackument, itemSemver, itemToNpmTarball, isPluginable } from './bundle.js';
import { hashMarketplaceToken, type SeaChestStore } from './store.js';
import type { LockerItem } from './types.js';

/**
 * The private, token-authed marketplace endpoint (Locker_Spec §2.1):
 *
 *   GET /u/<userId>/marketplace.json?token=sc_...   -> marketplace manifest (also /marketplace)
 *   GET /u/<userId>/registry/t/<token>/<pkg>        -> npm packument for one locker item
 *   GET /u/<userId>/registry/t/<token>/<pkg>/-/<pkg>-<version>.tgz -> plugin tarball
 *
 * Pure request→response function; Harbor wraps it in a Next.js route handler (README §Mount).
 * Serving shape follows the researcher-verified facts (reports/12-sea-chest-researcher.md):
 * manifest over plain HTTPS GET is native; plugin files must come from a git remote or an npm
 * registry, so entries use the documented npm source with a per-user token-scoped registry URL
 * (token in the PATH -- npm clients don't reliably preserve query strings across packument →
 * tarball fetches). Native `/plugin install` against this registry is NOT live-proven here.
 *
 * Auth: sha-256 of the presented token looked up via `store.resolveToken` (constant-time hash
 * compare inside). Missing/unknown/revoked token → 401. Valid token for a DIFFERENT user than
 * the path → 404 (no existence oracle). The store behind this handler needs service-role
 * access (RLS has no session user here); every store query is user-id-scoped in code.
 */

export interface MarketplaceRequest {
  method: string;
  /** Path + query, e.g. `/u/123/marketplace.json?token=sc_x` (absolute URLs also accepted). */
  url: string;
  headers?: Record<string, string | undefined>;
}

export interface SeaChestHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Uint8Array;
}

export interface MarketplaceOptions {
  /** Public base URL of the platform, e.g. `https://harbor.example.com` -- used to emit
   * absolute registry/tarball URLs in manifests and packuments. */
  baseUrl: string;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(status: number, payload: unknown): SeaChestHttpResponse {
  return { status, headers: { ...JSON_HEADERS }, body: `${JSON.stringify(payload, null, 2)}\n` };
}

function error(status: number, message: string): SeaChestHttpResponse {
  return json(status, { error: message });
}

export function marketplaceUrl(baseUrl: string, userId: string, token: string): string {
  return `${trimSlash(baseUrl)}/u/${encodeURIComponent(userId)}/marketplace.json?token=${encodeURIComponent(token)}`;
}

function registryBase(baseUrl: string, userId: string, token: string): string {
  return `${trimSlash(baseUrl)}/u/${encodeURIComponent(userId)}/registry/t/${encodeURIComponent(token)}`;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export async function handleMarketplaceRequest(
  store: SeaChestStore,
  request: MarketplaceRequest,
  options: MarketplaceOptions,
): Promise<SeaChestHttpResponse> {
  if (request.method.toUpperCase() !== 'GET') return error(405, 'method not allowed');

  const url = new URL(request.url, 'http://sea-chest.invalid');
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  // Expected: ['u', userId, 'marketplace.json' | 'marketplace' | 'registry', ...rest]
  if (segments.length < 3 || segments[0] !== 'u') return error(404, 'not found');
  const pathUserId = segments[1];

  if (segments[2] === 'marketplace.json' || segments[2] === 'marketplace') {
    if (segments.length !== 3) return error(404, 'not found');
    const token =
      url.searchParams.get('token') ??
      bearerToken(request.headers) ??
      null;
    const auth = await authorize(store, token, pathUserId);
    if (auth.response) return auth.response;
    return serveManifest(store, pathUserId, token!, options);
  }

  if (segments[2] === 'registry' && segments[3] === 't' && segments.length >= 6) {
    const token = segments[4];
    const auth = await authorize(store, token, pathUserId);
    if (auth.response) return auth.response;
    const rest = segments.slice(5);
    if (rest.length === 1) return servePackument(store, pathUserId, rest[0], token, options);
    if (rest.length === 3 && rest[1] === '-') {
      return serveTarball(store, pathUserId, rest[0], rest[2]);
    }
    return error(404, 'not found');
  }

  return error(404, 'not found');
}

function bearerToken(headers?: Record<string, string | undefined>): string | null {
  const raw = headers?.authorization ?? headers?.Authorization;
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match ? match[1].trim() : null;
}

async function authorize(
  store: SeaChestStore,
  token: string | null,
  pathUserId: string,
): Promise<{ response?: SeaChestHttpResponse }> {
  if (!token) return { response: error(401, 'missing marketplace token') };
  const resolved = await store.resolveToken(hashMarketplaceToken(token));
  if (!resolved) return { response: error(401, 'invalid or revoked marketplace token') };
  if (resolved.userId !== pathUserId) return { response: error(404, 'not found') };
  return {};
}

async function pluginableItems(store: SeaChestStore, userId: string): Promise<LockerItem[]> {
  const summaries = await store.listItems(userId);
  const items: LockerItem[] = [];
  for (const summary of summaries) {
    if (!isPluginable(summary)) continue;
    const item = await store.getItem(userId, summary.name);
    if (item) items.push(item);
  }
  return items;
}

async function serveManifest(
  store: SeaChestStore,
  userId: string,
  token: string,
  options: MarketplaceOptions,
): Promise<SeaChestHttpResponse> {
  const items = await pluginableItems(store, userId);
  const registry = registryBase(options.baseUrl, userId, token);
  const manifest = {
    name: `sea-chest-${userId.slice(0, 8)}`,
    owner: { name: `Sea Chest user ${userId.slice(0, 8)}` },
    metadata: {
      description: 'Private Sea Chest locker marketplace (Locker_Spec §2.1)',
      version: '1.0.0',
    },
    plugins: items.map((item) => ({
      name: item.name,
      description: item.description || `Sea Chest ${item.kind} "${item.name}"`,
      version: itemSemver(item),
      source: {
        source: 'npm' as const,
        package: itemNpmName(item),
        registry,
      },
    })),
  };
  return json(200, manifest);
}

async function servePackument(
  store: SeaChestStore,
  userId: string,
  packageName: string,
  token: string,
  options: MarketplaceOptions,
): Promise<SeaChestHttpResponse> {
  const item = await findByNpmName(store, userId, packageName);
  if (!item) return error(404, `no such package "${packageName}"`);
  const registry = registryBase(options.baseUrl, userId, token);
  const tarballUrl = `${registry}/${encodeURIComponent(packageName)}/-/${encodeURIComponent(
    `${packageName}-${itemSemver(item)}.tgz`,
  )}`;
  return json(200, itemPackument(item, tarballUrl));
}

async function serveTarball(
  store: SeaChestStore,
  userId: string,
  packageName: string,
  fileName: string,
): Promise<SeaChestHttpResponse> {
  const item = await findByNpmName(store, userId, packageName);
  if (!item) return error(404, `no such package "${packageName}"`);
  const expected = `${packageName}-${itemSemver(item)}.tgz`;
  if (fileName !== expected) return error(404, `no such tarball "${fileName}"`);
  const projection = itemToNpmTarball(item);
  return {
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(projection.tgz.length),
    },
    body: projection.tgz,
  };
}

async function findByNpmName(
  store: SeaChestStore,
  userId: string,
  packageName: string,
): Promise<LockerItem | null> {
  const items = await pluginableItems(store, userId);
  return items.find((item) => itemNpmName(item) === packageName) ?? null;
}
