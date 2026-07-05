import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HostContext } from 'suite-conventions';
import { createChartroomStation } from '../src/station.js';
import { readDaemonInfo } from '../src/daemon/daemon-info.js';
import { registryPath } from '../src/daemon/registry.js';

let home: string;
let repoRoot: string;

function hostContext(port?: number): HostContext {
  return {
    port,
    getContract: () => undefined,
    log: () => {},
  };
}

/** A registered temp "repo": git marker dir + one identified doc, written into a temp registry. */
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'chartroom-station-home-'));
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-station-repo-'));
  mkdirSync(join(repoRoot, '.git'), { recursive: true });
  writeFileSync(join(repoRoot, 'guide.md'), '---\nid: guide\n---\n\n# Guide\n', 'utf8');
  const registry = registryPath(home);
  mkdirSync(join(home, '.chartroom'), { recursive: true });
  writeFileSync(
    registry,
    JSON.stringify({ repos: [{ id: 'repo-a', absPath: repoRoot, addedAt: 't' }] }, null, 2),
    'utf8',
  );
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('createChartroomStation (plan 03 §4.4)', () => {
  it('exposes the station identity and the Docs tab', () => {
    const station = createChartroomStation({ homeDir: home });
    expect(station.name).toBe('chartroom');
    expect(station.tab).toEqual({ id: 'docs', title: 'Docs' });
  });

  it('factory reads the registry and builds live runtimes; registerRoutes serves the API', async () => {
    const station = createChartroomStation({ homeDir: home });
    expect(station.runtimes.map((r) => r.id)).toEqual(['repo-a']);

    const app = Fastify({ logger: false });
    await station.registerRoutes(app, hostContext());

    const repos = await app.inject({ method: 'GET', url: '/api/repos' });
    expect(repos.statusCode).toBe(200);
    expect(repos.json()[0].id).toBe('repo-a');

    const doc = await app.inject({ method: 'GET', url: '/api/repos/repo-a/docs/guide' });
    expect(doc.statusCode).toBe(200);
    expect(doc.json().doc.title).toBe('Guide');
    await app.close();
  });

  it('start() writes daemon.json with the HOST port; stop() removes it and closes watchers', async () => {
    const station = createChartroomStation({ homeDir: home });
    await station.start?.(hostContext(4399));

    const info = readDaemonInfo(home);
    expect(info?.port).toBe(4399);
    expect(info?.pid).toBe(process.pid);

    await station.stop?.();
    expect(readDaemonInfo(home)).toBeUndefined();
  });

  it('start() without a port (headless embedding) starts watchers but writes no daemon.json', async () => {
    const station = createChartroomStation({ homeDir: home });
    await station.start?.(hostContext(undefined));
    expect(readDaemonInfo(home)).toBeUndefined();
    await station.stop?.();
  });

  it('registrar persists, pushes a live runtime, and reports alreadyRegistered on repeat', async () => {
    const otherRepo = mkdtempSync(join(tmpdir(), 'chartroom-station-repo2-'));
    try {
      mkdirSync(join(otherRepo, '.git'), { recursive: true });
      writeFileSync(join(otherRepo, 'notes.md'), '---\nid: notes\n---\n\n# Notes\n', 'utf8');

      const station = createChartroomStation({ homeDir: home });
      const first = await station.registrar(otherRepo);
      expect(first.alreadyRegistered).toBe(false);
      expect(station.runtimes).toHaveLength(2);

      const again = await station.registrar(otherRepo);
      expect(again.alreadyRegistered).toBe(true);
      expect(station.runtimes).toHaveLength(2);

      // Persisted: a fresh station over the same home sees both repos.
      const rehydrated = createChartroomStation({ homeDir: home });
      expect(rehydrated.runtimes).toHaveLength(2);
      await station.stop?.();
    } finally {
      rmSync(otherRepo, { recursive: true, force: true });
    }
  });

  it('a repo registered while started gets a watcher; stop() closes it without hanging', async () => {
    const otherRepo = mkdtempSync(join(tmpdir(), 'chartroom-station-repo3-'));
    try {
      mkdirSync(join(otherRepo, '.git'), { recursive: true });
      writeFileSync(join(otherRepo, 'w.md'), '---\nid: w\n---\n\n# W\n', 'utf8');

      const station = createChartroomStation({ homeDir: home });
      await station.start?.(hostContext(4400));
      await station.registrar(otherRepo);
      // The real assertion is that stop() resolves cleanly with the late watcher included.
      await expect(Promise.resolve(station.stop?.())).resolves.toBeUndefined();
    } finally {
      rmSync(otherRepo, { recursive: true, force: true });
    }
  });
});
