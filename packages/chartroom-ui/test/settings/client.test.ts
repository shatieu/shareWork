import { afterEach, describe, expect, it, vi } from 'vitest';
import { applySettingsEdit, previewSettingsEdit, SettingsApiError, simulateSettings } from '../../src/api/client.js';

/** Fetch-level contract tests for the settings-manager client leg: the deck header rides the
 * mutating POST, the apply body carries the preview's baseHash ticket, and the station's typed
 * `{error, code}` bodies come back as SettingsApiError. */

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('settings client fetch contract', () => {
  it('applySettingsEdit POSTs with the x-ship-deck header and the baseHash in the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { targetPath: 'p', changed: true }));
    vi.stubGlobal('fetch', fetchMock);

    await applySettingsEdit({ scope: 'user', newContent: '{}', baseHash: 'abc123' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/settings-manager/apply');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-ship-deck']).toBe('1');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ scope: 'user', newContent: '{}', baseHash: 'abc123' });
  });

  it('parses the station error body into a typed SettingsApiError (409 base-drift)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(409, { error: 'file changed since preview', code: 'base-drift' })),
    );

    const failure = await applySettingsEdit({ scope: 'user', newContent: '{}', baseHash: 'stale' }).catch(
      (err: unknown) => err,
    );
    expect(failure).toBeInstanceOf(SettingsApiError);
    expect((failure as SettingsApiError).status).toBe(409);
    expect((failure as SettingsApiError).code).toBe('base-drift');
    expect((failure as SettingsApiError).message).toBe('file changed since preview');
  });

  it('previewSettingsEdit and simulateSettings hit their endpoints with JSON bodies', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { baseHash: 'h', ops: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { behavior: 'allow' }));
    vi.stubGlobal('fetch', fetchMock);

    await previewSettingsEdit({ scope: 'project', project: 'C:/repos/alpha', newContent: '{}' });
    await simulateSettings({ tool: 'Bash', command: 'git status' });

    expect(fetchMock.mock.calls[0][0]).toBe('/api/settings-manager/preview');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/settings-manager/simulate');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toEqual({ tool: 'Bash', command: 'git status' });
  });
});
