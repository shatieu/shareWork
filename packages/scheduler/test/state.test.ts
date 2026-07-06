import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UsageSnapshot } from 'reset-detector';
import {
  readUsageFile,
  resurrectionMarkerKeys,
  statePaths,
  writeResurrectionMarker,
  writeSensorResult,
} from '../src/state.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'lookout-state-'));
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

describe('writeSensorResult / readUsageFile', () => {
  it('writes the prototype-compatible usage.json shape', () => {
    const dir = tempDir();
    writeSensorResult(dir, snap(42), { alert: false, pause: false });
    const raw = JSON.parse(readFileSync(statePaths(dir).usageFile, 'utf8'));
    expect(raw).toMatchObject({
      five_hour_pct: 42,
      seven_day_pct: 10,
      resets_at: '2026-07-06T11:30:00Z',
      checked_at: '2026-07-06T10:00:00Z',
    });
    const read = readUsageFile(dir);
    expect(read.snapshot?.five_hour_pct).toBe(42);
    expect(read.mtime).toBeInstanceOf(Date);
  });

  it('raises and self-clears ALERT/PAUSE markers as pct crosses thresholds', () => {
    const dir = tempDir();
    const paths = statePaths(dir);

    expect(writeSensorResult(dir, snap(50), { alert: false, pause: false })).toBe('ok');
    expect(existsSync(paths.alertFile)).toBe(false);
    expect(existsSync(paths.pauseFile)).toBe(false);

    expect(writeSensorResult(dir, snap(85), { alert: true, pause: false })).toBe('ALERT');
    expect(existsSync(paths.alertFile)).toBe(true);
    expect(existsSync(paths.pauseFile)).toBe(false);

    expect(writeSensorResult(dir, snap(95), { alert: true, pause: true })).toBe('PAUSE');
    expect(existsSync(paths.alertFile)).toBe(true);
    expect(existsSync(paths.pauseFile)).toBe(true);

    // Window reset: pct drops, both markers self-clear (proven live 2026-07-05).
    expect(writeSensorResult(dir, snap(3), { alert: false, pause: false })).toBe('ok');
    expect(existsSync(paths.alertFile)).toBe(false);
    expect(existsSync(paths.pauseFile)).toBe(false);
  });

  it('returns nulls for a missing or corrupt usage.json', () => {
    const dir = tempDir();
    expect(readUsageFile(dir)).toEqual({ snapshot: null, mtime: null });
    writeFileSync(statePaths(dir).usageFile, 'not json');
    expect(readUsageFile(dir).snapshot).toBeNull();
  });
});

describe('resurrection markers', () => {
  it('round-trips window keys through marker files', () => {
    const dir = tempDir();
    expect(resurrectionMarkerKeys(dir)).toEqual([]);
    writeResurrectionMarker(dir, '20260706-1630');
    writeResurrectionMarker(dir, '20260706-2130');
    expect(resurrectionMarkerKeys(dir).sort()).toEqual(['20260706-1630', '20260706-2130']);
  });

  it('ignores unrelated files in the state dir', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'usage.json'), '{}');
    writeFileSync(join(dir, 'guard.log'), '');
    expect(resurrectionMarkerKeys(dir)).toEqual([]);
  });
});

describe('mtime probe', () => {
  it('newestMtimeUnder finds the newest file across dirs', async () => {
    const { newestMtimeUnder } = await import('../src/state.js');
    const dir = tempDir();
    const old = join(dir, 'old.txt');
    const fresh = join(dir, 'sub');
    writeFileSync(old, 'x');
    utimesSync(old, new Date('2026-07-01T00:00:00Z'), new Date('2026-07-01T00:00:00Z'));
    const { mkdirSync } = await import('node:fs');
    mkdirSync(fresh, { recursive: true });
    const freshFile = join(fresh, 'new.txt');
    writeFileSync(freshFile, 'y');
    utimesSync(freshFile, new Date('2026-07-06T00:00:00Z'), new Date('2026-07-06T00:00:00Z'));

    expect(newestMtimeUnder([dir])?.toISOString()).toBe('2026-07-06T00:00:00.000Z');
    expect(newestMtimeUnder([join(dir, 'does-not-exist')])).toBeNull();
  });
});
