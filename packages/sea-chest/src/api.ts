import { z } from 'zod';
import { marketplaceUrl, type SeaChestHttpResponse } from './marketplace.js';
import { buildSetupManifest } from './setup-machine.js';
import { mintMarketplaceToken, type SeaChestStore } from './store.js';
import {
  itemNameSchema,
  lockerKindSchema,
  pushInputSchema,
  SeaChestError,
} from './types.js';

/**
 * The locker page's HTTP API (Locker_Spec §5) as a pure, framework-agnostic handler.
 * Harbor wraps it in an authenticated Next.js route (README §Mount) and passes the session's
 * `userId`; `sea-chest serve-local` (cli.ts) mounts the same handler for local development.
 * AuthN/AuthZ is the HOST's job -- this handler trusts `userId` and scopes everything to it.
 */

export interface SeaChestApiRequest {
  method: string;
  /** Path AFTER the mount prefix, e.g. `/items/my-skill/versions`. Query allowed. */
  path: string;
  userId: string;
  body?: unknown;
}

export interface SeaChestApiOptions {
  /** Public platform base URL (install snippets, setup manifests). */
  baseUrl?: string;
}

const pushBodySchema = z.object({
  name: itemNameSchema,
  kind: lockerKindSchema,
  description: z.string().max(2000).optional(),
  files: pushInputSchema.shape.content.shape.files,
  meta: z.record(z.string(), z.unknown()).optional(),
});

const metaPatchSchema = z
  .object({
    description: z.string().max(2000).optional(),
    published: z.boolean().optional(),
  })
  .refine((p) => p.description !== undefined || p.published !== undefined, {
    message: 'nothing to update',
  });

const profileBodySchema = z.object({
  itemNames: z.array(itemNameSchema).max(500),
});

const tokenBodySchema = z.object({ label: z.string().min(1).max(200) });

const setupBodySchema = z.object({
  profile: z.string().optional(),
  /** Plaintext token to embed in the manifest's marketplace URL (from a just-minted token). */
  marketplaceToken: z.string().optional(),
});

function json(status: number, payload: unknown): SeaChestHttpResponse {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: `${JSON.stringify(payload, null, 2)}\n`,
  };
}

function errorStatus(err: SeaChestError): number {
  switch (err.code) {
    case 'not_found':
      return 404;
    case 'conflict':
      return 409;
    case 'store_error':
      return 502;
    default:
      return 400;
  }
}

export async function handleSeaChestApiRequest(
  store: SeaChestStore,
  request: SeaChestApiRequest,
  options: SeaChestApiOptions = {},
): Promise<SeaChestHttpResponse> {
  try {
    return await route(store, request, options);
  } catch (err) {
    if (err instanceof SeaChestError) return json(errorStatus(err), { error: err.message });
    if (err instanceof z.ZodError) {
      return json(400, { error: 'invalid request body', issues: err.issues });
    }
    throw err;
  }
}

async function route(
  store: SeaChestStore,
  request: SeaChestApiRequest,
  options: SeaChestApiOptions,
): Promise<SeaChestHttpResponse> {
  const url = new URL(request.path, 'http://sea-chest.invalid');
  const seg = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const method = request.method.toUpperCase();
  const { userId } = request;

  if (seg[0] === 'items') {
    if (seg.length === 1) {
      if (method === 'GET') {
        const kind = url.searchParams.get('kind');
        const parsedKind = kind ? lockerKindSchema.parse(kind) : undefined;
        return json(200, { items: await store.listItems(userId, parsedKind) });
      }
      if (method === 'POST') {
        const body = pushBodySchema.parse(request.body);
        const result = await store.pushItem(userId, {
          name: body.name,
          kind: body.kind,
          description: body.description,
          content: { files: body.files, ...(body.meta ? { meta: body.meta } : {}) },
        });
        return json(result.outcome === 'created' ? 201 : 200, {
          outcome: result.outcome,
          item: result.item,
        });
      }
      return json(405, { error: 'method not allowed' });
    }

    const name = seg[1];
    if (seg.length === 2) {
      if (method === 'GET') {
        const item = await store.getItem(userId, name);
        if (!item) return json(404, { error: `no item "${name}"` });
        return json(200, { item });
      }
      if (method === 'PATCH') {
        const patch = metaPatchSchema.parse(request.body);
        return json(200, { item: await store.updateItemMeta(userId, name, patch) });
      }
      return json(405, { error: 'method not allowed' });
    }

    if (seg.length === 3 && seg[2] === 'versions' && method === 'GET') {
      return json(200, { versions: await store.listVersions(userId, name) });
    }
    if (seg.length === 4 && seg[2] === 'versions' && method === 'GET') {
      const versionNum = Number(seg[3]);
      if (!Number.isInteger(versionNum) || versionNum < 1) {
        return json(400, { error: 'bad version number' });
      }
      const version = await store.getVersion(userId, name, versionNum);
      if (!version) return json(404, { error: `no version ${versionNum} of "${name}"` });
      return json(200, { version });
    }
    if (seg.length === 3 && seg[2] === 'install-snippet' && method === 'GET') {
      const item = await store.getItem(userId, name);
      if (!item) return json(404, { error: `no item "${name}"` });
      const base = options.baseUrl ?? 'https://<your-harbor>';
      const addUrl = marketplaceUrl(base, userId, '<marketplace-token>');
      return json(200, {
        snippet:
          `claude plugin marketplace add "${addUrl}"\n` +
          `/plugin install ${item.name.toLowerCase()}@sea-chest-${userId.slice(0, 8)}`,
        note: 'replace <marketplace-token> with a token from the Tokens panel',
      });
    }
    return json(404, { error: 'not found' });
  }

  if (seg[0] === 'profiles') {
    if (seg.length === 1 && method === 'GET') {
      return json(200, { profiles: await store.listProfiles(userId) });
    }
    if (seg.length === 2) {
      if (method === 'GET') {
        const profile = await store.getProfile(userId, seg[1]);
        if (!profile) return json(404, { error: `no profile "${seg[1]}"` });
        return json(200, { profile });
      }
      if (method === 'PUT') {
        const body = profileBodySchema.parse(request.body);
        const profile = await store.upsertProfile(userId, {
          name: seg[1],
          itemNames: body.itemNames,
        });
        return json(200, { profile });
      }
    }
    return json(404, { error: 'not found' });
  }

  if (seg[0] === 'tokens') {
    if (seg.length === 1) {
      if (method === 'GET') return json(200, { tokens: await store.listTokens(userId) });
      if (method === 'POST') {
        const body = tokenBodySchema.parse(request.body);
        const { token, tokenHash } = mintMarketplaceToken();
        const info = await store.createToken(userId, body.label, tokenHash);
        // Plaintext returned exactly once; only the hash is stored.
        return json(201, { token, info });
      }
    }
    if (seg.length === 3 && seg[2] === 'revoke' && method === 'POST') {
      const revoked = await store.revokeToken(userId, seg[1]);
      return revoked
        ? json(200, { revoked: true })
        : json(404, { error: 'no such active token' });
    }
    return json(404, { error: 'not found' });
  }

  if (seg[0] === 'setup-manifest' && seg.length === 1 && method === 'POST') {
    const body = setupBodySchema.parse(request.body ?? {});
    const manifest = await buildSetupManifest(store, userId, body.profile, {
      baseUrl: options.baseUrl,
      marketplaceToken: body.marketplaceToken,
    });
    return json(200, { manifest });
  }

  return json(404, { error: 'not found' });
}
