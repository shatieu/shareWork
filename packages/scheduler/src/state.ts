import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { SignalState, UsageSnapshot } from 'reset-detector';

/**
 * Signal-file mechanics, byte-compatible with the field-proven prototype
 * (suite-design/lookout/lookout.ps1): usage.json carries the snapshot, ALERT
 * and PAUSE are marker files whose PRESENCE is the signal (content = the
 * snapshot for convenience), and both self-clear as soon as the pct drops
 * back under the threshold. All files here are runtime-only state (the state
 * dir belongs in .gitignore) -- clearing a marker is product behavior on the
 * product's own scratch state, not a repo deletion.
 */

export interface StatePaths {
  dir: string;
  usageFile: string;
  alertFile: string;
  pauseFile: string;
  logFile: string;
  guardLogFile: string;
  waitLogFile: string;
  lockFile: string;
  /** The waiter's single-instance pid file (see wait.ts). */
  waiterPidFile: string;
  resurrectOutFile: string;
}

export function statePaths(dir: string): StatePaths {
  return {
    dir,
    usageFile: join(dir, 'usage.json'),
    alertFile: join(dir, 'ALERT'),
    pauseFile: join(dir, 'PAUSE'),
    logFile: join(dir, 'lookout.log'),
    guardLogFile: join(dir, 'guard.log'),
    waitLogFile: join(dir, 'wait.log'),
    lockFile: join(dir, 'LOCK'),
    waiterPidFile: join(dir, 'WAITER'),
    resurrectOutFile: join(dir, 'resurrect-out.log'),
  };
}

export function ensureStateDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function serializeSnapshot(snapshot: UsageSnapshot): string {
  // The prototype's exact key set (plus source), so anything written against
  // the prototype's usage.json keeps parsing.
  return (
    JSON.stringify(
      {
        five_hour_pct: snapshot.five_hour_pct,
        seven_day_pct: snapshot.seven_day_pct,
        resets_at: snapshot.resets_at,
        checked_at: snapshot.checked_at,
        source: snapshot.source,
      },
      null,
      2,
    ) + '\n'
  );
}

/** Write usage.json + set/clear the ALERT/PAUSE markers. Returns the status word for the log. */
export function writeSensorResult(
  dir: string,
  snapshot: UsageSnapshot,
  signals: SignalState,
): 'ok' | 'ALERT' | 'PAUSE' {
  ensureStateDir(dir);
  const paths = statePaths(dir);
  const body = serializeSnapshot(snapshot);
  writeFileSync(paths.usageFile, body);

  if (signals.pause) {
    writeFileSync(paths.pauseFile, body);
  } else if (existsSync(paths.pauseFile)) {
    rmSync(paths.pauseFile, { force: true }); // self-clearing marker (runtime state)
  }

  if (signals.alert) {
    writeFileSync(paths.alertFile, body);
  } else if (existsSync(paths.alertFile)) {
    rmSync(paths.alertFile, { force: true }); // self-clearing marker (runtime state)
  }

  return signals.pause ? 'PAUSE' : signals.alert ? 'ALERT' : 'ok';
}

export interface UsageFileRead {
  snapshot: UsageSnapshot | null;
  mtime: Date | null;
}

export function readUsageFile(dir: string): UsageFileRead {
  const paths = statePaths(dir);
  if (!existsSync(paths.usageFile)) return { snapshot: null, mtime: null };
  try {
    const raw = JSON.parse(readFileSync(paths.usageFile, 'utf8')) as UsageSnapshot;
    if (typeof raw.five_hour_pct !== 'number' || typeof raw.resets_at !== 'string') {
      return { snapshot: null, mtime: null };
    }
    return { snapshot: raw, mtime: statSync(paths.usageFile).mtime };
  } catch {
    return { snapshot: null, mtime: null };
  }
}

const MARKER_PREFIX = 'resurrected-';

export function resurrectionMarkerKeys(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith(MARKER_PREFIX))
    .map((name) => name.slice(MARKER_PREFIX.length));
}

/**
 * Marker is written BEFORE the resurrection spawn (prototype order): a crash
 * between marker and spawn loses one resurrection; the reverse order can
 * fork two supervisors into one repo -- the strictly worse failure.
 */
export function writeResurrectionMarker(dir: string, windowKey: string): void {
  ensureStateDir(dir);
  writeFileSync(join(dir, MARKER_PREFIX + windowKey), new Date().toISOString() + '\n');
}

export function appendLog(file: string, line: string, now: Date = new Date()): void {
  const stamp = now.toISOString().replace('T', ' ').slice(0, 19);
  appendFileSync(file, `${stamp} ${line}\n`);
}

/** Newest file mtime under any of the given dirs (recursive, best-effort). */
export function newestMtimeUnder(dirs: string[]): Date | null {
  let newest: number | null = null;
  const visit = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          visit(full, depth + 1);
        } else {
          const m = statSync(full).mtime.getTime();
          if (newest === null || m > newest) newest = m;
        }
      } catch {
        /* races with concurrent writers are fine -- best effort */
      }
    }
  };
  for (const dir of dirs) visit(dir, 0);
  return newest === null ? null : new Date(newest);
}
