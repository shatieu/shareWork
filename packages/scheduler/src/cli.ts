#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createOauthUsageSource } from 'reset-detector';
import {
  configPath,
  initConfig,
  loadConfig,
  resolveStateDir,
  resumePromptPath,
} from './config.js';
import { runGuardOnce } from './guard.js';
import { acquireLock, lockLiveness, readLock, releaseLock, touchLock } from './lock.js';
import { runSensorLoop, runSensorOnce } from './sensor.js';
import { readUsageFile, statePaths } from './state.js';

const USAGE = `lookout -- the usage sensor + guard harness (Trio_Specs C)

Usage:
  lookout init [--session-id <uuid>] [--mode pause|spend] [--activity-dir <dir>]...
  lookout once                      one sensor poll, write signal files, exit
  lookout watch                     poll forever (the sensor process)
  lookout guard --once              one guard check (what Task Scheduler/cron runs)
  lookout guard                     guard loop (every 120 s; prefer --once + a scheduler)
  lookout guard install --print     print the per-machine registration commands (never executes)
  lookout lock acquire|status|heartbeat|release [--session-id <id>] [--force]
  lookout status                    show signals, config, and lock at a glance

Common flags:
  --state-dir <dir>   signal-file directory (default .ship/lookout)
  --json              machine-readable output where applicable
`;

interface Flags {
  values: Map<string, string[]>;
  bools: Set<string>;
}

function parseFlags(args: string[]): { positional: string[]; flags: Flags } {
  const positional: string[] = [];
  const values = new Map<string, string[]>();
  const bools = new Set<string>();
  const takesValue = new Set([
    '--state-dir',
    '--session-id',
    '--mode',
    '--activity-dir',
    '--poll-seconds',
  ]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    if (takesValue.has(arg)) {
      const value = args[++i];
      if (value === undefined) throw new Error(`${arg} requires a value`);
      const list = values.get(arg) ?? [];
      list.push(value);
      values.set(arg, list);
    } else {
      bools.add(arg);
    }
  }
  return { positional, flags: { values, bools } };
}

