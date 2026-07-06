import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { DIFFICULTIES, type Difficulty } from 'suite-conventions';

const SHIP_DIR_NAME = '.ship';
const DB_FILE_NAME = 'ledger.db';
const SCHEMA_VERSION = 1;

/**
 * Status enum deliberately identical to Team Tasks' `task_status` Postgres enum
 * (team-tasks/src/lib/database.types.ts) -- Ship_Spec §3: "Schema deliberately aligned with Team
 * Tasks' `tasks` table" so "promote" (package 9, §9.5) is a column mapping, not a translation
 * layer.
 */
export const LEDGER_STATUSES = [
  'open',
  'claimed',
  'in_progress',
  'in_review',
  'changes_requested',
  'done',
  'blocked',
] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

/** Identical to Team Tasks' `task_priority` enum. */
export const LEDGER_PRIORITIES = ['low', 'normal', 'high'] as const;
export type LedgerPriority = (typeof LEDGER_PRIORITIES)[number];

/** Ship_Spec §3's `source` field: who put the item on the ledger. */
export const LEDGER_SOURCES = ['human', 'agent', 'native-mirror'] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];

/**
 * Deterministic stage progress (Ship_Spec §3, 5 July addition: "`stage_progress` (0-100,
 * deterministic from status stage)"). A pure function of status -- recomputed on every status
 * change, never stored independently of it. The values are tuning constants (plan 05: Captain
 * may retune), chosen so the Voyage bar reads sensibly: blocked sits low (it is NOT progress),
 * changes_requested sits below in_review (rework pending).
 */
export function stageProgressFor(status: LedgerStatus): number {
  switch (status) {
    case 'open':
      return 0;
    case 'claimed':
      return 10;
    case 'blocked':
      return 25;
    case 'in_progress':
      return 40;
    case 'changes_requested':
      return 55;
    case 'in_review':
      return 80;
    case 'done':
      return 100;
  }
}

export interface ItemRow {
  id: string;
  title: string;
  spec_md: string;
  project: string | null;
  status: LedgerStatus;
  priority: LedgerPriority;
  source: LedgerSource;
  session_refs_json: string;
  stage_progress: number;
  difficulty: Difficulty | null;
  remaining_guess_h: number | null;
  native_session_id: string | null;
  native_task_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Path to the SQLite truth store (Ship_Spec §3: `~/.ship/ledger.db`). Accepts a `homeDir`
 * override so every test and the standalone CLI can point at a disposable temp directory. */
export function shipLedgerDbPath(homeDir: string = homedir()): string {
  return join(homeDir, SHIP_DIR_NAME, DB_FILE_NAME);
}

/**
 * Open (creating if absent) the WAL-mode SQLite store and ensure the v1 schema exists. Safe to
 * call repeatedly/concurrently -- WAL lets the hull's station and a separate `ship-ledger mcp`
 * stdio process write from separate processes (same two-process pattern ship-log proved with
 * its CLI-vs-hull concurrency).
 */
export function openShipLedgerDb(homeDir: string = homedir()): Database.Database {
  const path = shipLedgerDbPath(homeDir);
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

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      spec_md TEXT NOT NULL DEFAULT '',
      project TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT NOT NULL DEFAULT 'normal',
      source TEXT NOT NULL,
      session_refs_json TEXT NOT NULL DEFAULT '[]',
      stage_progress INTEGER NOT NULL DEFAULT 0,
      difficulty TEXT,
      remaining_guess_h REAL,
      native_session_id TEXT,
      native_task_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(native_session_id, native_task_id)
    );

