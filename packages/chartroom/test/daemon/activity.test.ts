import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ActivityLog, activityPath, type ActivityEvent } from '../../src/daemon/activity.js';

// All tests use a disposable temp directory as a stand-in "HOME" -- never touches the real user's
// ~/.chartroom/activity.json (same posture as registry.test.ts).
let fakeHome: string;

function event(n: number, kind: ActivityEvent['kind'] = 'repair'): ActivityEvent {
  return {
    ts: new Date(2026, 0, 1, 0, 0, n).toISOString(),
    repoId: 'repo-a',
    repoName: 'repo-a',
    kind,
    summary: `event ${n}`,
  };
}

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'chartroom-activity-test-home-'));
});

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

describe('ActivityLog (ring buffer + persistence)', () => {
  it('list() returns newest-first, honoring the limit', () => {
    const log = new ActivityLog(fakeHome);
    log.log(event(1));
    log.log(event(2));
    log.log(event(3));

    const all = log.list(50);
    expect(all.map((e) => e.summary)).toEqual(['event 3', 'event 2', 'event 1']);
    expect(log.list(2).map((e) => e.summary)).toEqual(['event 3', 'event 2']);
  });

  it('caps the ring buffer at 200 events, dropping the oldest', () => {
    const log = new ActivityLog(fakeHome);
    for (let i = 1; i <= 250; i += 1) {
      log.log(event(i));
    }
    const all = log.list(1000);
    expect(all).toHaveLength(200);
    expect(all[0].summary).toBe('event 250');
    expect(all[all.length - 1].summary).toBe('event 51');
  });

  it('flush() persists to <home>/.chartroom/activity.json and a new instance reloads it', () => {
    const log = new ActivityLog(fakeHome);
    log.log(event(1));
    log.log(event(2, 'save'));
    log.flush();

    const path = activityPath(fakeHome);
    expect(existsSync(path)).toBe(true);
    const onDisk = JSON.parse(readFileSync(path, 'utf8')) as { events: ActivityEvent[] };
    expect(onDisk.events).toHaveLength(2);

    // Boot-time reload (a daemon restart must not lose the feed).
    const reloaded = new ActivityLog(fakeHome);
    expect(reloaded.list(10).map((e) => e.summary)).toEqual(['event 2', 'event 1']);
  });

  it('debounces persistence (~1s): the file appears without an explicit flush', async () => {
    const log = new ActivityLog(fakeHome);
    log.log(event(1));
    expect(existsSync(activityPath(fakeHome))).toBe(false);

    await new Promise((r) => setTimeout(r, 1300));
    expect(existsSync(activityPath(fakeHome))).toBe(true);
  });

  it('a corrupt activity.json is never fatal -- boots with an empty feed', () => {
    mkdirSync(join(fakeHome, '.chartroom'), { recursive: true });
    writeFileSync(activityPath(fakeHome), 'not json at all {', 'utf8');
    const log = new ActivityLog(fakeHome);
    expect(log.list(10)).toEqual([]);
  });
});
