import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRINT_BG_CEILING_ENV } from 'reset-detector';
import { DEFAULT_CONFIG, type LookoutConfig } from '../src/config.js';
import { runGuardOnce, sensorRelaunchArgv } from '../src/guard.js';
import type { SpawnRequest } from '../src/guard.js';
import { resurrectionMarkerKeys, statePaths } from '../src/state.js';

const NOW = () => new Date('2026-07-06T11:40:00Z');

function setup(opts: { pct?: number; resetsAt?: string; freshUsage?: boolean } = {}) {
  const stateDir = mkdtempSync(join(tmpdir(), 'lookout-guard-'));
  const paths = statePaths(stateDir);
  if (opts.freshUsage !== false) {
    writeFileSync(
      paths.usageFile,
      JSON.stringify({
        five_hour_pct: opts.pct ?? 3,
        seven_day_pct: 10,
        resets_at: opts.resetsAt ?? '2026-07-06T16:30:00Z',
        checked_at: '2026-07-06T11:38:00Z',
      }),
    );
    utimesSync(paths.usageFile, new Date('2026-07-06T11:38:00Z'), new Date('2026-07-06T11:38:00Z'));
  }
  writeFileSync(join(stateDir, 'resume-prompt.txt'), 'resume the mission');
  const config: LookoutConfig = {
    ...structuredClone(DEFAULT_CONFIG),
    sessionId: 'abc-123',
    repoRoot: stateDir, // any dir; git probe is injected in tests
  };
  const spawned: SpawnRequest[] = [];
  const deps = {
    now: NOW,
    spawnDetached: (req: SpawnRequest) => {
      spawned.push(req);
    },
    lastCommitTime: () => new Date('2026-07-06T10:30:00Z'), // 70 min idle
    log: () => {},
  };
  return { stateDir, config, spawned, deps };
}

describe('runGuardOnce', () => {
  it('relaunches the sensor when usage.json is missing', async () => {
    const { stateDir, config, spawned, deps } = setup({ freshUsage: false });
    const { action } = await runGuardOnce(config, stateDir, deps);
    expect(action.kind).toBe('relaunch-sensor');
    expect(spawned).toHaveLength(1);
    expect(spawned[0].argv).toEqual(sensorRelaunchArgv(stateDir));
  });

  it('does nothing when the window is not fresh (pct >= 20)', async () => {
    const { stateDir, config, spawned, deps } = setup({ pct: 95 });
    const { action } = await runGuardOnce(config, stateDir, deps);
    expect(action.kind).toBe('none');
    expect(spawned).toHaveLength(0);
  });

  it('does nothing when the repo is recently active', async () => {
    const { stateDir, config, spawned, deps } = setup();
    const { action } = await runGuardOnce(config, stateDir, {
      ...deps,
      lastCommitTime: () => new Date('2026-07-06T11:30:00Z'), // 10 min ago
    });
    expect(action.kind).toBe('none');
    expect(spawned).toHaveLength(0);
  });

  it('resurrects once: marker written before spawn, session-pinned command, ceiling env', async () => {
    const { stateDir, config, spawned, deps } = setup();
    const { action } = await runGuardOnce(config, stateDir, {
      ...deps,
      spawnDetached: (req: SpawnRequest) => {
        // At spawn time the marker MUST already exist (crash-safety order).
        expect(resurrectionMarkerKeys(stateDir)).toContain('20260706-1630');
        spawned.push(req);
      },
    });
    expect(action.kind).toBe('resurrect');
    expect(spawned).toHaveLength(1);
    expect(spawned[0].argv).toEqual([
      'claude',
      '--resume',
      'abc-123',
      '-p',
      'resume the mission',
      '--permission-mode',
      'bypassPermissions',
    ]);
    expect(spawned[0].env[PRINT_BG_CEILING_ENV]).toBe('0');
    expect(spawned[0].cwd).toBe(config.repoRoot);
  });

  it('a second tick in the same window (jittered resets_at) does not fire again', async () => {
    const { stateDir, config, spawned, deps } = setup({ resetsAt: '2026-07-06T16:29:59.900Z' });
    const first = await runGuardOnce(config, stateDir, deps);
    expect(first.action.kind).toBe('resurrect');

    // Jitter the sensor's resets_at across the minute boundary, as the real
    // endpoint did on 2026-07-06 (5 resurrections in one window pre-patch).
    const paths = statePaths(stateDir);
    writeFileSync(
      paths.usageFile,
      JSON.stringify({
        five_hour_pct: 3,
        seven_day_pct: 10,
        resets_at: '2026-07-06T16:30:00.100Z',
        checked_at: '2026-07-06T11:39:00Z',
      }),
    );
    utimesSync(paths.usageFile, new Date('2026-07-06T11:39:00Z'), new Date('2026-07-06T11:39:00Z'));

    const second = await runGuardOnce(config, stateDir, deps);
    expect(second.action.kind).toBe('none');
    expect(second.action.reason).toContain('already resurrected');
    expect(spawned).toHaveLength(1); // still exactly one spawn
  });

  it('refuses without a pinned sessionId and spawns nothing', async () => {
    const { stateDir, config, spawned, deps } = setup();
    config.sessionId = null;
    const logLines: string[] = [];
    const { action } = await runGuardOnce(config, stateDir, {
      ...deps,
      log: (line: string) => logLines.push(line),
    });
    expect(action.kind).toBe('refuse');
    expect(spawned).toHaveLength(0);
    expect(logLines.join('\n')).toContain('REFUSED');
  });

  it('writes guard.log entries via the default logger', async () => {
    const { stateDir, config, deps } = setup({ freshUsage: false });
    const { log: _drop, ...withDefaultLog } = deps;
    await runGuardOnce(config, stateDir, withDefaultLog);
    const guardLog = readFileSync(statePaths(stateDir).guardLogFile, 'utf8');
    expect(guardLog).toContain('sensor relaunched');
  });
});
