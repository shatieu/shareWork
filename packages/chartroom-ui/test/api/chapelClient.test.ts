import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChapelApiError,
  chapelConfess,
  chapelOpenSession,
  fetchChapelBrief,
  fetchChapelProject,
  fetchChapelProjects,
} from '../../src/api/client.js';
import {
  chapelChat,
  fetchChapelChatLog,
  fetchChapelConfession,
  fetchChapelConfessions,
} from '../../src/api/chapelClient.js';

/** Fetch-level contract for the /api/chapel routes (deck-chapel-tab plan): the x-ship-deck
 * header rides EVERY call (GETs included -- the whole family is deck-header-guarded), bodies
 * match the contract exactly, `{error}` bodies come back readable, and the session route's 501
 * surfaces as a status-carrying ChapelApiError the UI can branch on. */

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

function headerOf(init: RequestInit | undefined, name: string): string | undefined {
  return (init?.headers as Record<string, string> | undefined)?.[name];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chapel GET fetch contracts', () => {
  it('fetchChapelBrief GETs /api/chapel/brief with the x-ship-deck header (null brief is a 200)', async () => {
    const body = { brief: null, updatedAt: null };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchChapelBrief()).resolves.toEqual(body);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/chapel/brief');
    expect(init?.method).toBeUndefined();
    expect(headerOf(init, 'x-ship-deck')).toBe('1');
  });

  it('fetchChapelProjects GETs /api/chapel/projects with the header', async () => {
    const body = { projects: [{ id: 'auth-rework', updatedAt: '2026-07-09T10:00:00.000Z' }] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchChapelProjects()).resolves.toEqual(body);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/chapel/projects');
    expect(headerOf(init, 'x-ship-deck')).toBe('1');
  });

  it('fetchChapelProject encodes the dossier id and carries the header', async () => {
    const body = { id: 'a b', content: '# dossier', updatedAt: '2026-07-09T10:00:00.000Z' };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchChapelProject('a b')).resolves.toEqual(body);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/chapel/projects/a%20b');
    expect(headerOf(init, 'x-ship-deck')).toBe('1');
  });

  it("surfaces the daemon's {error} body with the status on a dossier 404", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(404, { error: 'no dossier: gone' })));
    const failure = fetchChapelProject('gone');
    await expect(failure).rejects.toThrow('no dossier: gone');
    await expect(failure).rejects.toMatchObject({ name: 'ChapelApiError', status: 404 });
  });
});

describe('chapelConfess fetch contract', () => {
  it('POSTs { text } with header + content-type; no project key when none picked', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(chapelConfess('forgive the scope creep')).resolves.toEqual({ ok: true });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/chapel/confess');
    expect(init?.method).toBe('POST');
    expect(headerOf(init, 'x-ship-deck')).toBe('1');
    expect(headerOf(init, 'Content-Type')).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({ text: 'forgive the scope creep' });
  });

  it('includes the project when one is picked', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await chapelConfess('late again', 'auth-rework');
    expect(JSON.parse(lastCall(fetchMock)[1]?.body as string)).toEqual({ text: 'late again', project: 'auth-rework' });
  });

  it('surfaces the 400 {error} body (empty text is rejected server-side)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, { error: 'confession text is required' })));
    await expect(chapelConfess('')).rejects.toThrow('confession text is required');
  });
});

describe('chapelOpenSession fetch contract', () => {
  it('POSTs /api/chapel/session with the header and no body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(chapelOpenSession()).resolves.toEqual({ ok: true });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/chapel/session');
    expect(init?.method).toBe('POST');
    expect(headerOf(init, 'x-ship-deck')).toBe('1');
    expect(init?.body).toBeUndefined();
  });

  it('a 501 (no spawn contract) throws a ChapelApiError carrying status + server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(501, { error: 'no terminal spawner mounted on this hull' })),
    );
    const failure = chapelOpenSession();
    await expect(failure).rejects.toBeInstanceOf(ChapelApiError);
    await expect(failure).rejects.toMatchObject({ status: 501, message: 'no terminal spawner mounted on this hull' });
  });

  it('falls back to a status-carrying message when the error body is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}), text: async () => '' } as unknown as Response),
    );
    await expect(fetchChapelBrief()).rejects.toThrow('chartroom-ui: chapel brief fetch failed');
  });
});

/* ── wave2-C additions (src/api/chapelClient.ts): chat + confession-history contracts ── */

describe('chapelChat fetch contract', () => {
  it('POSTs { text } to /api/chapel/chat with header + content-type and returns { reply, sessionId }', async () => {
    const body = { reply: 'Peace, Captain.', sessionId: 'chat-session-1' };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal('fetch', fetchMock);

    await expect(chapelChat('am I on course?')).resolves.toEqual(body);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/chapel/chat');
    expect(init?.method).toBe('POST');
    expect(headerOf(init, 'x-ship-deck')).toBe('1');
    expect(headerOf(init, 'Content-Type')).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({ text: 'am I on course?' });
  });

  it('a 500 (spawn failure) surfaces as a status-carrying ChapelApiError with the server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(500, { error: 'chaplain chat failed: spawn claude ENOENT' })),
    );
    const failure = chapelChat('hello?');
    await expect(failure).rejects.toBeInstanceOf(ChapelApiError);
    await expect(failure).rejects.toMatchObject({
      status: 500,
      message: 'chaplain chat failed: spawn claude ENOENT',
    });
  });
});

describe('chapel chat log + confessions fetch contracts', () => {
  it('fetchChapelChatLog GETs /api/chapel/chat/log with the header', async () => {
    const body = { messages: [{ role: 'captain', text: 'hi', at: '2026-07-17T08:00:00.000Z' }] };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchChapelChatLog()).resolves.toEqual(body);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/chapel/chat/log');
    expect(headerOf(init, 'x-ship-deck')).toBe('1');
  });

  it('fetchChapelConfessions GETs /api/chapel/confessions with the header', async () => {
    const body = {
      confessions: [
        { stamp: '2026-07-16T17-48-43-472Z', project: null, excerpt: '55555', updatedAt: '2026-07-16T17:50:11.048Z' },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchChapelConfessions()).resolves.toEqual(body);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/chapel/confessions');
    expect(headerOf(init, 'x-ship-deck')).toBe('1');
  });

  it('fetchChapelConfession encodes the stamp and surfaces a 404 {error} body', async () => {
    const body = { stamp: 'a b', project: null, text: 'sin', updatedAt: '2026-07-16T17:50:11.048Z' };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchChapelConfession('a b')).resolves.toEqual(body);
    expect(lastCall(fetchMock)[0]).toBe('/api/chapel/confessions/a%20b');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(404, { error: "unknown confession 'gone'" })));
    const failure = fetchChapelConfession('gone');
    await expect(failure).rejects.toThrow("unknown confession 'gone'");
    await expect(failure).rejects.toMatchObject({ name: 'ChapelApiError', status: 404 });
  });
});
