import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  daemonInfoPath,
  deleteDaemonInfo,
  readDaemonInfo,
  writeDaemonInfo,
} from '../../src/daemon/daemon-info.js';

let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'chartroom-daemon-info-test-home-'));
});

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

describe('daemon.json discovery file (v1.1)', () => {
  it('write -> read round-trips, delete removes, missing file reads as undefined', () => {
    expect(readDaemonInfo(fakeHome)).toBeUndefined();

    const info = { port: 4317, pid: 12345, startedAt: '2026-07-05T00:00:00.000Z' };
    writeDaemonInfo(info, fakeHome);
    expect(existsSync(daemonInfoPath(fakeHome))).toBe(true);
    expect(readDaemonInfo(fakeHome)).toEqual(info);

    deleteDaemonInfo(fakeHome);
    expect(readDaemonInfo(fakeHome)).toBeUndefined();
    // A second delete is a harmless no-op (best-effort semantics).
    expect(() => deleteDaemonInfo(fakeHome)).not.toThrow();
  });

  it('tolerates a corrupt or wrong-shape file (stale-file semantics: undefined, never a throw)', () => {
    mkdirSync(join(fakeHome, '.chartroom'), { recursive: true });
    writeFileSync(daemonInfoPath(fakeHome), 'not json at all', 'utf8');
    expect(readDaemonInfo(fakeHome)).toBeUndefined();

    writeFileSync(daemonInfoPath(fakeHome), JSON.stringify({ port: 'nope' }), 'utf8');
    expect(readDaemonInfo(fakeHome)).toBeUndefined();

    writeFileSync(daemonInfoPath(fakeHome), JSON.stringify({ port: 4317, pid: 1 }), 'utf8');
    expect(readDaemonInfo(fakeHome)).toEqual({ port: 4317, pid: 1, startedAt: '' });
  });
});
