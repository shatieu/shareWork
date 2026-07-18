import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';

const SHIP_DIR_NAME = '.ship';
const DB_FILE_NAME = 'log.db';
/** v2 (wave2-E): `sessions.watched` -- the fleet-view hide flag. The vendor fleet list
 * (`claude agents --json`) is stateless and keeps re-reporting a session, so "unwatch" must be a
 * persisted server-side filter; the suite's only persisted session table lives here (wave2-e
 * findings §b option 2). */
const SCHEMA_VERSION = 2;

/** Path to the SQLite truth store (plan §3.4). Accepts a `homeDir` override so every test and
 * the standalone CLI can point at a disposable temp directory -- no test ever opens the real
 * `~/.ship/log.db`. */
export function shipLogDbPath(homeDir: string = homedir()): string {
  return join(homeDir, SHIP_DIR_NAME, DB_FILE_NAME);
}

export interface SessionRow {
  session_id: string;
  cwd: string;
  repo_root: string | null;
  project: string | null;
  branch_start: string | null;
  head_start: string | null;
  transcript_path: string | null;
  started_at: string;
  last_stop_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  captured: number;
  /** 1 = shown in fleet views (default); 0 = hidden ("unwatched") until rewatched. */
  watched: number;
}

export interface EntryRow {
  id: number;
  session_id: string;
  date: string;
  project: string | null;
  repo_root: string | null;
  branch: string | null;
  commits_json: string;
  files_json: string;
  summary: string;
  summary_model: string | null;
  fragment_path: string | null;
  created_at: string;
  partial: number;
}

export interface RollupRow {
  date: string;
  digest_md: string;
  model: string | null;
  entry_count: number;
  created_at: string;
}

/**
 * Open (creating if absent) the WAL-mode SQLite store and ensure the v1 schema exists. Safe to
 * call repeatedly/concurrently (CLI-vs-hull) -- `CREATE TABLE IF NOT EXISTS` + `journal_mode=WAL`
 * lets a running hull and a one-shot `ship-log capture` write from separate processes.
 */
export function openShipLogDb(homeDir: string = homedir()): Database.Database {
  const path = shipLogDbPath(homeDir);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      version INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      cwd TEXT NOT NULL,
      repo_root TEXT,
      project TEXT,
      branch_start TEXT,
      head_start TEXT,
      transcript_path TEXT,
      started_at TEXT NOT NULL,
      last_stop_at TEXT,
      ended_at TEXT,
      end_reason TEXT,
      captured INTEGER NOT NULL DEFAULT 0,
      watched INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      date TEXT NOT NULL,
      project TEXT,
      repo_root TEXT,
      branch TEXT,
      commits_json TEXT NOT NULL,
      files_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      summary_model TEXT,
      fragment_path TEXT,
      created_at TEXT NOT NULL,
      partial INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);

    CREATE TABLE IF NOT EXISTS rollups (
      date TEXT PRIMARY KEY,
      digest_md TEXT NOT NULL,
      model TEXT,
      entry_count INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // v1 -> v2 migration: pre-existing sessions tables lack `watched`. `ALTER TABLE ADD COLUMN`
  // with a non-null default is safe/idempotent-guarded here and preserves every existing row
  // (existing sessions default to watched = 1, the pre-migration behavior).
  const sessionColumns = db.pragma('table_info(sessions)') as { name: string }[];
  if (!sessionColumns.some((column) => column.name === 'watched')) {
    db.exec('ALTER TABLE sessions ADD COLUMN watched INTEGER NOT NULL DEFAULT 1');
  }

  const meta = db.prepare('SELECT version FROM schema_meta LIMIT 1').get() as
    | { version: number }
    | undefined;
  if (!meta) {
    db.prepare('INSERT INTO schema_meta (version) VALUES (?)').run(SCHEMA_VERSION);
  } else if (meta.version < SCHEMA_VERSION) {
    db.prepare('UPDATE schema_meta SET version = ?').run(SCHEMA_VERSION);
  }

  return db;
}

