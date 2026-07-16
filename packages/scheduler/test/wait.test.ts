import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WaitAction } from 'reset-detector';
import { DEFAULT_CONFIG, type LookoutConfig } from '../src/config.js';
import { runWaitLoop, type WaitDeps } from '../src/wait.js';
import { statePaths } from '../src/state.js';

const START = Date.parse('2026-07-09T08:00:00Z');

/**
 * A scripted waiter harness: injected clock + sleep. Each sleep advances the
 * fake clock by the requested interval and re-stamps usage.json (fresh mtime =
 * a live sensor), taking new values from whatever the test scripted last.
 */
function setup(opts: { pct?: number; resetsAt?: string; writeUsage?: boolean } = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), 'lookout-wait-'));
  const paths = statePaths(stateDir);
  let t = START;
  const now = () => new Date(t);

  let usage = {
    five_hour_pct: opts.pct ?? 95,
    seven_day_pct: 40,
    resets_at: opts.resetsAt ?? '2026-07-09T10:00:00Z',
  };
  const writeUsage = () => {
    writeFileSync(
      paths.usageFile,
      JSON.stringify({ ...usage, checked_at: now().toISOString() }),
    );
    utimesSync(paths.usageFile, now(), now());
  };
  if (opts.writeUsage !== false) writeUsage();

  const sleeps: number[] = [];
  const actions: WaitAction[] = [];
  const logLines: string[] = [];
  let commitAt = new Date('2026-07-09T07:00:00Z'); // an hour before start

  const config: LookoutConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    sessionId: 'abc-123',
    repoRoot: stateDir, // git probe is injected; activityDirs empty
  };

  const deps: WaitDeps = {
    now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
      writeUsage(); // the sensor stays live: fresh mtime every interval
    },
    sensorTick: async () => {
      writeUsage();
    },
    lastCommitTime: () => commitAt,
    isPidAlive: () => false,
    pid: 4242,
    log: (line: string) => logLines.push(line),
    onTick: (action: WaitAction) => actions.push(action),
  };

  return {
    stateDir,
    paths,
    config,
    deps,
    sleeps,
    actions,
    logLines,
    setUsage(next: Partial<typeof usage>) {
      usage = { ...usage, ...next };
    },
    setCommitAt(d: Date) {
      commitAt = d;
    },
    nowMs: () => t,
  };
}

