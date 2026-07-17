import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchTokenSession,
  fetchTokenSessions,
  TokenApiError,
} from '../../src/api/tokenClient.js';

/** Fetch-level contract for the wave2-I token routes: every request carries the x-ship-deck
 * header (the sessions routes are deck-gated), ids are URL-encoded, and 404 raises a typed
 * error so the panel can self-hide. */

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit | undefined] {
  return fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [string, RequestInit | undefined];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tokenClient', () => {
  it('fetchTokenSessions GETs /sessions with the x-ship-deck header', async () => {
    const body = { generatedAt: 't', sessions: [] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchTokenSessions()).resolves.toEqual(body);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/skill-analytics/sessions');
    expect((init?.headers as Record<string, string>)['x-ship-deck']).toBe('1');
  });

  it('fetchTokenSessions forwards project and limit as querystring', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { generatedAt: 't', sessions: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchTokenSessions({ project: 'share Work', limit: 5 });
    expect(lastCall(fetchMock)[0]).toBe('/api/skill-analytics/sessions?project=share+Work&limit=5');
  });

  it('fetchTokenSession GETs the encoded detail route with the header', async () => {
    const entry = { sessionId: 'a/b', inputTokens: 1 };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, entry));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchTokenSession('a/b')).resolves.toEqual(entry);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/skill-analytics/sessions/a%2Fb');
    expect((init?.headers as Record<string, string>)['x-ship-deck']).toBe('1');
  });

  it('raises TokenApiError with the status so callers can distinguish 404 (self-hide) from 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(404, { error: 'nope' })));
    await expect(fetchTokenSessions()).rejects.toMatchObject({
      name: 'TokenApiError',
      status: 404,
    });

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, { error: 'gated' })));
    const err = await fetchTokenSession('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TokenApiError);
    expect((err as TokenApiError).status).toBe(403);
  });
});
