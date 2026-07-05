import { describe, expect, it } from 'vitest';
import { shipHookEventSchema } from '../src/events.js';
import { voyageFileSchema, weightedOverallProgress } from '../src/voyage.js';

describe('hook-event schemas (Ship_Spec §2 contract seam)', () => {
  it('accepts a spec-shaped PermissionRequest with extra passthrough fields', () => {
    const parsed = shipHookEventSchema.parse({
      event: 'PermissionRequest',
      sessionId: 'sess-1',
      project: 'shareWork',
      cwd: 'C:/thisismydesign/shareWork',
      timestamp: '2026-07-05T22:00:00.000Z',
      payload: { toolName: 'Bash', toolInput: { command: 'ls' }, requestId: 'r1', raw_hook_field: true },
      cli_extra: 'kept',
    });
    expect(parsed.event).toBe('PermissionRequest');
    expect((parsed as Record<string, unknown>).cli_extra).toBe('kept');
  });

  it.each([
    ['Notification', { kind: 'agent_needs_input', message: 'need a decision' }],
    ['TaskCreated', { taskId: 't-1', subject: 'do the thing' }],
    ['TaskCompleted', { taskId: 't-1', outcome: 'done' }],
  ])('accepts %s', (event, payload) => {
    const parsed = shipHookEventSchema.parse({
      event,
      sessionId: 's',
      timestamp: '2026-07-05T22:00:00.000Z',
      payload,
    });
    expect(parsed.event).toBe(event);
  });

  it('accepts payload-less lifecycle events (Stop / SessionStart / SessionEnd)', () => {
    for (const event of ['Stop', 'SessionStart', 'SessionEnd'] as const) {
      expect(shipHookEventSchema.parse({ event, sessionId: 's', timestamp: 't' }).event).toBe(event);
    }
  });

  it('rejects an unknown event name', () => {
    expect(() =>
      shipHookEventSchema.parse({ event: 'Nonsense', sessionId: 's', timestamp: 't' }),
    ).toThrow();
  });
});

describe('voyage schema + weighted overall progress', () => {
  it('accepts a real progress.json shape (numeric ids, null difficulty, free-form status)', () => {
    const parsed = voyageFileSchema.parse({
      packages: [
        { id: 0, title: 'Charter', status: 'PASS+merged', stage_progress: 100, difficulty: 'S', remaining_guess_h: 0, updated_at: 't' },
        { id: 4, title: 'Bridge', status: 'pending', stage_progress: 0, difficulty: null, remaining_guess_h: null },
      ],
      extra_top_level: true,
    });
    expect(parsed.packages).toHaveLength(2);
  });

  it('weights match render-progress.mjs: S=1 M=2 L=3 XL=5, null counts as M', () => {
    // one finished S (weight 1) + one untouched XL (weight 5) -> 1/6 ≈ 17%
    expect(
      weightedOverallProgress([
        { stage_progress: 100, difficulty: 'S' },
        { stage_progress: 0, difficulty: 'XL' },
      ]),
    ).toBe(17);
    // null difficulty behaves exactly like M
    expect(
      weightedOverallProgress([
        { stage_progress: 50, difficulty: null },
        { stage_progress: 50, difficulty: 'M' },
      ]),
    ).toBe(50);
    expect(weightedOverallProgress([])).toBe(0);
  });
});
