import { describe, expect, it } from 'vitest';
import { fuseSignals } from '../src/fuse.js';
import type { UsageSnapshot } from '../src/types.js';

function snap(partial: Partial<UsageSnapshot>): UsageSnapshot {
  return {
    five_hour_pct: 50,
    seven_day_pct: 10,
    resets_at: '2026-07-06T11:30:00Z',
    checked_at: '2026-07-06T10:00:00Z',
    source: 'oauth',
    ...partial,
  };
}

describe('fuseSignals', () => {
  it('returns null when nothing is usable', () => {
    expect(fuseSignals([]).snapshot).toBeNull();
    expect(fuseSignals([null, undefined]).snapshot).toBeNull();
  });

  it('freshest checked_at wins across sources', () => {
    const older = snap({ source: 'oauth', checked_at: '2026-07-06T09:00:00Z', five_hour_pct: 40 });
    const newer = snap({
      source: 'limit-message',
      checked_at: '2026-07-06T10:00:00Z',
      five_hour_pct: 100,
    });
    expect(fuseSignals([older, newer]).snapshot?.source).toBe('limit-message');
  });

  it('breaks near-ties by source authority: oauth > statusline > limit-message', () => {
    const oauth = snap({ source: 'oauth', checked_at: '2026-07-06T10:00:00Z' });
    const statusline = snap({ source: 'statusline', checked_at: '2026-07-06T10:00:30Z' });
    expect(fuseSignals([statusline, oauth]).snapshot?.source).toBe('oauth');
  });

  it('a stale (cache-after-failure) snapshot loses to any fresh one', () => {
    const staleOauth = snap({ source: 'oauth', checked_at: '2026-07-06T10:00:00Z', stale: true });
    const freshStatusline = snap({ source: 'statusline', checked_at: '2026-07-06T09:50:00Z' });
    expect(fuseSignals([staleOauth, freshStatusline]).snapshot?.source).toBe('statusline');
  });

  it('flags disagreement when fresh signals point at different windows', () => {
    const a = snap({ source: 'oauth', resets_at: '2026-07-06T11:30:00Z' });
    const b = snap({
      source: 'statusline',
      resets_at: '2026-07-06T16:30:00Z',
      checked_at: '2026-07-06T10:01:00Z',
    });
    const fused = fuseSignals([a, b]);
    expect(fused.disagreement).toBe(true);
    expect(fused.snapshot?.source).toBe('oauth');
  });

  it('jittered resets_at across sources is NOT a disagreement', () => {
    const a = snap({ source: 'oauth', resets_at: '2026-07-06T11:29:59.9Z' });
    const b = snap({
      source: 'statusline',
      resets_at: '2026-07-06T11:30:00.1Z',
      checked_at: '2026-07-06T10:01:00Z',
    });
    expect(fuseSignals([a, b]).disagreement).toBe(false);
  });
});
