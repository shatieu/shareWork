import { describe, expect, it } from 'vitest';
import { createOauthUsageSource } from '../src/oauth.js';

function fakeClock(startIso: string) {
  let t = Date.parse(startIso);
  return {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function okResponse(fiveHourPct: number, resetsAt: string, sevenDayPct = 10) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      five_hour: { utilization: fiveHourPct, resets_at: resetsAt },
      seven_day: { utilization: sevenDayPct, resets_at: '2026-07-10T00:00:00Z' },
    }),
  } as Response;
}

describe('createOauthUsageSource', () => {
  it('fetches, maps the payload, and serves the cache inside the interval', async () => {
    const clock = fakeClock('2026-07-06T10:00:00Z');
    let calls = 0;
    const source = createOauthUsageSource({
      fetchImpl: async () => {
        calls += 1;
        return okResponse(42, '2026-07-06T11:30:00Z');
      },
      readAccessToken: () => 'token',
      minIntervalMs: 300_000,
      now: clock.now,
    });

    const first = await source.read();
    expect(first.fromCache).toBe(false);
    expect(first.snapshot).toMatchObject({
      five_hour_pct: 42,
      seven_day_pct: 10,
      resets_at: '2026-07-06T11:30:00Z',
      source: 'oauth',
    });

    clock.advance(60_000); // inside the 5-min cache window
    const second = await source.read();
    expect(second.fromCache).toBe(true);
    expect(second.snapshot?.five_hour_pct).toBe(42);
    expect(calls).toBe(1);

    clock.advance(300_000); // past the window
    await source.read();
    expect(calls).toBe(2);
  });

  it('sends the oauth beta header and bearer token', async () => {
    let seenHeaders: Record<string, string> = {};
    const source = createOauthUsageSource({
      fetchImpl: async (_url, init) => {
        seenHeaders = (init?.headers ?? {}) as Record<string, string>;
        return okResponse(1, '2026-07-06T11:30:00Z');
      },
      readAccessToken: () => 'my-token',
      now: () => new Date('2026-07-06T10:00:00Z'),
    });
    await source.read();
    expect(seenHeaders.Authorization).toBe('Bearer my-token');
    expect(seenHeaders['anthropic-beta']).toBe('oauth-2025-04-20');
  });

  it('keeps the last good snapshot (marked stale) on fetch failure and never throws', async () => {
    const clock = fakeClock('2026-07-06T10:00:00Z');
    let fail = false;
    const source = createOauthUsageSource({
      fetchImpl: async () => {
        if (fail) throw new Error('rate limited');
        return okResponse(55, '2026-07-06T11:30:00Z');
      },
      readAccessToken: () => 'token',
      minIntervalMs: 300_000,
      now: clock.now,
    });

    await source.read();
    fail = true;
    clock.advance(300_000);
    const failed = await source.read();
    expect(failed.error).toContain('rate limited');
    expect(failed.snapshot?.five_hour_pct).toBe(55);
    expect(failed.snapshot?.stale).toBe(true);
    expect(failed.fromCache).toBe(true);
  });

  it('does not hammer after a failure: retries only after the full interval', async () => {
    const clock = fakeClock('2026-07-06T10:00:00Z');
    let calls = 0;
    const source = createOauthUsageSource({
      fetchImpl: async () => {
        calls += 1;
        throw new Error('boom');
      },
      readAccessToken: () => 'token',
      minIntervalMs: 300_000,
      now: clock.now,
    });

    await source.read();
    clock.advance(30_000);
    await source.read(); // inside interval -- must not refetch
    expect(calls).toBe(1);
    clock.advance(300_000);
    await source.read();
    expect(calls).toBe(2);
  });

  it('returns a null snapshot (with error) when it has never succeeded', async () => {
    const source = createOauthUsageSource({
      fetchImpl: async () => {
        throw new Error('offline');
      },
      readAccessToken: () => 'token',
      now: () => new Date('2026-07-06T10:00:00Z'),
    });
    const result = await source.read();
    expect(result.snapshot).toBeNull();
    expect(result.error).toContain('offline');
  });

  it('treats a malformed payload as a failure, not a crash', async () => {
    const source = createOauthUsageSource({
      fetchImpl: async () =>
        ({ ok: true, status: 200, json: async () => ({ nope: true }) }) as unknown as Response,
      readAccessToken: () => 'token',
      now: () => new Date('2026-07-06T10:00:00Z'),
    });
    const result = await source.read();
    expect(result.snapshot).toBeNull();
    expect(result.error).toContain('five_hour');
  });

  it('treats an HTTP error status as a failure', async () => {
    const source = createOauthUsageSource({
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}) }) as Response,
      readAccessToken: () => 'token',
      now: () => new Date('2026-07-06T10:00:00Z'),
    });
    const result = await source.read();
    expect(result.error).toContain('429');
  });
});
