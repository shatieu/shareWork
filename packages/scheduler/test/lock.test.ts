import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireLock, lockLiveness, readLock, releaseLock, touchLock } from '../src/lock.js';

const NOW = () => new Date('2026-07-06T10:00:00Z');

function tempLockPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'lookout-lock-')), 'LOCK');
}

describe('mission lock', () => {
  it('acquires a free lock and records pid + session + heartbeat', () => {
    const path = tempLockPath();
    const result = acquireLock(path, { sessionId: 's1', pid: 111, now: NOW });
    if (!result.ok) throw new Error('expected acquire');
    expect(result.lock).toMatchObject({
      pid: 111,
      sessionId: 's1',
      startedAt: '2026-07-06T10:00:00.000Z',
      heartbeatAt: '2026-07-06T10:00:00.000Z',
    });
    expect(readLock(path)?.pid).toBe(111);
  });

  it('refuses while the holder is alive with a fresh heartbeat', () => {
    const path = tempLockPath();
    acquireLock(path, { sessionId: 's1', pid: 111, now: NOW });
    const second = acquireLock(path, {
      sessionId: 's2',
      pid: 222,
      now: () => new Date('2026-07-06T10:05:00Z'),
      isPidAlive: () => true,
    });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error('unreachable');
    expect(second.holder.pid).toBe(111);
    expect(second.message).toContain('mission already owned by PID 111');
    expect(second.message).toContain('stand down');
  });

  it('reaps a lock whose pid is dead', () => {
    const path = tempLockPath();
    acquireLock(path, { sessionId: 's1', pid: 111, now: NOW });
    const second = acquireLock(path, {
      sessionId: 's2',
      pid: 222,
      now: () => new Date('2026-07-06T10:01:00Z'),
      isPidAlive: () => false,
    });
    if (!second.ok) throw new Error('expected reap');
    expect(second.reaped?.pid).toBe(111);
    expect(readLock(path)?.pid).toBe(222);
  });

  it('reaps a live-pid lock whose heartbeat aged out (hung supervisor)', () => {
    const path = tempLockPath();
    acquireLock(path, { sessionId: 's1', pid: 111, now: NOW });
    const second = acquireLock(path, {
      sessionId: 's2',
      pid: 222,
      now: () => new Date('2026-07-06T10:30:00Z'), // 30 min > 10 min stale
      isPidAlive: () => true,
    });
    expect(second.ok).toBe(true);
  });

  it('treats a corrupt lock file as stale, not fatal', () => {
    const path = tempLockPath();
    writeFileSync(path, '{broken');
    const result = acquireLock(path, { sessionId: 's1', pid: 111, now: NOW });
    expect(result.ok).toBe(true);
  });

  it('heartbeat refreshes only for the owning pid', () => {
    const path = tempLockPath();
    acquireLock(path, { sessionId: 's1', pid: 111, now: NOW });
    expect(touchLock(path, { pid: 222, now: NOW }).ok).toBe(false);
    const later = () => new Date('2026-07-06T10:20:00Z');
    expect(touchLock(path, { pid: 111, now: later }).ok).toBe(true);
    expect(readLock(path)?.heartbeatAt).toBe('2026-07-06T10:20:00.000Z');
  });

  it('pid-untracked (CLI) locks are heartbeat-governed: live while fresh, stale when aged', () => {
    const path = tempLockPath();
    // pid 0 = acquired via the short-lived CLI; the pid probe must be irrelevant.
    acquireLock(path, { sessionId: 's1', pid: 0, now: NOW });
    const whileFresh = acquireLock(path, {
      sessionId: 's2',
      pid: 0,
      now: () => new Date('2026-07-06T10:10:00Z'), // 10 min < 30
      isPidAlive: () => false, // would instantly reap a pid-tracked lock
    });
    expect(whileFresh.ok).toBe(false);
    const afterAging = acquireLock(path, {
      sessionId: 's2',
      pid: 0,
      now: () => new Date('2026-07-06T10:35:00Z'), // 35 min > 30
      isPidAlive: () => false,
    });
    expect(afterAging.ok).toBe(true);
  });

  it('sessionId owns a pid-untracked lock across CLI invocations', () => {
    const path = tempLockPath();
    acquireLock(path, { sessionId: 's1', pid: 0, now: NOW });
    // A different process (pid meaningless) with the SAME session id may
    // heartbeat and release; a foreign session may not.
    expect(touchLock(path, { pid: 999, sessionId: 's2', now: NOW }).ok).toBe(false);
    expect(touchLock(path, { pid: 999, sessionId: 's1', now: NOW }).ok).toBe(true);
    expect(releaseLock(path, { pid: 999, sessionId: 's2' }).ok).toBe(false);
    expect(releaseLock(path, { pid: 999, sessionId: 's1' }).ok).toBe(true);
  });

  it('release overwrites with released:true -- never unlinks -- and frees acquire', () => {
    const path = tempLockPath();
    acquireLock(path, { sessionId: 's1', pid: 111, now: NOW });
    expect(releaseLock(path, { pid: 222 }).ok).toBe(false); // not the owner
    expect(releaseLock(path, { pid: 111 }).ok).toBe(true);
    expect(readFileSync(path, 'utf8')).toContain('"released": true'); // file still there
    expect(lockLiveness(readLock(path))).toBe('released');
    const again = acquireLock(path, {
      sessionId: 's2',
      pid: 222,
      now: NOW,
      isPidAlive: () => true,
    });
    expect(again.ok).toBe(true);
  });
});
