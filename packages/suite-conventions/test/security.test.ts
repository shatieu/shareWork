import { describe, expect, it } from 'vitest';
import { DECK_CLIENT_HEADER, isAllowedHostHeader } from '../src/security.js';

describe('isAllowedHostHeader (hull Host-allowlist, plan 03 §4.5)', () => {
  it.each([
    ['127.0.0.1', undefined],
    ['127.0.0.1:4317', 4317],
    ['localhost', undefined],
    ['localhost:4317', 4317],
    ['LocalHost:4317', 4317],
    ['[::1]', undefined],
    ['[::1]:4317', 4317],
    ['127.0.0.1:9999', undefined], // any port allowed when the bound port isn't specified
  ])('allows %s (port %s)', (host, port) => {
    expect(isAllowedHostHeader(host, port as number | undefined)).toBe(true);
  });

  it.each([
    ['evil.com', undefined],
    ['evil.com:4317', 4317],
    ['127.0.0.1.evil.com', undefined], // rebinding-style prefix trick
    ['localhost.evil.com', undefined],
    ['127.0.0.1:4318', 4317], // wrong port for the bound hull
    ['[::1]:4318', 4317],
    ['[::1', undefined], // malformed bracket form
    ['[::1]junk', undefined],
    ['127.0.0.1:port', 4317], // non-numeric port
    ['', undefined],
    [undefined, undefined],
  ])('rejects %s (port %s)', (host, port) => {
    expect(isAllowedHostHeader(host as string | undefined, port as number | undefined)).toBe(false);
  });

  it('exports the CSRF header name the Deck client attaches', () => {
    expect(DECK_CLIENT_HEADER).toBe('x-ship-deck');
  });
});
