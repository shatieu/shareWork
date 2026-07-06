import { describe, expect, it } from 'vitest';
import { itemToNpmTarball } from '../src/bundle.js';
import {
  handleMarketplaceRequest,
  marketplaceUrl,
  type SeaChestHttpResponse,
} from '../src/marketplace.js';
import { MemorySeaChestStore, mintMarketplaceToken } from '../src/store.js';

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const BASE = 'https://harbor.example.com';

async function setup() {
  const store = new MemorySeaChestStore();
  await store.pushItem(USER_A, {
    name: 'my-skill',
    kind: 'skill',
    description: 'a skill',
    content: { files: { 'SKILL.md': '# hi' } },
  });
  await store.pushItem(USER_A, {
    name: 'my-template',
    kind: 'settings_template',
    content: { files: { 'settings.json': '{}' } },
  });
  const { token, tokenHash } = mintMarketplaceToken();
  await store.createToken(USER_A, 'test', tokenHash);
  const get = (url: string, headers?: Record<string, string>) =>
    handleMarketplaceRequest(store, { method: 'GET', url, headers }, { baseUrl: BASE });
  return { store, token, get };
}

function body(res: SeaChestHttpResponse): Record<string, unknown> {
  return JSON.parse(
    typeof res.body === 'string' ? res.body : Buffer.from(res.body).toString('utf8'),
  ) as Record<string, unknown>;
}

describe('marketplace manifest', () => {
  it('serves a manifest with npm sources pointing at the token-scoped registry', async () => {
    const { token, get } = await setup();
    const res = await get(`/u/${USER_A}/marketplace.json?token=${token}`);
    expect(res.status).toBe(200);
    const manifest = body(res);
    expect(manifest.name).toBe(`sea-chest-${USER_A.slice(0, 8)}`);
    const plugins = manifest.plugins as {
      name: string;
      version: string;
      source: { source: string; package: string; registry: string };
    }[];
    // Only pluginable kinds appear -- the settings_template travels via setup manifests.
    expect(plugins.map((p) => p.name)).toEqual(['my-skill']);
    expect(plugins[0].version).toBe('1.0.0');
    expect(plugins[0].source.source).toBe('npm');
    expect(plugins[0].source.package).toBe('my-skill');
    expect(plugins[0].source.registry).toBe(`${BASE}/u/${USER_A}/registry/t/${token}`);
  });

  it('accepts the token as a Bearer header too', async () => {
    const { token, get } = await setup();
    const res = await get(`/u/${USER_A}/marketplace`, { authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
  });

  it('401s on missing/unknown token, 404s on a token for a different user', async () => {
    const { token, get } = await setup();
    expect((await get(`/u/${USER_A}/marketplace.json`)).status).toBe(401);
    expect((await get(`/u/${USER_A}/marketplace.json?token=sc_nope`)).status).toBe(401);
    expect((await get(`/u/${USER_B}/marketplace.json?token=${token}`)).status).toBe(404);
  });

  it('401s after the token is revoked', async () => {
    const { store, token, get } = await setup();
    const [info] = await store.listTokens(USER_A);
    await store.revokeToken(USER_A, info.id);
    expect((await get(`/u/${USER_A}/marketplace.json?token=${token}`)).status).toBe(401);
  });

  it('rejects non-GET and unknown routes', async () => {
    const { store, token } = await setup();
    const post = await handleMarketplaceRequest(
      store,
      { method: 'POST', url: `/u/${USER_A}/marketplace.json?token=${token}` },
      { baseUrl: BASE },
    );
    expect(post.status).toBe(405);
    const bogus = await handleMarketplaceRequest(
      store,
      { method: 'GET', url: `/x/y/z` },
      { baseUrl: BASE },
    );
    expect(bogus.status).toBe(404);
  });
});

describe('registry projection', () => {
  it('serves a packument whose tarball URL serves the exact advertised bytes', async () => {
    const { store, token, get } = await setup();
    const packumentRes = await get(`/u/${USER_A}/registry/t/${token}/my-skill`);
    expect(packumentRes.status).toBe(200);
    const doc = body(packumentRes);
    const versions = doc.versions as Record<
      string,
      { dist: { tarball: string; shasum: string } }
    >;
    const dist = versions['1.0.0'].dist;
    expect(dist.tarball.startsWith(`${BASE}/u/${USER_A}/registry/t/`)).toBe(true);

    const tarballPath = dist.tarball.slice(BASE.length);
    const tarballRes = await get(tarballPath);
    expect(tarballRes.status).toBe(200);
    expect(tarballRes.headers['content-type']).toBe('application/octet-stream');

    const item = await store.getItem(USER_A, 'my-skill');
    const expected = itemToNpmTarball(item!);
    expect(Buffer.from(tarballRes.body as Uint8Array).equals(expected.tgz)).toBe(true);
    expect(expected.shasum).toBe(dist.shasum);
  });

  it('404s unknown packages, wrong tarball filenames, and non-pluginable items', async () => {
    const { token, get } = await setup();
    expect((await get(`/u/${USER_A}/registry/t/${token}/ghost`)).status).toBe(404);
    expect((await get(`/u/${USER_A}/registry/t/${token}/my-template`)).status).toBe(404);
    expect(
      (await get(`/u/${USER_A}/registry/t/${token}/my-skill/-/my-skill-9.9.9.tgz`)).status,
    ).toBe(404);
  });

  it('registry requires a valid path token', async () => {
    const { get } = await setup();
    expect((await get(`/u/${USER_A}/registry/t/sc_bogus/my-skill`)).status).toBe(401);
  });
});

describe('marketplaceUrl helper', () => {
  it('builds the documented add-URL shape', () => {
    expect(marketplaceUrl(`${BASE}/`, USER_A, 'sc_tok')).toBe(
      `${BASE}/u/${USER_A}/marketplace.json?token=sc_tok`,
    );
  });
});
