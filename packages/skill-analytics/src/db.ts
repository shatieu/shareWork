import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';

const SHIP_DIR_NAME = '.ship';
const DB_FILE_NAME = 'skill-analytics.db';
const SCHEMA_VERSION = 2;

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
  /** `message.id` of the last usage-bearing line consumed from this file. One API response is
   * written as multiple adjacent JSONL lines repeating the same usage block; persisting the
   * last-seen id lets the dedupe survive byte-cursor increments that split a response group
   * across collector runs (schema v2). */
  last_usage_message_id: string | null;
  updated_at: string;
}

/** Per-session token totals accrued by the incremental collector (schema v2). Counts are
 * message-id-deduped: one API response counts once, however many transcript lines it spans. */
export interface SessionUsageRow {
  session_id: string;
  project: string | null;
  cwd: string | null;
  transcript_path: string;
  input_tokens: number;
  output_tokens: number;
  cache_create_tokens: number;
  cache_read_tokens: number;
  message_count: number;
  model: string | null;
  first_ts: string | null;
  last_ts: string | null;
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
      last_usage_message_id TEXT,
      updated_at TEXT NOT NULL
    );

    -- One row per session: token totals deduped by message.id (one API response = one count,
    -- however many JSONL lines it spans). PRIVACY: identifiers and numbers only.
    CREATE TABLE IF NOT EXISTS session_usage (
      session_id TEXT PRIMARY KEY,
      project TEXT,
      cwd TEXT,
      transcript_path TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_create_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      first_ts TEXT,
      last_ts TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_session_usage_last_ts ON session_usage (last_ts);
    CREATE INDEX IF NOT EXISTS idx_session_usage_transcript ON session_usage (transcript_path);

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

  // v1 -> v2 migration: CREATE IF NOT EXISTS won't add the dedupe column to an existing
  // file_cursors, so probe and ALTER. Idempotent and safe across processes (WAL).
  const cursorCols = db.prepare('PRAGMA table_info(file_cursors)').all() as { name: string }[];
  if (!cursorCols.some((c) => c.name === 'last_usage_message_id')) {
    db.exec('ALTER TABLE file_cursors ADD COLUMN last_usage_message_id TEXT');
  }

  const versionRow = db.prepare('SELECT version FROM schema_meta LIMIT 1').get() as
    | { version: number }
    | undefined;
  if (!versionRow) {
    db.prepare('INSERT INTO schema_meta (version) VALUES (?)').run(SCHEMA_VERSION);
  } else if (versionRow.version < SCHEMA_VERSION) {
    db.prepare('UPDATE schema_meta SET version = ?').run(SCHEMA_VERSION);
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
