import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const SUITE_DIR_NAME = '.suite';
const SERVICES_FILE_NAME = 'services.json';

/**
 * The hull's entry in `~/.suite/services.json` (Ship_Spec §2 one-hull revision): written by
 * `ship serve` after `.listen()` succeeds so every suite tool (CLIs, plugins, future stations)
 * can discover the one running Deck. Same trust rules as chartroom's `daemon.json`: the file can
 * be stale (crash without cleanup), so readers must always health-check the port -- this module
 * only promises "this is what the last hull wrote", never "a hull is running".
 */
export interface HullRegistration {
  port: number;
  pid: number;
  startedAt: string;
  /** station names mounted in this hull (e.g. `['chartroom']`) -- lets a discovering tool know
   * which APIs the port actually serves before talking to it. */
  stations: string[];
}

export interface ServicesFile {
  version: 1;
  hull?: HullRegistration;
}

/** Same `homeDir` override pattern as chartroom's registry/daemon-info -- tests never touch the
 * real home directory. */
export function servicesJsonPath(homeDir: string = homedir()): string {
  return join(homeDir, SUITE_DIR_NAME, SERVICES_FILE_NAME);
}

/**
 * Corrupt/stale-tolerant read: a missing file, unreadable file, non-JSON content, or a shape that
 * isn't recognizably a services file all come back as an empty `{ version: 1 }` rather than
 * throwing -- discovery must degrade to "nothing registered", never crash a caller.
 */
export function readServices(homeDir: string = homedir()): ServicesFile {
  const path = servicesJsonPath(homeDir);
  if (!existsSync(path)) return { version: 1 };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ServicesFile>;
    if (typeof parsed !== 'object' || parsed === null) return { version: 1 };
    const hull = parsed.hull;
    if (
      hull &&
      typeof hull.port === 'number' &&
      typeof hull.pid === 'number' &&
      Array.isArray(hull.stations)
    ) {
      return {
        version: 1,
        hull: {
          port: hull.port,
          pid: hull.pid,
          startedAt: typeof hull.startedAt === 'string' ? hull.startedAt : '',
          stations: hull.stations.filter((s): s is string => typeof s === 'string'),
        },
      };
    }
    return { version: 1 };
  } catch {
    return { version: 1 };
  }
}

/**
 * Atomic write (tmp file + rename-over) so a concurrent reader never observes a half-written
 * JSON file -- the same discipline the voyage watcher expects of `progress.json` writers.
 * Preserves nothing beyond the known shape on purpose: version 1 owns the whole file.
 */
function writeServices(file: ServicesFile, homeDir: string = homedir()): void {
  const path = servicesJsonPath(homeDir);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

export function writeHullRegistration(hull: HullRegistration, homeDir: string = homedir()): void {
  writeServices({ version: 1, hull }, homeDir);
}

/** Best-effort clear (SIGINT/SIGTERM path) -- a failure here must never turn a clean shutdown
 * into a crash; worst case the next discoverer health-checks a stale entry and moves on. Only
 * clears the hull entry (rewrites the file without it); a missing/corrupt file is left alone. */
export function clearHullRegistration(homeDir: string = homedir()): void {
  try {
    const path = servicesJsonPath(homeDir);
    if (!existsSync(path)) return;
    writeServices({ version: 1 }, homeDir);
  } catch {
    // unwritable / already gone -- all fine.
  }
}

/** Test-oriented convenience: remove the file entirely. Exported for suite tooling; production
 * shutdown uses `clearHullRegistration` (which keeps the file present but empty). */
export function deleteServicesFile(homeDir: string = homedir()): void {
  try {
    unlinkSync(servicesJsonPath(homeDir));
  } catch {
    // already gone -- fine.
  }
}