describe('runWaitLoop', () => {
  it('arm -> renewal -> grace -> continue, with the exact nudge message', async () => {
    const s = setup();
    writeFileSync(join(s.stateDir, 'resume-prompt.txt'), 'Resume the mission queue at item 7.');
    s.config.pollSeconds = 300;
    s.config.wait.graceMinutes = 10;

    // Script: after the 2nd sleep the window renews (new key, fresh pct).
    let sleepCount = 0;
    const baseSleep = s.deps.sleep!;
    s.deps.sleep = async (ms: number) => {
      sleepCount += 1;
      if (sleepCount === 2) s.setUsage({ five_hour_pct: 2, resets_at: '2026-07-09T15:00:00Z' });
      await baseSleep(ms);
    };

    const outcome = await runWaitLoop(s.config, s.stateDir, s.deps);

    expect(outcome.kind).toBe('continue');
    const [first, second, ...rest] = outcome.message.split('\n');
    expect(first).toBe(
      'LOOKOUT CONTINUE — usage window renewed (five_hour 2%, was window 20260709-1000, ' +
        'now 20260709-1500); no session activity for 10 min since renewal.',
    );
    expect(second).toBe(
      `Re-read the signal files under ${s.stateDir} and your mission checkpoint, then resume the queue.`,
    );
    expect(rest.join('\n')).toBe('Resume the mission queue at item 7.');

    // Kinds in order: arm, wait, renewal, then grace waits, then continue.
    expect(s.actions[0].kind).toBe('arm');
    expect(s.actions[1].kind).toBe('wait');
    expect(s.actions[2].kind).toBe('renewal');
    expect(s.actions.at(-1)!.kind).toBe('continue');

    // Poll tightened to 60 s only after the renewal was observed.
    expect(s.sleeps.slice(0, 3)).toEqual([300_000, 300_000, 60_000]);
    expect(s.sleeps.slice(3).every((ms) => ms === 60_000)).toBe(true);

    // Audit trail + pid file cleanup.
    expect(s.logLines.join('\n')).toContain('armed on window 20260709-1000');
    expect(s.logLines.join('\n')).toContain('renewal observed');
    expect(s.logLines.join('\n')).toContain('CONTINUE fired');
    expect(existsSync(s.paths.waiterPidFile)).toBe(false);
  });

  it('re-arms silently when the session wakes itself during grace', async () => {
    const s = setup();
    s.config.wait.graceMinutes = 10;

    let sleepCount = 0;
    const baseSleep = s.deps.sleep!;
    s.deps.sleep = async (ms: number) => {
      sleepCount += 1;
      if (sleepCount === 1) s.setUsage({ five_hour_pct: 2, resets_at: '2026-07-09T15:00:00Z' });
      // Two grace ticks in, the session commits (activity AFTER the renewal).
      if (sleepCount === 4) s.setCommitAt(new Date(s.nowMs()));
      // Later, a second renewal with no activity -> the continue must still fire.
      if (sleepCount === 6) s.setUsage({ five_hour_pct: 1, resets_at: '2026-07-09T20:00:00Z' });
      await baseSleep(ms);
    };

    const outcome = await runWaitLoop(s.config, s.stateDir, s.deps);

    expect(outcome.kind).toBe('continue');
    expect(s.actions.map((a) => a.kind)).toContain('rearm');
    expect(s.logLines.join('\n')).toContain('re-armed silently on window 20260709-1500');
    // The eventual nudge reports the SECOND renewal, re-armed key as "was".
    expect(outcome.message).toContain('was window 20260709-1500, now 20260709-2000');
  });

  it('self-senses when usage.json is missing, and sensor errors never break the loop', async () => {
    const s = setup({ writeUsage: false });
    s.config.wait.maxHours = 1; // terminate via expiry
    let sensorCalls = 0;
    s.deps.sensorTick = async () => {
      sensorCalls += 1;
      if (sensorCalls === 1) throw new Error('endpoint down');
      // Second call succeeds and the file appears -- but keep the loop bounded
      // by never renewing; expiry ends the test.
      writeFileSync(
        s.paths.usageFile,
        JSON.stringify({
          five_hour_pct: 95,
          seven_day_pct: 40,
          resets_at: '2026-07-09T10:00:00Z',
          checked_at: new Date(s.nowMs()).toISOString(),
        }),
      );
      utimesSync(s.paths.usageFile, new Date(s.nowMs()), new Date(s.nowMs()));
    };
    // Do NOT refresh usage.json in sleep here: self-sense must be what does it.
    let t = s.nowMs();
    s.deps.now = () => new Date(t);
    s.deps.sleep = async (ms: number) => {
      s.sleeps.push(ms);
      t += ms;
    };

    const outcome = await runWaitLoop(s.config, s.stateDir, s.deps);
    expect(outcome.kind).toBe('expired');
    expect(sensorCalls).toBeGreaterThanOrEqual(2);
    expect(s.logLines.join('\n')).toContain('tick failed (loop continues): endpoint down');
    // Errors never shorten the interval: every sleep is the full poll.
    expect(s.sleeps.every((ms) => ms === s.config.pollSeconds * 1000)).toBe(true);
  });

  it('expires after maxHours with a respawn-me message', async () => {
    const s = setup();
    s.config.wait.maxHours = 2;
    const outcome = await runWaitLoop(s.config, s.stateDir, s.deps);
    expect(outcome.kind).toBe('expired');
    expect(outcome.message).toContain('LOOKOUT WAITER EXPIRED');
    expect(outcome.message).toContain('respawn');
    expect(outcome.message).toContain('lookout wait');
    expect(existsSync(s.paths.waiterPidFile)).toBe(false);
  });

  it('refuses to start when another waiter is alive, and leaves its pid file alone', async () => {
    const s = setup();
    writeFileSync(
      s.paths.waiterPidFile,
      JSON.stringify({ pid: 9999, startedAt: '2026-07-09T07:30:00Z' }) + '\n',
    );
    s.deps.isPidAlive = (pid: number) => pid === 9999;
    const outcome = await runWaitLoop(s.config, s.stateDir, s.deps);
    expect(outcome.kind).toBe('refused');
    expect(outcome.message).toContain('9999');
    // The live waiter's pid file must survive the refusal.
    expect(JSON.parse(readFileSync(s.paths.waiterPidFile, 'utf8')).pid).toBe(9999);
  });

  it('reaps a dead waiter\'s pid file and takes over', async () => {
    const s = setup();
    s.config.wait.maxHours = 1;
    writeFileSync(
      s.paths.waiterPidFile,
      JSON.stringify({ pid: 9999, startedAt: '2026-07-08T07:30:00Z' }) + '\n',
    );
    s.deps.isPidAlive = () => false;
    const outcome = await runWaitLoop(s.config, s.stateDir, s.deps);
    expect(outcome.kind).toBe('expired'); // it ran (dead pid reaped), then expired
  });

  it('counts the LOCK heartbeat as session activity', async () => {
    const s = setup();
    s.config.wait.graceMinutes = 10;

    let sleepCount = 0;
    const baseSleep = s.deps.sleep!;
    s.deps.sleep = async (ms: number) => {
      sleepCount += 1;
      if (sleepCount === 1) s.setUsage({ five_hour_pct: 2, resets_at: '2026-07-09T15:00:00Z' });
      if (sleepCount === 3) {
        // Session heartbeats the mission lock AFTER the renewal.
        writeFileSync(
          s.paths.lockFile,
          JSON.stringify({
            pid: 0,
            sessionId: 'abc-123',
            startedAt: '2026-07-09T07:00:00Z',
            heartbeatAt: new Date(s.nowMs()).toISOString(),
          }) + '\n',
        );
      }
      if (sleepCount === 6) s.setUsage({ five_hour_pct: 1, resets_at: '2026-07-09T20:00:00Z' });
      await baseSleep(ms);
    };

    const outcome = await runWaitLoop(s.config, s.stateDir, s.deps);
    expect(outcome.kind).toBe('continue');
    expect(s.actions.map((a) => a.kind)).toContain('rearm');
  });
});