export interface SessionUpsertInput {
  sessionId: string;
  cwd: string;
  repoRoot?: string | null;
  project?: string | null;
  branchStart?: string | null;
  headStart?: string | null;
  transcriptPath?: string | null;
  startedAt: string;
}

/** SessionStart upsert -- a duplicate SessionStart for the same id updates the mutable fields
 * (transcript path, cwd) without clobbering the original started_at/branch_start/head_start. */
export function upsertSessionStart(db: Database.Database, input: SessionUpsertInput): void {
  db.prepare(
    `INSERT INTO sessions (session_id, cwd, repo_root, project, branch_start, head_start, transcript_path, started_at, captured)
     VALUES (@sessionId, @cwd, @repoRoot, @project, @branchStart, @headStart, @transcriptPath, @startedAt, 0)
     ON CONFLICT(session_id) DO UPDATE SET
       cwd = excluded.cwd,
       transcript_path = COALESCE(excluded.transcript_path, sessions.transcript_path)`,
  ).run({
    sessionId: input.sessionId,
    cwd: input.cwd,
    repoRoot: input.repoRoot ?? null,
    project: input.project ?? null,
    branchStart: input.branchStart ?? null,
    headStart: input.headStart ?? null,
    transcriptPath: input.transcriptPath ?? null,
    startedAt: input.startedAt,
  });
}

/** Fallback insert path for a session whose SessionStart was never seen (missing-start /
 * degraded capture, plan §3.8). Only inserts if absent -- never overwrites a real SessionStart
 * row that arrives out of order. */
export function ensureSessionRow(db: Database.Database, input: SessionUpsertInput): void {
  db.prepare(
    `INSERT OR IGNORE INTO sessions (session_id, cwd, repo_root, project, branch_start, head_start, transcript_path, started_at, captured)
     VALUES (@sessionId, @cwd, @repoRoot, @project, @branchStart, @headStart, @transcriptPath, @startedAt, 0)`,
  ).run({
    sessionId: input.sessionId,
    cwd: input.cwd,
    repoRoot: input.repoRoot ?? null,
    project: input.project ?? null,
    branchStart: input.branchStart ?? null,
    headStart: input.headStart ?? null,
    transcriptPath: input.transcriptPath ?? null,
    startedAt: input.startedAt,
  });
}

export function getSession(db: Database.Database, sessionId: string): SessionRow | undefined {
  return db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as
    | SessionRow
    | undefined;
}

export function touchStop(
  db: Database.Database,
  sessionId: string,
  at: string,
  transcriptPath?: string | null,
): void {
  db.prepare(
    `UPDATE sessions SET last_stop_at = ?, transcript_path = COALESCE(?, transcript_path) WHERE session_id = ?`,
  ).run(at, transcriptPath ?? null, sessionId);
}

export function markSessionEnded(
  db: Database.Database,
  sessionId: string,
  at: string,
  reason: string | null,
): void {
  db.prepare(`UPDATE sessions SET ended_at = ?, end_reason = ? WHERE session_id = ?`).run(
    at,
    reason,
    sessionId,
  );
}

export function markCaptured(db: Database.Database, sessionId: string): void {
  db.prepare(`UPDATE sessions SET captured = 1 WHERE session_id = ?`).run(sessionId);
}

/**
 * Persist the fleet-view watch flag (wave2-E). The vendor fleet keeps re-reporting sessions
 * ship-log may never have seen a SessionStart for (started before the hull, other machines'
 * spools), and the hide must still stick -- so unwatching an unknown session plants a minimal
 * stub row (cwd '', started_at now), the same degraded posture as `ensureSessionRow`. A real
 * SessionStart arriving later only updates cwd/transcript (upsertSessionStart), never `watched`.
 */
export function setSessionWatched(
  db: Database.Database,
  sessionId: string,
  watched: boolean,
  nowIso: string,
): SessionRow {
  db.prepare(
    `INSERT INTO sessions (session_id, cwd, started_at, captured, watched)
     VALUES (?, '', ?, 0, ?)
     ON CONFLICT(session_id) DO UPDATE SET watched = excluded.watched`,
  ).run(sessionId, nowIso, watched ? 1 : 0);
  return getSession(db, sessionId) as SessionRow;
}

