import { gunzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serveLocal } from '../src/cli.js';
import { createFetchSeaChestClient, SeaChestClientError } from '../src/client.js';
import { readTar } from '../src/tar.js';

/**
 * End-to-end over real HTTP: the fastify dev harness (cli.ts) serving both the locker API
 * (exercised through the real fetch client the UI uses) and the token-authed marketplace.
 */

let server: Awaited<ReturnType<typeof serveLocal>>;
let base: string;

beforeAll(async () => {
  server = await serveLocal({ port: 0, user: 'local-user', seed: true });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.close();
});

describe('serve-local + fetch client', () => {
  it('drives the locker API over real HTTP', async () => {
    const client = createFetchSeaChestClient(`${base}/api/sea-chest`);
    const seeded = await client.listItems();
    expect(seeded.map((i) => i.name)).toContain('demo-skill');

    await expect(client.getItem('ghost')).rejects.toBeInstanceOf(SeaChestClientError);

    const versions = await client.listVersions('demo-skill');
    expect(versions[0].version).toBe(1);

    const updated = await client.updateItemMeta('demo-skill', { description: 'over http' });
    expect(updated.description).toBe('over http');

    const profile = await client.saveProfile('laptop-default', ['demo-skill']);
    expect(profile.itemNames).toEqual(['demo-skill']);

    const manifest = await client.setupManifest('laptop-default');
    expect(manifest.profile).toBe('laptop-default');
  });

  it('serves the seeded marketplace end-to-end: manifest → packument → tarball bytes', async () => {
    expect(server.token).toMatch(/^sc_/);
    const manifestRes = await fetch(
      `${base}/u/local-user/marketplace.json?token=${server.token}`,
    );
    expect(manifestRes.status).toBe(200);
    const manifest = (await manifestRes.json()) as {
      plugins: { name: string; source: { registry: string; package: string } }[];
    };
    expect(manifest.plugins.map((p) => p.name)).toEqual(['demo-skill']);

    const { registry, package: pkg } = manifest.plugins[0].source;
    const packumentRes = await fetch(`${registry}/${pkg}`);
    expect(packumentRes.status).toBe(200);
    const packument = (await packumentRes.json()) as {
      'dist-tags': { latest: string };
      versions: Record<string, { dist: { tarball: string } }>;
    };
    const latest = packument['dist-tags'].latest;

    const tarballRes = await fetch(packument.versions[latest].dist.tarball);
    expect(tarballRes.status).toBe(200);
    const tgz = Buffer.from(await tarballRes.arrayBuffer());
    const entries = readTar(gunzipSync(tgz));
    const skillMd = entries.find((e) => e.name === 'package/skills/demo-skill/SKILL.md');
    expect(skillMd?.content).toContain('# Demo skill');
    expect(entries.some((e) => e.name === 'package/.claude-plugin/plugin.json')).toBe(true);
  });

  it('rejects a bad token over HTTP', async () => {
    const res = await fetch(`${base}/u/local-user/marketplace.json?token=sc_wrong`);
    expect(res.status).toBe(401);
  });
});