    CREATE INDEX IF NOT EXISTS idx_items_project ON items(project);
    CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
  `);

  const meta = db.prepare('SELECT version FROM schema_meta LIMIT 1').get() as
    | { version: number }
    | undefined;
  if (!meta) {
    db.prepare('INSERT INTO schema_meta (version) VALUES (?)').run(SCHEMA_VERSION);
  }

  return db;
}

function assertOneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  field: string,
): asserts value is T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`ship-ledger: invalid ${field} '${value}' (expected one of: ${allowed.join(', ')})`);
  }
}

export interface ItemCreateInput {
  title: string;
  specMd?: string;
  project?: string | null;
  status?: LedgerStatus;
  priority?: LedgerPriority;
  source: LedgerSource;
  sessionRefs?: string[];
  difficulty?: Difficulty | null;
  remainingGuessH?: number | null;
  nativeSessionId?: string | null;
  nativeTaskId?: string | null;
}

export function createItem(db: Database.Database, input: ItemCreateInput, at: string): ItemRow {
  const status = input.status ?? 'open';
  const priority = input.priority ?? 'normal';
  assertOneOf(status, LEDGER_STATUSES, 'status');
  assertOneOf(priority, LEDGER_PRIORITIES, 'priority');
  assertOneOf(input.source, LEDGER_SOURCES, 'source');
  if (input.difficulty != null) assertOneOf(input.difficulty, DIFFICULTIES, 'difficulty');

  const id = randomUUID();
  db.prepare(
    `INSERT INTO items (id, title, spec_md, project, status, priority, source, session_refs_json,
                        stage_progress, difficulty, remaining_guess_h, native_session_id,
                        native_task_id, created_at, updated_at)
     VALUES (@id, @title, @specMd, @project, @status, @priority, @source, @sessionRefsJson,
             @stageProgress, @difficulty, @remainingGuessH, @nativeSessionId, @nativeTaskId,
             @at, @at)`,
  ).run({
    id,
    title: input.title,
    specMd: input.specMd ?? '',
    project: input.project ?? null,
    status,
    priority,
    source: input.source,
    sessionRefsJson: JSON.stringify(input.sessionRefs ?? []),
    stageProgress: stageProgressFor(status),
    difficulty: input.difficulty ?? null,
    remainingGuessH: input.remainingGuessH ?? null,
    nativeSessionId: input.nativeSessionId ?? null,
    nativeTaskId: input.nativeTaskId ?? null,
    at,
  });
  return getItem(db, id)!;
}

export function getItem(db: Database.Database, id: string): ItemRow | undefined {
  return db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
}

/** Mirror lookup key (plan 05): the native CLI's task ids are per-session ("1", "2", ...), so
 * (session, task) is the identity of a native task. */
export function findMirrorItem(
  db: Database.Database,
  nativeSessionId: string,
  nativeTaskId: string,
): ItemRow | undefined {
  return db
    .prepare('SELECT * FROM items WHERE native_session_id = ? AND native_task_id = ?')
    .get(nativeSessionId, nativeTaskId) as ItemRow | undefined;
}

export interface ItemListFilter {
  project?: string;
  status?: LedgerStatus;
  source?: LedgerSource;
}

export function listItems(db: Database.Database, filter: ItemListFilter = {}): ItemRow[] {
  const clauses: string[] = [];
  const params: Record<string, string> = {};
  if (filter.project) {
    clauses.push('project = @project');
    params.project = filter.project;
  }
  if (filter.status) {
    assertOneOf(filter.status, LEDGER_STATUSES, 'status');
    clauses.push('status = @status');
    params.status = filter.status;
  }
  if (filter.source) {
    assertOneOf(filter.source, LEDGER_SOURCES, 'source');
    clauses.push('source = @source');
    params.source = filter.source;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM items ${where} ORDER BY created_at ASC, id ASC`)
    .all(params) as ItemRow[];
}

export interface ItemPatch {
  title?: string;
  specMd?: string;
  project?: string | null;
  status?: LedgerStatus;
  priority?: LedgerPriority;
  difficulty?: Difficulty | null;
  remainingGuessH?: number | null;
  /** Appended to `session_refs` if not already present (dedupe). */
  addSessionRef?: string;
}

/**
 * Patch an item. A `status` change recomputes `stage_progress` deterministically
 * (Ship_Spec §3); `updated_at` always advances. Returns the fresh row, or `undefined` when the
 * id doesn't exist (callers decide whether that's a 404 or a tool error).
 */
export function updateItem(
  db: Database.Database,
  id: string,
  patch: ItemPatch,
  at: string,
): ItemRow | undefined {
  const existing = getItem(db, id);
  if (!existing) return undefined;

  if (patch.status !== undefined) assertOneOf(patch.status, LEDGER_STATUSES, 'status');
  if (patch.priority !== undefined) assertOneOf(patch.priority, LEDGER_PRIORITIES, 'priority');
  if (patch.difficulty != null) assertOneOf(patch.difficulty, DIFFICULTIES, 'difficulty');

  const sessionRefs: string[] = JSON.parse(existing.session_refs_json);
  if (patch.addSessionRef && !sessionRefs.includes(patch.addSessionRef)) {
    sessionRefs.push(patch.addSessionRef);
  }

  const status = patch.status ?? existing.status;
  db.prepare(
    `UPDATE items SET
       title = @title,
       spec_md = @specMd,
       project = @project,
       status = @status,
       priority = @priority,
       session_refs_json = @sessionRefsJson,
       stage_progress = @stageProgress,
       difficulty = @difficulty,
       remaining_guess_h = @remainingGuessH,
       updated_at = @at
     WHERE id = @id`,
  ).run({
    id,
    title: patch.title ?? existing.title,
    specMd: patch.specMd ?? existing.spec_md,
    project: patch.project === undefined ? existing.project : patch.project,
    status,
    priority: patch.priority ?? existing.priority,
    sessionRefsJson: JSON.stringify(sessionRefs),
    stageProgress: patch.status !== undefined ? stageProgressFor(status) : existing.stage_progress,
    difficulty: patch.difficulty === undefined ? existing.difficulty : patch.difficulty,
    remainingGuessH:
      patch.remainingGuessH === undefined ? existing.remaining_guess_h : patch.remainingGuessH,
    at,
  });
  return getItem(db, id);
}

/** The JSON shape items travel as over HTTP and MCP (camelCase, parsed refs) -- one converter so
 * the two surfaces can never drift apart. */
export interface ItemJson {
  id: string;
  title: string;
  specMd: string;
  project: string | null;
  status: LedgerStatus;
  priority: LedgerPriority;
  source: LedgerSource;
  sessionRefs: string[];
  stageProgress: number;
  difficulty: Difficulty | null;
  remainingGuessH: number | null;
  nativeSessionId: string | null;
  nativeTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function itemToJson(row: ItemRow): ItemJson {
  return {
    id: row.id,
    title: row.title,
    specMd: row.spec_md,
    project: row.project,
    status: row.status,
    priority: row.priority,
    source: row.source,
    sessionRefs: JSON.parse(row.session_refs_json),
    stageProgress: row.stage_progress,
    difficulty: row.difficulty,
    remainingGuessH: row.remaining_guess_h,
    nativeSessionId: row.native_session_id,
    nativeTaskId: row.native_task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
