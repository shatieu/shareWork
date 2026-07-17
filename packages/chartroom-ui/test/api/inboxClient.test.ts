import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  askHumanHash,
  fetchAskHumanSessions,
  fetchAskHumanSpec,
  fetchSessionsOverview,
  respondShipQuestion,
  sendTextToSession,
  setSessionWatched,
  submitAskHumanAnswers,
} from '../../src/api/inboxClient.js';

/** Fetch-level contract for the wave2-E routes: mutations (and the filesystem-reading askhuman
 * GETs) carry the x-ship-deck header, URLs/bodies match the stations exactly, `{error}` bodies
 * come back readable. */

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

describe('respond / send', () => {
  it('respondShipQuestion POSTs the text with the deck header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'q-1', delivery: { delivered: true } }));
    vi.stubGlobal('fetch', fetchMock);

    await respondShipQuestion('q-1', 'use staging');
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/ship-inbox/questions/q-1/respond');
    expect(init?.method).toBe('POST');
    expect(headerOf(init, 'x-ship-deck')).toBe('1');
    expect(JSON.parse(String(init?.body))).toEqual({ text: 'use staging' });
  });

  it('sendTextToSession POSTs to the exact session id and surfaces the 502 reason readably', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(502, { error: 'the fleet is unreadable right now', delivered: false }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendTextToSession('sess-42', 'hello')).rejects.toThrow('the fleet is unreadable right now');
    const [url] = lastCall(fetchMock);
    expect(url).toBe('/api/ship-inbox/sessions/sess-42/send');
  });
});

describe('watch flag', () => {
  it('setSessionWatched POSTs {watched} to ship-log with the deck header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { sessionId: 's1', watched: false }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(setSessionWatched('s1', false)).resolves.toEqual({ sessionId: 's1', watched: false });
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/ship-log/sessions/s1/watch');
    expect(headerOf(init, 'x-ship-deck')).toBe('1');
    expect(JSON.parse(String(init?.body))).toEqual({ watched: false });
  });

  it('fetchSessionsOverview GETs the console overview (no header needed on this read)', async () => {
    const body = { available: true, sessions: [], hidden: [], counts: {}, pending: null, rollup: null };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, body));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSessionsOverview()).resolves.toEqual(body);
    expect(lastCall(fetchMock)[0]).toBe('/api/ship-console/overview');
  });
});

describe('ask-human bridge', () => {
  it('fetchAskHumanSessions / fetchAskHumanSpec carry the deck header on their GETs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { cwd: 'C:/r', sessions: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await fetchAskHumanSessions('C:/repos/my proj');
    let [url, init] = lastCall(fetchMock);
    expect(url).toBe(`/api/ship-inbox/askhuman?cwd=${encodeURIComponent('C:/repos/my proj')}`);
    expect(headerOf(init, 'x-ship-deck')).toBe('1');

    fetchMock.mockResolvedValue(jsonResponse(200, { cwd: 'C:/r', sessionId: 's', questions: [] }));
    await fetchAskHumanSpec('C:/repos/my proj', 'auth-strategy');
    [url, init] = lastCall(fetchMock);
    expect(url).toBe(
      `/api/ship-inbox/askhuman/spec?cwd=${encodeURIComponent('C:/repos/my proj')}&session=auth-strategy`,
    );
    expect(headerOf(init, 'x-ship-deck')).toBe('1');
  });

  it('submitAskHumanAnswers POSTs the ordered answers payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, path: 'x/answers.json' }));
    vi.stubGlobal('fetch', fetchMock);

    await submitAskHumanAnswers('C:/r', 's1', [{ id: 'a', type: 'text', value: 'hi' }]);
    const [url, init] = lastCall(fetchMock);
    expect(url).toBe('/api/ship-inbox/askhuman/answers');
    expect(JSON.parse(String(init?.body))).toEqual({
      cwd: 'C:/r',
      session: 's1',
      answers: [{ id: 'a', type: 'text', value: 'hi' }],
    });
    expect(headerOf(init, 'x-ship-deck')).toBe('1');
  });

  it('askHumanHash encodes cwd and session for the Deck route', () => {
    expect(askHumanHash('C:\\repos\\proj', 'auth-strategy')).toBe(
      `#/askhuman/${encodeURIComponent('C:\\repos\\proj')}/auth-strategy`,
    );
  });
});
