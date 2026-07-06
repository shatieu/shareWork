import { execFileSync, spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decideGuardAction, type GuardAction, type ResurrectCommand } from 'reset-detector';
import type { LookoutConfig } from './config.js';
import { loadResumePrompt } from './config.js';
import {
  appendLog,
  ensureStateDir,
  newestMtimeUnder,
  readUsageFile,
  resurrectionMarkerKeys,
  statePaths,
  writeResurrectionMarker,
} from './state.js';
import { join, resolve } from 'node:path';

/**
 * The guard harness -- the session-INDEPENDENT fallback (Trio_Specs §C):
 * ScheduleWakeup dies with the session at a hard token cap (mission sat idle
 * ~1 h on 2026-07-05 before this existed), so an external scheduler (Windows
 * Task Scheduler / cron) runs `lookout guard --once` every ~2 minutes. It
 * keeps the sensor alive and resurrects the pinned session at most once per
 * usage window. All policy lives in reset-detector's pure decideGuardAction;
 * this module only gathers inputs and executes side effects.
 */

export interface SpawnRequest {
  argv: string[];
  env: Record<string, string>;
  cwd: string;
  outFile: string;
}

export interface GuardDeps {
  now?: () => Date;
  /** Injectable detached-spawn (tests). */
  spawnDetached?: (req: SpawnRequest) => void;
  /** Injectable git-activity probe (tests). Returns last commit time or null. */
  lastCommitTime?: (repoRoot: string) => Date | null;
  log?: (line: string) => void;
}

export function defaultLastCommitTime(repoRoot: string): Date | null {
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'log', '-1', '--format=%ct'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const unix = Number(out);
    return Number.isFinite(unix) && unix > 0 ? new Date(unix * 1000) : null;
  } catch {
    return null;
  }
}

/**
 * Detached, fire-and-forget spawn with output appended to a log file. On
 * Windows `claude` is a .cmd shim, which node cannot spawn shell-less; route
 * through cmd.exe there (the prototype used `cmd /c` for the same reason).
 */
export function defaultSpawnDetached(req: SpawnRequest): void {
  const out = openSync(req.outFile, 'a');
  const env = { ...process.env, ...req.env };
  let child;
  if (process.platform === 'win32') {
    const quoted = req.argv.map((a) => (/[\s"^&|<>]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a));
    child = spawn('cmd.exe', ['/d', '/s', '/c', quoted.join(' ')], {
      cwd: req.cwd,
      env,
      detached: true,
      stdio: ['ignore', out, out],
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
  } else {
    child = spawn(req.argv[0], req.argv.slice(1), {
      cwd: req.cwd,
      env,
      detached: true,
      stdio: ['ignore', out, out],
    });
  }
  child.unref();
}

/** The `lookout watch` relaunch command for a dead sensor. */
export function sensorRelaunchArgv(stateDir: string): string[] {
  const cliPath = fileURLToPath(new URL('./cli.js', import.meta.url));
  return [process.execPath, cliPath, 'watch', '--state-dir', stateDir];
}

export interface GuardRunResult {
  action: GuardAction;
  /** What was actually spawned (for logs/tests); null when nothing was. */
  spawned: SpawnRequest | null;
}

export async function runGuardOnce(
  config: LookoutConfig,
  stateDir: string,
  deps: GuardDeps = {},
): Promise<GuardRunResult> {
  const now = deps.now ?? (() => new Date());
  const spawnDetached = deps.spawnDetached ?? defaultSpawnDetached;
  const lastCommitTime = deps.lastCommitTime ?? defaultLastCommitTime;
  const paths = statePaths(stateDir);
  ensureStateDir(stateDir);
  const log = deps.log ?? ((line: string) => appendLog(paths.guardLogFile, line, now()));

  // Gather inputs.
  const usage = readUsageFile(stateDir);
  const commitAt = lastCommitTime(config.repoRoot);
  const activityAt = newestMtimeUnder(
    config.activityDirs.map((d) => resolve(config.repoRoot, d)),
  );
  let lastActivityAt: Date | null = null;
  for (const candidate of [commitAt, activityAt]) {
    if (candidate && (!lastActivityAt || candidate > lastActivityAt)) lastActivityAt = candidate;
  }

  const action = decideGuardAction({
    now: now(),
    snapshot: usage.snapshot,
    usageFileMtime: usage.mtime,
    lastActivityAt,
    resurrectionKeys: resurrectionMarkerKeys(stateDir),
    sessionId: config.sessionId,
    resumePrompt: loadResumePrompt(stateDir),
    policy: config.guard,
  });

  // Execute.
  let spawned: SpawnRequest | null = null;
  switch (action.kind) {
    case 'relaunch-sensor': {
      spawned = {
        argv: sensorRelaunchArgv(stateDir),
        env: {},
        cwd: config.repoRoot,
        outFile: join(stateDir, 'sensor-out.log'),
      };
      spawnDetached(spawned);
      log(`sensor relaunched: ${action.reason}`);
      break;
    }
    case 'resurrect': {
      // Marker BEFORE spawn: a crash in between loses one resurrection; the
      // reverse order can fork two supervisors into one repo.
      writeResurrectionMarker(stateDir, action.windowKey);
      spawned = toSpawnRequest(action.command, config.repoRoot, paths.resurrectOutFile);
      spawnDetached(spawned);
      log(action.reason);
      break;
    }
    case 'refuse': {
      log(`REFUSED: ${action.reason}`);
      break;
    }
    case 'none':
      // Quiet by design: a Task-Scheduler tick every 2 min must not grow the log unboundedly.
      break;
  }
  return { action, spawned };
}

function toSpawnRequest(command: ResurrectCommand, cwd: string, outFile: string): SpawnRequest {
  return { argv: command.argv, env: command.env, cwd, outFile };
}
