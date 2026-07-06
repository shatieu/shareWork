import { describe, expect, it } from 'vitest';
import { handleSeaChestApiRequest, type SeaChestApiRequest } from '../src/api.js';
import { MemorySeaChestStore } from '../src/store.js';

const USER_A = '11111111-1111-1111-1111-111111111111';

function makeApi(store = new MemorySeaChestStore()) {
  const req = async (method: string, path: string, body?: unknown, userId = USER_A) => {
    const request: SeaChestApiRequest = { method, path, userId, body };
    const res = await handleSeaChestApiRequest(store, request, {
      baseUrl: 'https://harbor.example.com',
    });
    return { status: res.status, json: JSON.parse(res.body as string) };
  };
  return { store, req };
}

const SKILL_BODY = {
  name: 'my-skill',
  kind: 'skill',
  description: 'a skill',
  files: { 'SKILL.md': '# hi' },
};

describe('locker HTTP API', () => {
  it('push → list → get → versions lifecycle', async () => {
    const { req } = makeApi();
    const created = await req('POST', '/items', SKILL_BODY);
    expect(created.status).toBe(201);
    expect(created.json.outcome).toBe('created');

    const bumped = await req('POST', '/items', {
      ...SKILL_BODY,
      files: { 'SKILL.md': '# v2' },
    });
    expect(bumped.status).toBe(200);
    expect(bumped.json.outcome).toBe('bumped');

    const list = await req('GET', '/items?kind=skill');
    expect(list.json.items).toHaveLength(1);

    const item = await req('GET', '/items/my-skill');
    expect(item.json.item.version).toBe(2);

    const versions = await req('GET', '/items/my-skill/versions');
    expect(versions.json.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);

    const v1 = await req('GET', '/items/my-skill/versions/1');
    expect(v1.json.version.content.files['SKILL.md']).toBe('# hi');
    expect((await req('GET', '/items/my-skill/versions/none')).status).toBe(400);
    expect((await req('GET', '/items/my-skill/versions/9')).status).toBe(404);
  });

  it('PATCH updates metadata + publish toggle; validates the body', async () => {
    const { req } = makeApi();
    await req('POST', '/items', SKILL_BODY);
    const patched = await req('PATCH', '/items/my-skill', { published: true });
    expect(patched.json.item.published).toBe(true);
    expect((await req('PATCH', '/items/my-skill', {})).status).toBe(400);
    expect((await req('PATCH', '/items/ghost', { published: true })).status).toBe(404);
  });

  it('rejects malformed pushes with zod issue details', async () => {
    const { req } = makeApi();
    const bad = await req('POST', '/items', { name: 'x', kind: 'skill', files: {} });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe('invalid request body');
    const traversal = await req('POST', '/items', {
      name: 'x',
      kind: 'skill',
      files: { '../evil.md': 'x' },
    });
    expect(traversal.status).toBe(400);
    const badKind = await req('POST', '/items', { ...SKILL_BODY, kind: 'malware' });
    expect(badKind.status).toBe(400);
  });

  it('kind mismatch on re-push is a 400, concurrent-style not_found is 404', async () => {
    const { req } = makeApi();
    await req('POST', '/items', SKILL_BODY);
    const mismatch = await req('POST', '/items', { ...SKILL_BODY, kind: 'agent' });
    expect(mismatch.status).toBe(400);
    expect((await req('GET', '/items/ghost')).status).toBe(404);
  });

  it('profiles round-trip', async () => {
    const { req } = makeApi();
    await req('POST', '/items', SKILL_BODY);
    const saved = await req('PUT', '/profiles/laptop-default', { itemNames: ['my-skill'] });
    expect(saved.json.profile.itemNames).toEqual(['my-skill']);
    const listed = await req('GET', '/profiles');
    expect(listed.json.profiles).toHaveLength(1);
    expect((await req('GET', '/profiles/ghost')).status).toBe(404);
  });

  it('tokens: mint returns plaintext exactly once, list shows hashes never, revoke works', async () => {
    const { req } = makeApi();
    const minted = await req('POST', '/tokens', { label: 'laptop' });
    expect(minted.status).toBe(201);
    expect(minted.json.token).toMatch(/^sc_/);
    expect(JSON.stringify(minted.json.info)).not.toContain(minted.json.token);

    const listed = await req('GET', '/tokens');
    expect(listed.json.tokens).toHaveLength(1);
    expect(JSON.stringify(listed.json)).not.toContain(minted.json.token);
    expect(JSON.stringify(listed.json)).not.toContain('tokenHash');

    const revoked = await req('POST', `/tokens/${minted.json.info.id}/revoke`);
    expect(revoked.json.revoked).toBe(true);
    expect((await req('POST', `/tokens/${minted.json.info.id}/revoke`)).status).toBe(404);
  });

  it('setup-manifest endpoint mirrors locker_setup_machine', async () => {
    const { req } = makeApi();
    await req('POST', '/items', SKILL_BODY);
    const minted = await req('POST', '/tokens', { label: 'setup' });
    const manifest = await req('POST', '/setup-manifest', {
      marketplaceToken: minted.json.token,
    });
    expect(manifest.status).toBe(200);
    expect(manifest.json.manifest.marketplace.addCommand).toContain(
      'claude plugin marketplace add',
    );
  });

  it('unknown routes and methods are 404/405', async () => {
    const { req } = makeApi();
    expect((await req('GET', '/nope')).status).toBe(404);
    expect((await req('DELETE', '/items')).status).toBe(405);
    expect((await req('DELETE', '/items/my-skill')).status).toBe(405);
  });

  it('scopes by the userId the host injects', async () => {
    const { req } = makeApi();
    await req('POST', '/items', SKILL_BODY);
    const other = await req('GET', '/items', undefined, 'someone-else');
    expect(other.json.items).toEqual([]);
  });
});
