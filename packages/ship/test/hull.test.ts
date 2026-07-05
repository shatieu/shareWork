import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { readServices, type StationDescriptor, type HostContext } from 'suite-conventions';
import { createHull } from '../src/hull.js';

let home: string;

/** inject() defaults its authority to localhost:80 -- once the hull knows its bound port the
 * Host guard rejects that, so every post-start inject sets an explicit matching Host header. */
const HOST_4321 = { host: '127.0.0.1:4321' };

function fakeStation(overrides: Partial<StationDescriptor> = {}): StationDescriptor & {
  calls: string[];
  contexts: HostContext[];
} {
  const calls: string[] = [];
  const contexts: HostContext[] = [];
  return {
    name: 'fake',
    tab: { id: 'fake', title: 'Fake' },
    calls,
    contexts,
    registerRoutes(app: FastifyInstance, ctx: HostContext) {
      calls.push('registerRoutes');
      contexts.push(ctx);
      app.get('/api/fake/ping', async () => ({ pong: true }));
    },
    start(ctx: HostContext) {
      calls.push('start');
      contexts.push(ctx);
    },
    stop() {
      calls.push('stop');
    },
    ...overrides,
  };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ship-hull-test-home-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('createHull (plan 03 §4.3)', () => {
  it('mounts a station: routes reachable, tab listed in /api/hull/stations', async () => {
    const station = fakeStation();
    const hull = await createHull([station], { homeDir: home, uiDistDir: join(home, 'no-ui') });

    const stations = await hull.app.inject({ method: 'GET', url: '/api/hull/stations' });
    expect(stations.statusCode).toBe(200);
    expect(stations.json()).toEqual([{ name: 'fake', tab: { id: 'fake', title: 'Fake' } }]);

    const ping = await hull.app.inject({ method: 'GET', url: '/api/fake/ping' });
    expect(ping.statusCode).toBe(200);
    expect(ping.json()).toEqual({ pong: true });
    await hull.app.close();
  });

  it('duplicate Deck tab ids are a boot error', async () => {
    const a = fakeStation();
    const b = fakeStation();
    b.name = 'other';
    await expect(createHull([a, b], { homeDir: home })).rejects.toThrow(/duplicate Deck tab id 'fake'/);
  });

  it('Host guard: evil Host -> 403 before any route; loopback Hosts pass', async () => {
    const station = fakeStation();
    const hull = await createHull([station], { homeDir: home, uiDistDir: join(home, 'no-ui') });

    const evil = await hull.app.inject({
      method: 'GET',
      url: '/api/fake/ping',
      headers: { host: 'evil.com' },
    });
    expect(evil.statusCode).toBe(403);

    const rebind = await hull.app.inject({
      method: 'GET',
      url: '/api/fake/ping',
      headers: { host: '127.0.0.1.evil.com:4317' },
    });
    expect(rebind.statusCode).toBe(403);

    for (const host of ['127.0.0.1', 'localhost:9999', '[::1]:4317']) {
      const ok = await hull.app.inject({ method: 'GET', url: '/api/fake/ping', headers: { host } });
      expect(ok.statusCode).toBe(200);
    }
    await hull.app.close();
  });

  it('after start(port) the Host guard also pins the port', async () => {
    const station = fakeStation();
    const hull = await createHull([station], { homeDir: home, uiDistDir: join(home, 'no-ui') });
    await hull.start(4321);

    const wrongPort = await hull.app.inject({
      method: 'GET',
      url: '/api/fake/ping',
      headers: { host: '127.0.0.1:4318' },
    });
    expect(wrongPort.statusCode).toBe(403);

    const right = await hull.app.inject({ method: 'GET', url: '/api/fake/ping', headers: HOST_4321 });
    expect(right.statusCode).toBe(200);

    await hull.stop();
    await hull.app.close();
  });

  it('UI static: skip-if-absent; served when the dist dir exists', async () => {
    const uiDir = join(home, 'ui-dist');
    mkdirSync(uiDir, { recursive: true });
    writeFileSync(join(uiDir, 'index.html'), '<!doctype html><title>Deck</title>', 'utf8');

    const withUi = await createHull([], { homeDir: home, uiDistDir: uiDir });
    const page = await withUi.app.inject({ method: 'GET', url: '/' });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Deck');
    await withUi.app.close();

    const withoutUi = await createHull([], { homeDir: home, uiDistDir: join(home, 'nope') });
    const miss = await withoutUi.app.inject({ method: 'GET', url: '/' });
    expect(miss.statusCode).toBe(404);
    await withoutUi.app.close();
  });

  it('/api/voyage 404s when no voyage file is configured', async () => {
    const hull = await createHull([], { homeDir: home, uiDistDir: join(home, 'no-ui') });
    const res = await hull.app.inject({ method: 'GET', url: '/api/voyage' });
    expect(res.statusCode).toBe(404);
    await hull.app.close();
  });

  it('lifecycle: registerRoutes at build (no port), start fans out with the port, services.json written and cleared', async () => {
    const station = fakeStation();
    const hull = await createHull([station], { homeDir: home, uiDistDir: join(home, 'no-ui') });
    expect(station.calls).toEqual(['registerRoutes']);
    expect(station.contexts[0].port).toBeUndefined();

    await hull.start(4321);
    expect(station.calls).toEqual(['registerRoutes', 'start']);
    expect(station.contexts[1].port).toBe(4321);

    const services = readServices(home);
    expect(services.hull).toMatchObject({ port: 4321, pid: process.pid, stations: ['fake'] });

    await hull.stop();
    expect(station.calls).toEqual(['registerRoutes', 'start', 'stop']);
    expect(readServices(home).hull).toBeUndefined();
    await hull.app.close();
  });

  it('getContract returns a mounted station contract and undefined otherwise', async () => {
    const station = fakeStation({ contracts: { greeter: { hello: () => 'ahoy' } } });
    const hull = await createHull([station], { homeDir: home, uiDistDir: join(home, 'no-ui') });
    const ctx = station.contexts[0];
    const contract = ctx.getContract<{ hello: () => string }>('fake', 'greeter');
    expect(contract?.hello()).toBe('ahoy');
    expect(ctx.getContract('fake', 'nope')).toBeUndefined();
    expect(ctx.getContract('ghost-station', 'greeter')).toBeUndefined();
    await hull.app.close();
  });
});
