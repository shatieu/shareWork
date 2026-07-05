import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createChartroomStation } from 'chartroom/station';
import { readServices } from 'suite-conventions';
import { createHull } from '../src/hull.js';

/** chartroom's daemon.json discovery file, read directly (its reader isn't public chartroom API
 * and this test only cares about the on-disk contract `chartroom open` consumes). */
function readDaemonJson(homeDir: string): { port: number; pid: number } | undefined {
  const path = join(homeDir, '.chartroom', 'daemon.json');
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, 'utf8')) as { port: number; pid: number };
}

let home: string;
let repoRoot: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ship-integration-home-'));
  repoRoot = mkdtempSync(join(tmpdir(), 'ship-integration-repo-'));
  mkdirSync(join(repoRoot, '.git'), { recursive: true });
  mkdirSync(join(repoRoot, 'assets'), { recursive: true });
  writeFileSync(join(repoRoot, 'guide.md'), '---\nid: guide\n---\n\n# Guide\n\n![pic](assets/pic.png)\n', 'utf8');
  writeFileSync(join(repoRoot, 'assets', 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  mkdirSync(join(home, '.chartroom'), { recursive: true });
  writeFileSync(
    join(home, '.chartroom', 'repos.json'),
    JSON.stringify({ repos: [{ id: 'repo-a', absPath: repoRoot, addedAt: 't' }] }, null, 2),
    'utf8',
  );
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('hull + real chartroom station over a temp registry (plan 03 §5 integration)', () => {
  it('one injected app serves stations list, repos, a doc, a raw asset, and both discovery files agree', async () => {
    const station = createChartroomStation({ homeDir: home });
    const hull = await createHull([station], { homeDir: home, uiDistDir: join(home, 'no-ui') });
    await hull.start(4321);
    const headers = { host: '127.0.0.1:4321' };

    try {
      const stations = await hull.app.inject({ method: 'GET', url: '/api/hull/stations', headers });
      expect(stations.json()).toEqual([{ name: 'chartroom', tab: { id: 'docs', title: 'Docs' } }]);

      const repos = await hull.app.inject({ method: 'GET', url: '/api/repos', headers });
      expect(repos.statusCode).toBe(200);
      expect(repos.json()[0]).toMatchObject({ id: 'repo-a', docCount: 1 });

      const doc = await hull.app.inject({ method: 'GET', url: '/api/repos/repo-a/docs/guide', headers });
      expect(doc.statusCode).toBe(200);
      expect(doc.json().doc.title).toBe('Guide');

      const raw = await hull.app.inject({ method: 'GET', url: '/api/repos/repo-a/raw/assets/pic.png', headers });
      expect(raw.statusCode).toBe(200);

      // Both discovery files point at the hull's port: chartroom's daemon.json (so `chartroom
      // open` finds the Deck) and the suite's services.json.
      expect(readDaemonJson(home)?.port).toBe(4321);
      expect(readServices(home).hull).toMatchObject({ port: 4321, stations: ['chartroom'] });
    } finally {
      await hull.stop();
      await hull.app.close();
    }

    expect(readDaemonJson(home)).toBeUndefined();
    expect(readServices(home).hull).toBeUndefined();
  });

  it('claude-session rides into the hull: 403 without the deck header, spawn seam reachable with it', async () => {
    // The station factory wires the real spawn; this test only proves the route is mounted and
    // guarded under the hull -- argv-level assertions live in chartroom's own suite.
    const station = createChartroomStation({ homeDir: home });
    const hull = await createHull([station], { homeDir: home, uiDistDir: join(home, 'no-ui') });
    const headers = { host: '127.0.0.1' };

    const noHeader = await hull.app.inject({
      method: 'POST',
      url: '/api/repos/repo-a/claude-session',
      headers,
    });
    expect(noHeader.statusCode).toBe(403);

    const unknownRepo = await hull.app.inject({
      method: 'POST',
      url: '/api/repos/nope/claude-session',
      headers: { ...headers, 'x-ship-deck': '1' },
    });
    expect(unknownRepo.statusCode).toBe(404);

    await hull.app.close();
  });
});
