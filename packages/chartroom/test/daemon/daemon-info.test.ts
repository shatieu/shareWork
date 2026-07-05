import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  daemonInfoPath,
  deleteDaemonInfo,
  readDaemonInfo,
  writeDaemonInfo,
} from '../../src/daemon/daemon-info.js';
import { buildVbsLauncher } from '../../src/commands/associate.js';
import { findOwningRepo } from '../../src/commands/open.js';
import type { RegisteredRepo } from '../../src/daemon/registry.js';

let fakeHome: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'chartroom-daemon-info-test-home-'));
});

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
});

describe('daemon.json discovery file (wave-2 feature 5)', () => {
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
});

describe('chartroom open: findOwningRepo', () => {
  const repo = (id: string, absPath: string): RegisteredRepo => ({ id, absPath, addedAt: '' });

  it('longest registered absPath prefix wins; path boundaries respected', () => {
    const outer = repo('outer', join(fakeHome, 'work'));
    const inner = repo('inner', join(fakeHome, 'work', 'nested'));
    const sibling = repo('sibling', join(fakeHome, 'work-other'));
    const repos = [outer, inner, sibling];

    expect(findOwningRepo(repos, join(fakeHome, 'work', 'a.md'))?.id).toBe('outer');
    expect(findOwningRepo(repos, join(fakeHome, 'work', 'nested', 'deep', 'b.md'))?.id).toBe('inner');
    // 'work-other' must not be swallowed by the 'work' prefix (boundary-aware containment).
    expect(findOwningRepo(repos, join(fakeHome, 'work-other', 'c.md'))?.id).toBe('sibling');
    expect(findOwningRepo(repos, join(fakeHome, 'elsewhere', 'd.md'))).toBeUndefined();
  });
});

describe('chartroom associate: VBS launcher generation', () => {
  it('doubles quotes VBScript-style and runs with window style 0 (hidden)', () => {
    const vbs = buildVbsLauncher('C:\\Program Files\\nodejs\\node.exe', 'C:\\x\\dist\\cli.js');
    expect(vbs).toContain(
      'sh.Run """C:\\Program Files\\nodejs\\node.exe"" ""C:\\x\\dist\\cli.js"" open """ & WScript.Arguments(0) & """", 0, False',
    );
    expect(vbs).toContain('WScript.Quit 1');
  });
});
