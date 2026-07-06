import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const SHIP_DIR_NAME = '.ship';
const SPOOL_SUBDIR = 'spool';
const SPOOL_FILE = 'events.jsonl';
const DRAINING_FILE = 'events.draining.jsonl';
const UNKNOWN_SIDECAR_FILE = 'events-unknown.jsonl';

export function spoolDir(homeDir: string = homedir()): string {
  return join(homeDir, SHIP_DIR_NAME, SPOOL_SUBDIR);
}

export function spoolPath(homeDir: string = homedir()): string {
  return join(spoolDir(homeDir), SPOOL_FILE);
}

function drainingPath(homeDir: string): string {
  return join(spoolDir(homeDir), DRAINING_FILE);
}

function drainedPath(homeDir: string, ts: string): string {
  return join(spoolDir(homeDir), `events.drained.${ts}.jsonl`);
}

export function unknownSidecarPath(homeDir: string = homedir()): string {
  return join(homeDir, SHIP_DIR_NAME, UNKNOWN_SIDECAR_FILE);
}

function ensureShipDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Append one envelope as a JSONL line to the spool (emit.mjs's fail-open fallback and the
 * ship-log ingest route's own last-resort). `fs.appendFileSync` is O_APPEND under the hood --
 * safe for concurrent writers. */
export function appendToSpool(envelope: unknown, homeDir: string = homedir()): void {
  const path = spoolPath(homeDir);
  ensureShipDir(path);
  appendFileSync(path, JSON.stringify(envelope) + '\n', 'utf8');
}

export function appendToUnknownSidecar(raw: unknown, homeDir: string = homedir()): void {
  const path = unknownSidecarPath(homeDir);
  ensureShipDir(path);
  appendFileSync(path, (typeof raw === 'string' ? raw : JSON.stringify(raw)) + '\n', 'utf8');
}

export interface DrainResult {
  drained: number;
  malformed: number;
  drainedFilePath: string | null;
}

/**
 * Drain the spool (plan §3.7): station start + before each rollup build. Atomic claim via
 * rename (`events.jsonl` -> `events.draining.jsonl`) so a concurrent emit.mjs append during the
 * drain either lands in the old file (already claimed, drained next time) or a fresh
 * `events.jsonl` the next drain picks up -- never lost, never double-processed mid-line.
 *
 * Crash recovery: if a stale `.draining` file already exists (a previous drain died mid-way),
 * it is drained first before claiming any new `events.jsonl`.
 *
 * "Delete nothing" (deletion is banned suite-wide): once fully processed, the draining file is
 * renamed to `events.drained.<ts>.jsonl` and left in the spool dir as a tiny append-only trail --
 * never truncated, never removed.
 */
export async function drainSpool(
  ingest: (envelope: unknown) => Promise<void> | void,
  homeDir: string = homedir(),
): Promise<DrainResult> {
  const total: DrainResult = { drained: 0, malformed: 0, drainedFilePath: null };

  const draining = drainingPath(homeDir);
  const live = spoolPath(homeDir);

  // Claim: prefer an already-in-progress (stale) draining file, else claim the live spool.
  if (!existsSync(draining) && existsSync(live)) {
    try {
      renameSync(live, draining);
    } catch {
      // Lost the race / nothing to claim -- fine, nothing to drain this round.
    }
  }

  if (!existsSync(draining)) {
    return total;
  }

  const raw = readFileSync(draining, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);

  for (const line of lines) {
    let envelope: unknown;
    try {
      envelope = JSON.parse(line);
    } catch {
      total.malformed += 1;
      appendToUnknownSidecar(line, homeDir);
      continue;
    }
    try {
      await ingest(envelope);
      total.drained += 1;
    } catch {
      // Ingest-level failure (e.g. schema mismatch) -- treat as unknown, never crash the drain.
      total.malformed += 1;
      appendToUnknownSidecar(envelope, homeDir);
    }
  }

  const ts = Date.now().toString();
  const finalPath = drainedPath(homeDir, ts);
  renameSync(draining, finalPath);
  total.drainedFilePath = finalPath;

  return total;
}

/** Whether the spool has anything pending (health-check surface, plan §3.5). */
export function spoolPending(homeDir: string = homedir()): boolean {
  return existsSync(spoolPath(homeDir)) || existsSync(drainingPath(homeDir));
}
