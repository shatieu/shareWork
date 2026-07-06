import { describe, expect, it } from 'vitest';
import { parseLimitMessage, parseStatuslineJson, snapshotFromLimitMessage } from '../src/parse.js';

const NOW = new Date('2026-07-06T10:00:00Z');

describe('parseLimitMessage', () => {
  it('extracts an explicit ISO timestamp', () => {
    expect(
      parseLimitMessage('Your limit will reset at 2026-07-06T11:30:00Z.', NOW),
    ).toBe('2026-07-06T11:30:00.000Z');
  });

  it('resolves a clock time to the next occurrence after now (UTC default)', () => {
    expect(parseLimitMessage('5-hour limit reached - resets at 3:30 PM', NOW)).toBe(
      '2026-07-06T15:30:00.000Z',
    );
  });

  it('rolls past clock times to tomorrow', () => {
    expect(parseLimitMessage('resets at 6am', NOW)).toBe('2026-07-07T06:00:00.000Z');
  });

  it('applies a timezone offset for local-time messages', () => {
    // 3:30 PM at UTC+2 is 13:30 UTC.
    expect(parseLimitMessage('resets at 3:30 pm', NOW, 120)).toBe('2026-07-06T13:30:00.000Z');
  });

  it('handles bare "resets 6pm" phrasing', () => {
    expect(parseLimitMessage('limit reached | resets 6pm', NOW)).toBe(
      '2026-07-06T18:00:00.000Z',
    );
  });

  it('returns null for text without a reset time', () => {
    expect(parseLimitMessage('you are over the limit', NOW)).toBeNull();
    expect(parseLimitMessage('completely unrelated text', NOW)).toBeNull();
  });
});

describe('snapshotFromLimitMessage', () => {
  it('produces a 100% snapshot -- a limit message means the cap is hit', () => {
    const snap = snapshotFromLimitMessage('resets at 11:30', NOW);
    expect(snap).toMatchObject({
      five_hour_pct: 100,
      resets_at: '2026-07-06T11:30:00.000Z',
      source: 'limit-message',
    });
  });

  it('returns null when nothing parses', () => {
    expect(snapshotFromLimitMessage('nothing here', NOW)).toBeNull();
  });
});

describe('parseStatuslineJson', () => {
  it('reads our own usage.json shape', () => {
    const snap = parseStatuslineJson(
      {
        five_hour_pct: 61,
        seven_day_pct: 20,
        resets_at: '2026-07-06T11:30:00Z',
        checked_at: '2026-07-06T09:55:00Z',
      },
      NOW,
    );
    expect(snap).toMatchObject({
      five_hour_pct: 61,
      seven_day_pct: 20,
      resets_at: '2026-07-06T11:30:00Z',
      checked_at: '2026-07-06T09:55:00Z',
      source: 'statusline',
    });
  });

  it('reads the embedded oauth payload shape', () => {
    const snap = parseStatuslineJson(
      {
        five_hour: { utilization: 88, resets_at: '2026-07-06T11:30:00Z' },
        seven_day: { utilization: 33 },
      },
      NOW,
    );
    expect(snap).toMatchObject({ five_hour_pct: 88, seven_day_pct: 33, source: 'statusline' });
  });

  it('recurses one level into a usage envelope', () => {
    const snap = parseStatuslineJson(
      { usage: { five_hour: { utilization: 12, resets_at: '2026-07-06T11:30:00Z' } } },
      NOW,
    );
    expect(snap?.five_hour_pct).toBe(12);
  });

  it('accepts a JSON string', () => {
    const snap = parseStatuslineJson(
      JSON.stringify({ five_hour_pct: 5, resets_at: '2026-07-06T11:30:00Z' }),
      NOW,
    );
    expect(snap?.five_hour_pct).toBe(5);
  });

  it('returns null for foreign shapes and garbage, never throws', () => {
    expect(parseStatuslineJson({ model: 'opus', cost: 1 }, NOW)).toBeNull();
    expect(parseStatuslineJson('not json', NOW)).toBeNull();
    expect(parseStatuslineJson(null, NOW)).toBeNull();
    expect(parseStatuslineJson(42, NOW)).toBeNull();
  });
});