/** The persisted hide-list consumed by fleet views (ship-console overview filter contract). */
export function listUnwatchedSessionIds(db: Database.Database): string[] {
  const rows = db
    .prepare('SELECT session_id FROM sessions WHERE watched = 0 ORDER BY session_id')
    .all() as { session_id: string }[];
  return rows.map((row) => row.session_id);
}

/** Sessions eligible for the orphan sweep (plan §3.8): last checkpointed more than `olderThanMs`
 * ago, never captured, and not already ended (a session with an end_reason but captured=0 is
 * mid-capture-crash territory, not an orphan -- swept anyway since capture is idempotent). */
export function findOrphanSessions(
  db: Database.Database,
  nowIso: string,
  olderThanMs: number,
): SessionRow[] {
  const cutoff = new Date(new Date(nowIso).getTime() - olderThanMs).toISOString();
  return db
    .prepare(
      `SELECT * FROM sessions
       WHERE captured = 0
         AND COALESCE(last_stop_at, started_at) < ?`,
    )
    .all(cutoff) as SessionRow[];
}

export interface EntryInsertInput {
  sessionId: string;
  date: string;
  project?: string | null;
  repoRoot?: string | null;
  branch?: string | null;
  commits: unknown;
  files: unknown;
  summary: string;
  summaryModel?: string | null;
  fragmentPath?: string | null;
  createdAt: string;
  partial?: boolean;
}

export function insertEntry(db: Database.Database, input: EntryInsertInput): number {
  const result = db
    .prepare(
      `INSERT INTO entries (session_id, date, project, repo_root, branch, commits_json, files_json, summary, summary_model, fragment_path, created_at, partial)
       VALUES (@sessionId, @date, @project, @repoRoot, @branch, @commitsJson, @filesJson, @summary, @summaryModel, @fragmentPath, @createdAt, @partial)`,
    )
    .run({
      sessionId: input.sessionId,
      date: input.date,
      project: input.project ?? null,
      repoRoot: input.repoRoot ?? null,
      branch: input.branch ?? null,
      commitsJson: JSON.stringify(input.commits ?? []),
      filesJson: JSON.stringify(input.files ?? []),
      summary: input.summary,
      summaryModel: input.summaryModel ?? null,
      fragmentPath: input.fragmentPath ?? null,
      createdAt: input.createdAt,
      partial: input.partial ? 1 : 0,
    });
  return Number(result.lastInsertRowid);
}

export function listEntries(
  db: Database.Database,
  filter: { date?: string; project?: string } = {},
): EntryRow[] {
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (filter.date) {
    clauses.push('date = @date');
    params.date = filter.date;
  }
  if (filter.project) {
    clauses.push('project = @project');
    params.project = filter.project;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM entries ${where} ORDER BY created_at ASC`)
    .all(params) as EntryRow[];
}

/** Distinct entry dates, oldest first -- the rounds job's worklist (rounds.ts). */
export function listEntryDates(db: Database.Database): string[] {
  const rows = db
    .prepare('SELECT DISTINCT date FROM entries ORDER BY date ASC')
    .all() as { date: string }[];
  return rows.map((row) => row.date);
}

export function upsertRollup(db: Database.Database, row: RollupRow): void {
  db.prepare(
    `INSERT INTO rollups (date, digest_md, model, entry_count, created_at)
     VALUES (@date, @digest_md, @model, @entry_count, @created_at)
     ON CONFLICT(date) DO UPDATE SET
       digest_md = excluded.digest_md,
       model = excluded.model,
       entry_count = excluded.entry_count,
       created_at = excluded.created_at`,
  ).run(row);
}

export function getRollup(db: Database.Database, date: string): RollupRow | undefined {
  return db.prepare('SELECT * FROM rollups WHERE date = ?').get(date) as RollupRow | undefined;
}