function one(flags: Flags, name: string): string | undefined {
  return flags.values.get(name)?.at(-1);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let parsed;
  try {
    parsed = parseFlags(argv);
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err));
    return 2;
  }
  const { positional, flags } = parsed;
  const [command, sub] = positional;
  const stateDir = resolveStateDir(one(flags, '--state-dir'));
  const json = flags.bools.has('--json');

  switch (command) {
    case undefined:
    case 'help':
    case '--help': {
      console.log(USAGE);
      return command === undefined ? 2 : 0;
    }

    case 'init': {
      const result = initConfig(stateDir, {
        sessionId: one(flags, '--session-id'),
        mode: one(flags, '--mode') as 'pause' | 'spend' | undefined,
        activityDirs: flags.values.get('--activity-dir'),
      });
      if (json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`config:        ${configPath(stateDir)} ${result.configCreated ? '(created)' : '(updated)'}`);
        console.log(`resume prompt: ${resumePromptPath(stateDir)} ${result.promptCreated ? '(created -- EDIT IT for your mission)' : '(kept)'}`);
        console.log(`session id:    ${result.config.sessionId}`);
        console.log('');
        console.log('Launch your mission session PINNED to that id (never bare `claude`):');
        console.log(`  ${result.launchCommand}`);
      }
      return 0;
    }

    case 'once':
    case 'watch': {
      const config = loadConfig(stateDir);
      const source = createOauthUsageSource();
      if (command === 'once') {
        const result = await runSensorOnce({
          source,
          stateDir,
          thresholds: config.thresholds,
          mode: config.mode,
        });
        console.log(
          json
            ? JSON.stringify(result, null, 2)
            : `${result.status}${result.snapshot ? ` five_hour ${result.snapshot.five_hour_pct}% resets_at ${result.snapshot.resets_at}` : ` ${result.error ?? ''}`}`,
        );
        return result.status === 'error' ? 1 : 0;
      }
      console.log(`lookout sensor watching (poll ${config.pollSeconds}s, state ${stateDir})`);
      await runSensorLoop({
        source,
        stateDir,
        thresholds: config.thresholds,
        mode: config.mode,
        pollSeconds: config.pollSeconds,
      });
      return 0;
    }

    case 'guard': {
      if (sub === 'install') {
        if (!flags.bools.has('--print')) {
          console.error('guard install is PRINT-ONLY: pass --print. Registration is a per-machine human step.');
          return 2;
        }
        printInstall(stateDir);
        return 0;
      }
      const config = loadConfig(stateDir);
      if (flags.bools.has('--once')) {
        const { action } = await runGuardOnce(config, stateDir);
        console.log(json ? JSON.stringify(action, null, 2) : `${action.kind}: ${action.reason}`);
        return action.kind === 'refuse' ? 1 : 0;
      }
      console.log('guard loop every 120 s (prefer `lookout guard --once` under Task Scheduler/cron)');
      for (;;) {
        try {
          await runGuardOnce(config, stateDir);
        } catch (err) {
          console.error(`guard tick failed: ${err instanceof Error ? err.message : err}`);
        }
        await new Promise((r) => setTimeout(r, 120_000));
      }
    }

    case 'lock': {
      const paths = statePaths(stateDir);
      const config = loadConfig(stateDir);
      switch (sub) {
        case 'acquire': {
          const sessionId = one(flags, '--session-id') ?? config.sessionId;
          if (!sessionId) {
            console.error('lock acquire needs --session-id (or a config.json from `lookout init`)');
            return 2;
          }
          // pid 0 = pid-untracked: this CLI process dies as soon as the
          // command returns, so recording ITS pid would make every lock
          // instantly reapable. Liveness is then heartbeat-governed; the
          // session must `lookout lock heartbeat` on its alive-touch cadence.
          const result = acquireLock(paths.lockFile, { sessionId, pid: 0 });
          if (!result.ok) {
            console.error(result.message);
            return 1;
          }
          if (result.reaped) console.log(`reaped stale lock (session ${result.reaped.sessionId})`);
          console.log(`lock acquired: session ${result.lock.sessionId} (heartbeat-governed)`);
          return 0;
        }
        case 'status': {
          const lock = readLock(paths.lockFile);
          const liveness = lockLiveness(lock);
          console.log(json ? JSON.stringify({ liveness, lock }, null, 2) : `${liveness}${lock ? `: PID ${lock.pid}, session ${lock.sessionId}, heartbeat ${lock.heartbeatAt}` : ''}`);
          return liveness === 'live' ? 1 : 0;
        }
        case 'heartbeat': {
          const sessionId = one(flags, '--session-id') ?? config.sessionId ?? undefined;
          const result = touchLock(paths.lockFile, { sessionId });
          if (!result.ok) console.error(result.message);
          return result.ok ? 0 : 1;
        }
        case 'release': {
          const sessionId = one(flags, '--session-id') ?? config.sessionId ?? undefined;
          const result = releaseLock(paths.lockFile, {
            sessionId,
            force: flags.bools.has('--force'),
          });
          if (!result.ok) console.error(result.message);
          return result.ok ? 0 : 1;
        }
        default:
          console.error(USAGE);
          return 2;
      }
    }

    case 'status': {
      const config = loadConfig(stateDir);
      const paths = statePaths(stateDir);
      const usage = readUsageFile(stateDir);
      const lock = readLock(paths.lockFile);
      const summary = {
        stateDir,
        configured: existsSync(configPath(stateDir)),
        sessionId: config.sessionId,
        mode: config.mode,
        usage: usage.snapshot,
        usageFileMtime: usage.mtime?.toISOString() ?? null,
        alert: existsSync(paths.alertFile),
        pause: existsSync(paths.pauseFile),
        lock: { liveness: lockLiveness(lock), holder: lock },
      };
      console.log(JSON.stringify(summary, null, 2));
      return 0;
    }

    default: {
      console.error(`unknown command: ${command}\n\n${USAGE}`);
      return 2;
    }
  }
}

function printInstall(stateDir: string): void {
  const cliPath = fileURLToPath(import.meta.url);
  const node = process.execPath;
  console.log('Per-machine registration -- run ONE of these YOURSELF (the lookout never');
  console.log('self-installs a resurrection loop; that is deliberately a human step):');
  console.log('');
  console.log('Windows Task Scheduler (per-user, no admin):');
  console.log(
    `  schtasks /create /f /tn ShipLookoutGuard /sc minute /mo 2 /tr "\\"${node}\\" \\"${cliPath}\\" guard --once --state-dir \\"${stateDir}\\""`,
  );
  console.log('  remove:  schtasks /delete /f /tn ShipLookoutGuard');
  console.log('');
  console.log('cron (Linux/macOS):');
  console.log(`  */2 * * * * "${node}" "${cliPath}" guard --once --state-dir "${stateDir}"`);
  console.log('');
  console.log('Decommission checklist (the task outlives what it spawned):');
  console.log('  1. delete the task/cron line;');
  console.log('  2. stop the sensor process (node ... watch) if running;');
  console.log('  3. stale ALERT/PAUSE/resurrected-* files in the state dir are inert -- purge at will.');
}

// Invoked directly (bin) -- not when imported by tests.
const isDirectRun = (() => {
  try {
    return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (isDirectRun) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
      process.exit(1);
    },
  );
}
