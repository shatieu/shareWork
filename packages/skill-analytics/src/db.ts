import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';

const SHIP_DIR_NAME = '.ship';
const DB_FILE_NAME = 'skill-analytics.db';
const SCHEMA_VERSION = 1;

/** Path to the analytics SQLite store. `homeDir` override so tests and the CLI never have to
 * touch the real `~/.ship/` (ship-log's db.ts pattern). */
export function skillAnalyticsDbPath(homeDir: string = homedir()): string {
  return join(homeDir, SHIP_DIR_NAME, DB_FILE_NAME);
}

export interface InvocationRow {
  id: number;
  file: string;
  line_no: number;
  kind: string;
  name: string;
  trigger_mode: string;
  project: string | null;
  cwd: string | null;
  session_id: string | null;
  ts: string | null;
  date: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_create_tokens: number;
  cache_read_tokens: number;
  model: string | null;
}

export interface FileCursorRow {
  path: string;
  offset: number;
  line_no: number;
  size: number;
  mtime_ms: number;
  open_invocation_id: number | null;
  updated_at: string;
}

/**
 * Open (creating if absent) the WAL-mode store and ensure the v1 schema. Safe to call
 * repeatedly and from separate processes (hull station vs one-shot CLI) — same discipline as
 * ship-log's openShipLogDb.
 */
export function openSkillAnalyticsDb(homeDir: string = homedir()): Database.Database {
  const path = skillAnalyticsDbPath(homeDir);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      version INTEGER NOT NULL
    );

    -- One row per transcript file: incremental-parse byte cursor plus the id of the invocation
    -- whose token-attribution window is still open at EOF (windows survive appends between
    -- collector runs -- plan 11 attribution note).
    CREATE TABLE IF NOT EXISTS file_cursors (
      path TEXT PRIMARY KEY,
      offset INTEGER NOT NULL,
      line_no INTEGER NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      open_invocation_id INTEGER,
      updated_at TEXT NOT NULL
    );

    -- One row per skill/agent/slash-command invocation. Token columns are the usage ACCRUED
    -- to this invocation by the attribution heuristic, not the message's own usage alone.
    -- PRIVACY: identifiers and numbers only; no message content is ever stored.
    CREATE TABLE IF NOT EXISTS invocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      trigger_mode TEXT NOT NULL,
      project TEXT,
      cwd TEXT,
      session_id TEXT,
      ts TEXT,
      date TEXT,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_create_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      UNIQUE (file, line_no, kind, name)
    );

    CREATE INDEX IF NOT EXISTS idx_invocations_name ON invocations (name);
    CREATE INDEX IF NOT EXISTS idx_invocations_date ON invocations (date);
    CREATE INDEX IF NOT EXISTS idx_invocations_project ON invocations (project);
  `);

  const versionRow = db.prepare('SELECT version FROM schema_meta LIMIT 1').get() as
    | { version: number }
    | undefined;
  if (!versionRow) {
    db.prepare('INSERT INTO schema_meta (version) VALUES (?)').run(SCHEMA_VERSION);
  }
  return db;
}

/** Project label for aggregation: the last path segment of the session's cwd. Good enough to
 * group "per project + global" (spec §A metrics) without any registry dependency. */
export function projectFromCwd(cwd: string | undefined): string | null {
  if (!cwd) return null;
  const name = basename(cwd.replace(/[\\/]+$/, ''));
  return name.length > 0 ? name : null;
}
