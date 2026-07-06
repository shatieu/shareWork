import { describe, expect, it } from 'vitest';
import { createDecisionWaiters } from '../src/waiters.js';

describe('createDecisionWaiters', () => {
  it('notify releases every parked waiter for that id with true', async () => {
    const waiters = createDecisionWaiters();
    const a = waiters.wait('id-1', 5_000);
    const b = waiters.wait('id-1', 5_000);
    const other = waiters.wait('id-2', 200);
    expect(waiters.size()).toBe(3);

    waiters.notify('id-1');
    await expect(a).resolves.toBe(true);
    await expect(b).resolves.toBe(true);
    expect(waiters.size()).toBe(1);

    await expect(other).resolves.toBe(false); // times out untouched
    expect(waiters.size()).toBe(0);
  });

  it('timeout resolves false and cleans up; a later notify is a no-op', async () => {
    const waiters = createDecisionWaiters();
    const parked = waiters.wait('id-3', 30);
    await expect(parked).resolves.toBe(false);
    expect(waiters.size()).toBe(0);
    expect(() => waiters.notify('id-3')).not.toThrow();
  });
});
