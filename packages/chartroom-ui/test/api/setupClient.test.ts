import { afterEach, describe, expect, it, vi } from 'vitest';
import { fsListRequest, repoSetupApply, repoSetupAudit, repoSetupRun } from '../../src/api/client.js';

/** Fetch-level contract for the deck-onboarding-wizard routes (plan API contract): the CSRF
 * header rides EVERY call (the whole route family is deck-header-guarded, GETs included), bodies
 * match the contract exactly, and `{error}` bodies come back readable. */

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit | undefined] {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit | undefined];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fsListRequest fetch contract', () => {
  it('GETs /api/fs/list with the x-ship-deck header; no path param on the roots view', async () => {
    const roots = { path: null, parent: null, entries: [{ name: 'C:\\', path: 'C:\\', isGitRepo: false }] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, roots));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fsListRequest()).resolves.toEqual(roots);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/fs/list');
    expect((init?.headers as Record<string, string>)['x-ship-deck']).toBe('1');
  });

  it('encodes the path query param', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { path: 'C:\\a b', parent: 'C:\\', entries: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await fsListRequest('C:\\a b');
    expect(lastCall(fetchMock)[0]).toBe(`/api/fs/list?path=${encodeURIComponent('C:\\a b')}`);
  });

  it("parses the daemon's {error} body on a 404 unreadable path", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(404, { error: 'path not readable: C:\\gone' })));
    await expect(fsListRequest('C:\\gone')).rejects.toThrow('path not readable: C:\\gone');
  });
});

describe('repo-setup fetch contracts', () => {
  it('repoSetupAudit GETs /api/repos/:id/setup with the header, repo id encoded', async () => {
    const audit = { repoId: 'a b', items: [] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, audit));
    vi.stubGlobal('fetch', fetchMock);

    await expect(repoSetupAudit('a b')).resolves.toEqual(audit);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/repos/a%20b/setup');
    expect(init?.method).toBeUndefined();
    expect((init?.headers as Record<string, string>)['x-ship-deck']).toBe('1');
  });

  it('repoSetupApply POSTs { apply: [ids] } with header + content-type', async () => {
    const response = { results: [{ id: 'chartroom-init', ok: true, detail: 'done' }] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, response));
    vi.stubGlobal('fetch', fetchMock);

    await expect(repoSetupApply('alpha', ['chartroom-init', 'lookout-init'])).resolves.toEqual(response);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/repos/alpha/setup');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['x-ship-deck']).toBe('1');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({ apply: ['chartroom-init', 'lookout-init'] });
  });

  it('repoSetupApply surfaces the 400 {error} body (human ids are rejected server-side)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(400, { error: 'plugin-install is a human step, not applyable' })),
    );
    await expect(repoSetupApply('alpha', ['plugin-install'])).rejects.toThrow(
      'plugin-install is a human step, not applyable',
    );
  });

  it('repoSetupRun POSTs { itemId } to /setup/run with the header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(repoSetupRun('alpha', 'plugin-install')).resolves.toEqual({ ok: true });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/repos/alpha/setup/run');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['x-ship-deck']).toBe('1');
    expect(JSON.parse(init?.body as string)).toEqual({ itemId: 'plugin-install' });
  });

  it('falls back to a status-carrying message when the error body is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}), text: async () => '' } as unknown as Response),
    );
    await expect(repoSetupAudit('alpha')).rejects.toThrow('chartroom-ui: setup audit failed with status 500');
  });
});
