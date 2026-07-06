import { describe, expect, it } from 'vitest';
import { sameWindow, windowKeyOf } from '../src/window.js';

describe('windowKeyOf', () => {
  it('rounds to the nearest minute so sub-second jitter yields one key', () => {
    // The exact failure of 2026-07-06: jitter across a minute boundary.
    expect(windowKeyOf('2026-07-06T06:29:59.900Z')).toBe('20260706-0630');
    expect(windowKeyOf('2026-07-06T06:30:00.100Z')).toBe('20260706-0630');
  });

  it('dedups jitter within the same minute', () => {
    expect(windowKeyOf('2026-07-06T06:30:00.001Z')).toBe(windowKeyOf('2026-07-06T06:30:00.999Z'));
  });

  it('keeps genuinely different windows apart', () => {
    expect(windowKeyOf('2026-07-06T06:30:00Z')).not.toBe(windowKeyOf('2026-07-06T11:30:00Z'));
  });

  it('produces UTC keys regardless of the offset notation', () => {
    expect(windowKeyOf('2026-07-06T08:30:00+02:00')).toBe('20260706-0630');
  });

  it('rounds a :30+ second timestamp up to the next minute', () => {
    expect(windowKeyOf('2026-07-06T06:29:31Z')).toBe('20260706-0630');
    expect(windowKeyOf('2026-07-06T06:29:29Z')).toBe('20260706-0629');
  });

  it('falls back to a sanitized literal for unparseable input', () => {
    expect(windowKeyOf('not a date!!')).toBe('not-a-date--');
  });
});

describe('sameWindow', () => {
  it('treats jittered resets_at as the same window', () => {
    expect(sameWindow('2026-07-06T06:29:59.9Z', '2026-07-06T06:30:00.1Z')).toBe(true);
    expect(sameWindow('2026-07-06T06:30:00Z', '2026-07-06T11:30:00Z')).toBe(false);
  });
});
