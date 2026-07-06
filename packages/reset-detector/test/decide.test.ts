import { describe, expect, it } from 'vitest';
import { decideGuardAction, PRINT_BG_CEILING_ENV } from '../src/decide.js';
import type { GuardInput } from '../src/decide.js';
import type { UsageSnapshot } from '../src/types.js';

const NOW = new Date('2026-07-06T11:40:00Z');

function snap(partial: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    five_hour_pct: 3,
    seven_day_pct: 10,
    resets_at: '2026-07-06T16:30:00Z',
    checked_at: '2026-07-06T11:38:00Z',
    source: 'oauth',
    ...partial,
  };
}

function input(partial: Partial<GuardInput> = {}): GuardInput {
  return {
    now: NOW,
    snapshot: snap(),
    usageFileMtime: new Date('2026-07-06T11:38:00Z'),
    lastActivityAt: new Date('2026-07-06T10:30:00Z'), // 70 min idle
    resurrectionKeys: [],
    sessionId: 'abc-123',
    resumePrompt: 'resume the mission',
    ...partial,
  };
}

describe('decideGuardAction', () => {
  it('relaunches the sensor when usage.json is missing', () => {
    const action = decideGuardAction(input({ snapshot: null, usageFileMtime: null }));
    expect(action.kind).toBe('relaunch-sensor');
  });

  it('relaunches the sensor when usage.json is stale (>= 12 min)', () => {
    const action = decideGuardAction(
      input({ usageFileMtime: new Date('2026-07-06T11:20:00Z') }), // 20 min old
    );
    expect(action.kind).toBe('relaunch-sensor');
  });

  it('does nothing while tokens are not clearly available (pct >= 20)', () => {
    const action = decideGuardAction(input({ snapshot: snap({ five_hour_pct: 95 }) }));
    expect(action).toMatchObject({ kind: 'none' });
    expect(action.reason).toContain('95');
  });

  it('does nothing while the repo is recently active (< 30 min)', () => {
    const action = decideGuardAction(
      input({ lastActivityAt: new Date('2026-07-06T11:25:00Z') }), // 15 min
    );
    expect(action.kind).toBe('none');
    expect(action.reason).toContain('active');
  });

  it('treats "no activity ever seen" as idle (resurrects)', () => {
    expect(decideGuardAction(input({ lastActivityAt: null })).kind).toBe('resurrect');
  });

  it('resurrects with a session-pinned, print-bg-safe command', () => {
    const action = decideGuardAction(input());
    if (action.kind !== 'resurrect') throw new Error(`expected resurrect, got ${action.kind}`);
    expect(action.windowKey).toBe('20260706-1630');
    expect(action.command.argv).toEqual([
      'claude',
      '--resume',
      'abc-123',
      '-p',
      'resume the mission',
      '--permission-mode',
      'bypassPermissions',
    ]);
    expect(action.command.env[PRINT_BG_CEILING_ENV]).toBe('0');
    expect(action.command.argv).not.toContain('--continue');
    expect(action.command.argv).not.toContain('-c');
  });

  it('fires at most once per window even when resets_at jitters between polls', () => {
    // Poll 1: resets_at just under the minute boundary -> resurrect.
    const first = decideGuardAction(
      input({ snapshot: snap({ resets_at: '2026-07-06T16:29:59.900Z' }) }),
    );
    if (first.kind !== 'resurrect') throw new Error(`expected resurrect, got ${first.kind}`);

    // Poll 2: same window, jittered over the boundary; the marker from poll 1
    // is on disk. Exact-string dedup would fire again (the 2026-07-06 bug);
    // the rounded window key must not.
    const second = decideGuardAction(
      input({
        snapshot: snap({ resets_at: '2026-07-06T16:30:00.100Z' }),
        resurrectionKeys: [first.windowKey],
      }),
    );
    expect(second.kind).toBe('none');
    expect(second.reason).toContain('already resurrected');
  });

  it('a genuinely new window is allowed to resurrect again', () => {
    const action = decideGuardAction(
      input({
        snapshot: snap({ resets_at: '2026-07-06T21:30:00Z' }),
        resurrectionKeys: ['20260706-1630'],
      }),
    );
    expect(action.kind).toBe('resurrect');
  });

  it('refuses (never falls back to --continue) without a pinned sessionId', () => {
    const action = decideGuardAction(input({ sessionId: null }));
    expect(action.kind).toBe('refuse');
    expect(action.reason).toContain('sessionId');
  });

  it('refuses without a resume prompt', () => {
    expect(decideGuardAction(input({ resumePrompt: null })).kind).toBe('refuse');
    expect(decideGuardAction(input({ resumePrompt: '   ' })).kind).toBe('refuse');
  });

  it('honors custom policy numbers', () => {
    const action = decideGuardAction(
      input({
        snapshot: snap({ five_hour_pct: 25 }),
        policy: { tokensAvailableBelowPct: 30 },
      }),
    );
    expect(action.kind).toBe('resurrect');
  });
});
