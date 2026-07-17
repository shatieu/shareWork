import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addVoyageItem,
  fetchVoyageProject,
  fetchVoyageProjects,
  voyageEventsUrl,
} from '../../src/api/client.js';

/** Fetch-level contract for the wave2-D voyage routes: project URLs are encoded, the add-item
 * POST carries the x-ship-deck header, and a 409 surfaces the server's readable error. */

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

describe('voyage multi-project fetch contracts', () => {
  it('fetchVoyageProjects GETs /api/voyage/projects', async () => {
    const body = [{ id: 'default', name: 'default', file: '/x/progress.json', isDefault: true }];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVoyageProjects()).resolves.toEqual(body);
    expect(lastCall(fetchMock)[0]).toBe('/api/voyage/projects');
  });

  it('fetchVoyageProject GETs the encoded per-project route', async () => {
    const body = { file: '/x', updatedAt: 't', packages: [] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchVoyageProject('repo/a')).resolves.toEqual(body);
    expect(lastCall(fetchMock)[0]).toBe('/api/voyage/repo%2Fa');
  });

  it('voyageEventsUrl keeps the bare back-compat path for default and encodes the rest', () => {
    expect(voyageEventsUrl('default')).toBe('/api/voyage/events');
    expect(voyageEventsUrl('repo a')).toBe('/api/voyage/repo%20a/events');
  });

  it('addVoyageItem POSTs with the x-ship-deck header and unwraps the created item', async () => {
    const item = { id: 8, title: 'New', status: 'pending', stage_progress: 0, difficulty: null, remaining_guess_h: null };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { item }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(addVoyageItem('default', { title: 'New' })).resolves.toEqual(item);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/voyage/default/items');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['x-ship-deck']).toBe('1');
    expect(JSON.parse(init?.body as string)).toEqual({ title: 'New' });
  });

  it('addVoyageItem surfaces the 409 body error readably', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(409, { error: 'refusing to add item: progress.json currently fails to parse' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(addVoyageItem('default', { title: 'X' })).rejects.toThrow(/fails to parse/);
  });
});
