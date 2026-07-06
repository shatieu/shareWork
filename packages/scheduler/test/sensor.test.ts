import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { OauthReadResult, UsageSnapshot } from 'reset-detector';
import { DEFAULT_THRESHOLDS } from 'reset-detector';
import { runSensorLoop, runSensorOnce } from '../src/sensor.js';
import { statePaths } from '../src/state.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'lookout-sensor-'));
}

function snap(pct: number, resetsAt = '2026-07-06T11:30:00Z'): UsageSnapshot {
  return {
    five_hour_pct: pct,
    seven_day_pct: 10,
    resets_at: resetsAt,
    checked_at: '2026-07-06T10:00:00Z',
    source: 'oauth',
  };
}

function sourceOf(results: OauthReadResult[]) {
  let i = 0;
  return {
    read: async () => results[Math.min(i++, results.length - 1)],
  };
}

describe('runSensorOnce', () => {
  it('writes usage.json + markers and logs one line per poll', async () => {
    const dir = tempDir();
    const result = await runSensorOnce({
      source: sourceOf([{ snapshot: snap(95), fromCache: false }]),
      stateDir: dir,
      thresholds: DEFAULT_THRESHOLDS,
      mode: 'pause',
      now: () => new Date('2026-07-06T10:00:05Z'),
    });
    expect(result.status).toBe('PAUSE');
    const paths = statePaths(dir);
    expect(existsSync(paths.usageFile)).toBe(true);
    expect(existsSync(paths.pauseFile)).toBe(true);
    const log = readFileSync(paths.logFile, 'utf8');
    expect(log).toContain('95 2026-07-06T11:30:00Z PAUSE');
  });

  it('spend mode never raises PAUSE', async () => {
    const dir = tempDir();
    const result = await runSensorOnce({
      source: sourceOf([{ snapshot: snap(100), fromCache: false }]),
      stateDir: dir,
      thresholds: DEFAULT_THRESHOLDS,
      mode: 'spend',
    });
    expect(result.status).toBe('ALERT');
    expect(existsSync(statePaths(dir).pauseFile)).toBe(false);
  });

  it('on failure with no last-good it leaves signal files untouched and logs the error', async () => {
    const dir = tempDir();
    // First a healthy PAUSE state...
    await runSensorOnce({
      source: sourceOf([{ snapshot: snap(95), fromCache: false }]),
      stateDir: dir,
      thresholds: DEFAULT_THRESHOLDS,
      mode: 'pause',
    });
    // ...then total source failure: usage.json and PAUSE must survive.
    const result = await runSensorOnce({
      source: sourceOf([{ snapshot: null, fromCache: true, error: 'endpoint down' }]),
      stateDir: dir,
      thresholds: DEFAULT_THRESHOLDS,
      mode: 'pause',
    });
    expect(result.status).toBe('error');
    const paths = statePaths(dir);
    expect(existsSync(paths.pauseFile)).toBe(true);
    expect(JSON.parse(readFileSync(paths.usageFile, 'utf8')).five_hour_pct).toBe(95);
    expect(readFileSync(paths.logFile, 'utf8')).toContain('error endpoint down');
  });
});

describe('runSensorLoop', () => {
  it('polls until aborted, sleeping the full interval even after errors', async () => {
    const dir = tempDir();
    const controller = new AbortController();
    const sleeps: number[] = [];
    let ticks = 0;
    await runSensorLoop({
      source: {
        read: async () => {
          if (ticks === 1) throw new Error('mid-loop crash');
          return { snapshot: snap(10), fromCache: false };
        },
      },
      stateDir: dir,
      thresholds: DEFAULT_THRESHOLDS,
      mode: 'pause',
      pollSeconds: 300,
      signal: controller.signal,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      onTick: (result) => {
        ticks += 1;
        if (ticks === 2) expect(result.status).toBe('error');
        if (ticks >= 3) controller.abort();
      },
    });
    expect(ticks).toBe(3);
    expect(sleeps.every((ms) => ms === 300_000)).toBe(true);
  });
});
