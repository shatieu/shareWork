import { describe, expect, it } from 'vitest';
import { decideWaitTick } from '../src/wait.js';
import type { WaitInput } from '../src/wait.js';
import type { UsageSnapshot } from '../src/types.js';

const NOW = new Date('2026-07-09T11:40:00Z');

function snap(partial: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    five_hour_pct: 95,
    seven_day_pct: 40,
    resets_at: '2026-07-09T14:00:00Z',
    checked_at: '2026-07-09T11:38:00Z',
    source: 'oauth',
    ...partial,
  };
}

function input(partial: Partial<WaitInput> = {}): WaitInput {
  return {
    now: NOW,
    snapshot: snap(),
    usageFileMtime: new Date('2026-07-09T11:38:00Z'),
    armedWindowKey: '20260709-1400',
    armedPeakPct: 95,
    lastActivityAt: new Date('2026-07-09T11:30:00Z'),
    renewalObservedAt: null,
    ...partial,
  };
}

describe('decideWaitTick', () => {
  it('self-senses when usage.json is missing', () => {
    const action = decideWaitTick(input({ snapshot: null, usageFileMtime: null }));
    expect(action.kind).toBe('self-sense');
  });

  it('self-senses when usage.json is stale (>= 12 min)', () => {
    const action = decideWaitTick(
      input({ usageFileMtime: new Date('2026-07-09T11:20:00Z') }), // 20 min old
    );
    expect(action.kind).toBe('self-sense');
    if (action.kind !== 'self-sense') throw new Error('unreachable');
    expect(action.reason).toContain('stale');
  });

  it('arms on the current window when not yet armed', () => {
    const action = decideWaitTick(input({ armedWindowKey: null, armedPeakPct: null }));
    expect(action).toEqual({ kind: 'arm', windowKey: '20260709-1400' });
  });

  it('waits while armed on the same window with normal usage', () => {
    const action = decideWaitTick(input());
    expect(action.kind).toBe('wait');
  });

  it('detects renewal on a window-key change (primary signal)', () => {
    const action = decideWaitTick(
      input({ snapshot: snap({ resets_at: '2026-07-09T19:00:00Z', five_hour_pct: 2 }) }),
    );
    expect(action.kind).toBe('renewal');
    if (action.kind !== 'renewal') throw new Error('unreachable');
    expect(action.windowKey).toBe('20260709-1900');
    expect(action.reason).toContain('window key changed');
  });

  it('window-key jitter across a minute boundary is NOT a renewal', () => {
    // The endpoint jitters resets_at sub-seconds; the rounded key must hold.
    const action = decideWaitTick(
      input({
        armedWindowKey: '20260709-1400',
        snapshot: snap({ resets_at: '2026-07-09T13:59:59.900Z' }),
      }),
    );
    expect(action.kind).toBe('wait');
  });

  it('detects renewal on pct collapse under an unchanged key (secondary signal)', () => {
    const action = decideWaitTick(
      input({ snapshot: snap({ five_hour_pct: 3 }), armedPeakPct: 95 }),
    );
    expect(action.kind).toBe('renewal');
    if (action.kind !== 'renewal') throw new Error('unreachable');
    expect(action.reason).toContain('collapsed');
  });

  it('pct below freshBelowPct alone is NOT a renewal when the window never burned', () => {
    // Arming inside an already-fresh window (session start with pct 5) must
    // not false-fire on the next tick.
    const action = decideWaitTick(
      input({ snapshot: snap({ five_hour_pct: 5 }), armedPeakPct: 5 }),
    );
    expect(action.kind).toBe('wait');
  });

  it('pct collapse without peak tracking (armedPeakPct null) is NOT a renewal', () => {
    const action = decideWaitTick(
      input({ snapshot: snap({ five_hour_pct: 3 }), armedPeakPct: null }),
    );
    expect(action.kind).toBe('wait');
  });

  it('waits inside the grace window with no activity since renewal', () => {
    const action = decideWaitTick(
      input({
        snapshot: snap({ resets_at: '2026-07-09T19:00:00Z', five_hour_pct: 2 }),
        armedWindowKey: '20260709-1900',
        renewalObservedAt: new Date('2026-07-09T11:35:00Z'), // 5 min ago, grace 10
        lastActivityAt: new Date('2026-07-09T11:00:00Z'), // before renewal
      }),
    );
    expect(action.kind).toBe('wait');
    if (action.kind !== 'wait') throw new Error('unreachable');
    expect(action.reason).toContain('grace');
  });

  it('continues after the grace window with no activity since renewal', () => {
    const action = decideWaitTick(
      input({
        snapshot: snap({ resets_at: '2026-07-09T19:00:00Z', five_hour_pct: 2 }),
        armedWindowKey: '20260709-1900',
        renewalObservedAt: new Date('2026-07-09T11:30:00Z'), // 10 min ago
        lastActivityAt: new Date('2026-07-09T11:00:00Z'), // before renewal
      }),
    );
    expect(action.kind).toBe('continue');
    if (action.kind !== 'continue') throw new Error('unreachable');
    expect(action.reason).toContain('no session activity');
  });

  it('treats "no activity ever seen" as idle in the grace phase (continues)', () => {
    const action = decideWaitTick(
      input({
        renewalObservedAt: new Date('2026-07-09T11:30:00Z'),
        lastActivityAt: null,
      }),
    );
    expect(action.kind).toBe('continue');
  });

  it('re-arms silently when activity appears after the renewal (session woke itself)', () => {
    const action = decideWaitTick(
      input({
        snapshot: snap({ resets_at: '2026-07-09T19:00:00Z', five_hour_pct: 2 }),
        armedWindowKey: '20260709-1900',
        renewalObservedAt: new Date('2026-07-09T11:30:00Z'),
        lastActivityAt: new Date('2026-07-09T11:33:00Z'), // AFTER renewal
      }),
    );
    expect(action.kind).toBe('rearm');
    if (action.kind !== 'rearm') throw new Error('unreachable');
    expect(action.windowKey).toBe('20260709-1900');
  });

  it('re-arms even past the grace deadline when activity came first', () => {
    // Late tick: 15 min since renewal, but activity at minute 3 -- the session
    // is alive; nudging it now would double-drive it.
    const action = decideWaitTick(
      input({
        renewalObservedAt: new Date('2026-07-09T11:25:00Z'),
        lastActivityAt: new Date('2026-07-09T11:28:00Z'),
      }),
    );
    expect(action.kind).toBe('rearm');
  });

  it('activity at/before the renewal instant does not count as waking', () => {
    const action = decideWaitTick(
      input({
        renewalObservedAt: new Date('2026-07-09T11:30:00Z'),
        lastActivityAt: new Date('2026-07-09T11:30:00Z'), // not strictly after
      }),
    );
    expect(action.kind).toBe('continue');
  });

  it('the sensor check outranks the grace phase (stale file mid-grace)', () => {
    const action = decideWaitTick(
      input({
        usageFileMtime: new Date('2026-07-09T11:20:00Z'),
        renewalObservedAt: new Date('2026-07-09T11:30:00Z'),
      }),
    );
    expect(action.kind).toBe('self-sense');
  });

  it('honors custom policy numbers', () => {
    // graceMinutes 3: a 5-min-old renewal already continues.
    const action = decideWaitTick(
      input({
        renewalObservedAt: new Date('2026-07-09T11:35:00Z'),
        lastActivityAt: null,
        policy: { graceMinutes: 3 },
      }),
    );
    expect(action.kind).toBe('continue');

    // collapseFromPct 50: a peak of 60 arms the secondary signal.
    const secondary = decideWaitTick(
      input({
        snapshot: snap({ five_hour_pct: 3 }),
        armedPeakPct: 60,
        policy: { collapseFromPct: 50 },
      }),
    );
    expect(secondary.kind).toBe('renewal');
  });
});
