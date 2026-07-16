// Folder-picker directory browser (deck-onboarding-wizard §API 1): roots view, directory-only
// listing with dot/node_modules hardening, CSRF 403, 404 misses. All via buildServer + inject --
// never a real TCP socket.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/daemon/server.js';
import type { FsBrowseResponse } from '../../src/daemon/routes/fs-browse.js';

const deckHeaders = { 'x-ship-deck': '1' };

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'chartroom-fs-browse-test-'));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function appWith(options: { platform?: NodeJS.Platform; homeDir?: string } = {}) {
  return buildServer([], { uiDistDir: join(scratch, 'no-such-ui-dist'), fsBrowse: options });
}

describe('GET /api/fs/list', () => {
  it('403s without the x-ship-deck header', async () => {
    const res = await appWith().inject({ method: 'GET', url: '/api/fs/list' });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toContain('x-ship-deck');
  });

  it('roots view on win32: drive letters, no parent', async () => {
    const res = await appWith({ platform: 'win32' }).inject({
      method: 'GET',
      url: '/api/fs/list',
      headers: deckHeaders,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as FsBrowseResponse;
    expect(body.path).toBeNull();
    expect(body.parent).toBeNull();
    expect(body.entries.length).toBeGreaterThan(0);
    for (const entry of body.entries) {
      expect(entry.path).toMatch(/^[A-Z]:\\$/);
      expect(typeof entry.isGitRepo).toBe('boolean');
    }
  });

  it('roots view elsewhere: home + / (plan §API 1)', async () => {
    const res = await appWith({ platform: 'linux', homeDir: scratch }).inject({
      method: 'GET',
      url: '/api/fs/list',
      headers: deckHeaders,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as FsBrowseResponse;
    expect(body.path).toBeNull();
    expect(body.entries.map((e) => e.path)).toEqual([scratch, '/']);
  });

  it('lists directories only, skips dot-entries and node_modules, flags git repos', async () => {
    mkdirSync(join(scratch, 'plain'));
    mkdirSync(join(scratch, 'a-repo', '.git'), { recursive: true });
    mkdirSync(join(scratch, '.hidden'));
    mkdirSync(join(scratch, 'node_modules'));
    writeFileSync(join(scratch, 'file.txt'), 'not a directory', 'utf8');

    const res = await appWith().inject({
      method: 'GET',
      url: `/api/fs/list?path=${encodeURIComponent(scratch)}`,
      headers: deckHeaders,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as FsBrowseResponse;
    expect(body.path).toBe(scratch);
    expect(body.parent).toBe(dirname(scratch));
    expect(body.entries).toEqual([
      { name: 'a-repo', path: join(scratch, 'a-repo'), isGitRepo: true },
      { name: 'plain', path: join(scratch, 'plain'), isGitRepo: false },
    ]);
  });

  it('404s a missing path and a file path', async () => {
    const missing = await appWith().inject({
      method: 'GET',
      url: `/api/fs/list?path=${encodeURIComponent(join(scratch, 'nope'))}`,
      headers: deckHeaders,
    });
    expect(missing.statusCode).toBe(404);

    writeFileSync(join(scratch, 'file.txt'), 'x', 'utf8');
    const file = await appWith().inject({
      method: 'GET',
      url: `/api/fs/list?path=${encodeURIComponent(join(scratch, 'file.txt'))}`,
      headers: deckHeaders,
    });
    expect(file.statusCode).toBe(404);
  });
});
