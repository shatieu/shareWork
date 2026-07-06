import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerRepoRequest } from '../../src/api/client.js';

/** Fetch-level contract for the Add-repo modal's submit leg: the CSRF header rides the POST,
 * the body is exactly `{path}`, and the daemon's `{error}` bodies come back readable. */

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

describe('registerRepoRequest fetch contract', () => {
  it('POSTs /api/repos/register with the x-ship-deck header and {path} body', async () => {
    const result = { id: 'alpha', name: 'alpha', absPath: 'C:/repos/alpha', alreadyRegistered: false };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, result));
    vi.stubGlobal('fetch', fetchMock);

    await expect(registerRepoRequest('C:/repos/alpha')).resolves.toEqual(result);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/repos/register');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['x-ship-deck']).toBe('1');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ path: 'C:/repos/alpha' });
  });

  it("parses the daemon's {error} body into the thrown Error message (400 non-repo path)", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(400, { error: 'no git repository found at or above C:/tmp/x' })),
    );
    await expect(registerRepoRequest('C:/tmp/x')).rejects.toThrow(
      'no git repository found at or above C:/tmp/x',
    );
  });

  it('falls back to a status-carrying message when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => '',
      } as unknown as Response),
    );
    await expect(registerRepoRequest('C:/repos/alpha')).rejects.toThrow(
      'chartroom-ui: register failed with status 500',
    );
  });
});
