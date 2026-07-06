import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';

const SHIP_DIR_NAME = '.ship';
const DB_FILE_NAME = 'inbox.db';
const SCHEMA_VERSION = 1;

/** How long a pending permission request stays actionable before lazy expiry flips it to
 * 'expired' on read (plan 06 §1.1): the resolver hook that could deliver the decision into the
 * live session is long gone by then -- a stale "Allow" button would lie. The TTL is deliberately
 * generous vs the resolver's own default deadline (25 s): resolvers can be configured to wait
 * much longer (`SHIP_INBOX_WAIT_MS`), and the resolver reports its own timeout via the expire
 * endpoint anyway -- this TTL is only the net for killed/crashed resolvers. */
export const DEFAULT_PENDING_TTL_MS = 10 * 60_000;

export const PERMISSION_STATUSES = ['pending', 'allowed', 'denied', 'expired'] as const;
export type PermissionStatus = (typeof PERMISSION_STATUSES)[number];

/** Who put the request on the queue: 'resolver' = the Crew plugin's live permission.mjs hook
 * (a decision can reach the session); 'hook' = a PermissionRequest envelope that arrived over
 * the ship-log ingest transport (spool drain / forwarded event -- record-only, no live prompt
 * is attached). */
export const PERMISSION_SOURCES = ['resolver', 'hook'] as const;
export type PermissionSource = (typeof PERMISSION_SOURCES)[number];

export const QUESTION_STATUSES = ['open', 'acknowledged'] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export interface PermissionRequestRow {
  id: string;
  session_id: string;
  cwd: string;
  project: string | null;
  tool_name: string;
  tool_input_json: string | null;
  source: PermissionSource;
  status: PermissionStatus;
  decision_message: string | null;
  always_allow_rule: string | null;
  rule_backup_path: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface AgentQuestionRow {
  id: string;
  session_id: string;
  cwd: string;
  project: string | null;
  kind: string;
  message: string;
  status: QuestionStatus;
  created_at: string;
  acked_at: string | null;
}

export function shipInboxDbPath(homeDir?: string): string {
  return join(homeDir ?? homedir(), SHIP_DIR_NAME, DB_FILE_NAME);
}

/** Last path segment of a cwd, tolerant of both separators regardless of host OS -- hook
 * payloads carry absolute Windows backslash paths on this machine (researcher R1) but may carry
 * POSIX paths from other machines' spools. */
export function projectFromCwd(cwd: string): string | null {
  const trimmed = cwd.replace(/[\\/]+$/, '');
  if (!trimmed) return null;
  const segments = trimmed.split(/[\\/]/);
  const last = segments[segments.length - 1];
  return last || null;
}

export function openShipInboxDb(homeDir?: string): Database.Database {
  const path = shipInboxDbPath(homeDir);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma(`user_version = ${SCHEMA_VERSION}`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS permission_requests (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      cwd TEXT NOT NULL DEFAULT '',
      project TEXT,
      tool_name TEXT NOT NULL,
      tool_input_json TEXT,
      source TEXT NOT NULL CHECK (source IN ('resolver', 'hook')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'allowed', 'denied', 'expired')),
      decision_message TEXT,
      always_allow_rule TEXT,
      rule_backup_path TEXT,
      created_at TEXT NOT NULL,
      decided_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_permission_requests_status
      ON permission_requests (status, created_at);

    CREATE TABLE IF NOT EXISTS agent_questions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      cwd TEXT NOT NULL DEFAULT '',
      project TEXT,
      kind TEXT NOT NULL,
      message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged')),
      created_at TEXT NOT NULL,
      acked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_questions_status
      ON agent_questions (status, created_at);
  `);

  return db;
}

/* ── permission requests ── */

export interface CreatePermissionInput {
  sessionId: string;
  cwd: string;
  toolName: string;
  toolInput?: unknown;
  source: PermissionSource;
}

export function createPermissionRequest(
  db: Database.Database,
  input: CreatePermissionInput,
  nowIso: string,
): PermissionRequestRow {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO permission_requests
       (id, session_id, cwd, project, tool_name, tool_input_json, source, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    id,
    input.sessionId,
    input.cwd,
    projectFromCwd(input.cwd),
    input.toolName,
    input.toolInput === undefined ? null : JSON.stringify(input.toolInput),
    input.source,
    nowIso,
  );
  return getPermissionRequest(db, id) as PermissionRequestRow;
}

export function getPermissionRequest(
  db: Database.Database,
  id: string,
): PermissionRequestRow | undefined {
  return db.prepare('SELECT * FROM permission_requests WHERE id = ?').get(id) as
    | PermissionRequestRow
    | undefined;
}

/** Lazy expiry (plan 06 §1.1): pending rows older than the TTL flip to 'expired' -- called at
 * the top of every read/decide path rather than by a background timer. Returns the number of
 * rows flipped. */
export function expireStalePending(
  db: Database.Database,
  nowIso: string,
  ttlMs: number = DEFAULT_PENDING_TTL_MS,
): number {
  const cutoff = new Date(new Date(nowIso).getTime() - ttlMs).toISOString();
  const result = db
    .prepare(
      `UPDATE permission_requests SET status = 'expired', decided_at = ?
       WHERE status = 'pending' AND created_at < ?`,
    )
    .run(nowIso, cutoff);
  return result.changes;
}

export function listPermissionRequests(
  db: Database.Database,
  filter: { status?: PermissionStatus } = {},
): PermissionRequestRow[] {
  if (filter.status) {
    return db
      .prepare('SELECT * FROM permission_requests WHERE status = ? ORDER BY created_at DESC')
      .all(filter.status) as PermissionRequestRow[];
  }
  return db
    .prepare('SELECT * FROM permission_requests ORDER BY created_at DESC')
    .all() as PermissionRequestRow[];
}

export interface DecideInput {
  behavior: 'allow' | 'deny';
  message?: string;
  alwaysAllowRule?: string;
  ruleBackupPath?: string;
}

/** Records a decision iff the row is still pending (the WHERE guard is the concurrency control:
 * double-decides and decide-after-expiry both come back `undefined` -> caller answers 409). */
export function decidePermissionRequest(
  db: Database.Database,
  id: string,
  decision: DecideInput,
  nowIso: string,
): PermissionRequestRow | undefined {
  const result = db
    .prepare(
      `UPDATE permission_requests
       SET status = ?, decision_message = ?, always_allow_rule = ?, rule_backup_path = ?, decided_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .run(
      decision.behavior === 'allow' ? 'allowed' : 'denied',
      decision.message ?? null,
      decision.alwaysAllowRule ?? null,
      decision.ruleBackupPath ?? null,
      nowIso,
      id,
    );
  if (result.changes === 0) return undefined;
  return getPermissionRequest(db, id);
}

/** The resolver hook's own timeout report: flips its still-pending request to 'expired' so the
 * inbox never shows an actionable button for a prompt nobody can resolve anymore. */
export function expirePermissionRequest(
  db: Database.Database,
  id: string,
  nowIso: string,
): PermissionRequestRow | undefined {
  const result = db
    .prepare(
      `UPDATE permission_requests SET status = 'expired', decided_at = ?
       WHERE id = ? AND status = 'pending'`,
    )
    .run(nowIso, id);
  if (result.changes === 0) return undefined;
  return getPermissionRequest(db, id);
}

export interface PermissionRequestJson {
  id: string;
  sessionId: string;
  cwd: string;
  project: string | null;
  toolName: string;
  toolInput: unknown;
  source: PermissionSource;
  status: PermissionStatus;
  decisionMessage: string | null;
  alwaysAllowRule: string | null;
  ruleBackupPath: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export function permissionToJson(row: PermissionRequestRow): PermissionRequestJson {
  return {
    id: row.id,
    sessionId: row.session_id,
    cwd: row.cwd,
    project: row.project,
    toolName: row.tool_name,
    toolInput: row.tool_input_json === null ? undefined : JSON.parse(row.tool_input_json),
    source: row.source,
    status: row.status,
    decisionMessage: row.decision_message,
    alwaysAllowRule: row.always_allow_rule,
    ruleBackupPath: row.rule_backup_path,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  };
}

/* ── agent questions ── */

export interface CreateQuestionInput {
  sessionId: string;
  cwd: string;
  kind: string;
  message: string;
}

/** Inserts unless an identical OPEN question (session, kind, message) already exists --
 * Notification hooks re-fire (idle re-prompts, spool re-delivery) and the inbox must not fill
 * with duplicates. Returns the existing or new row plus whether an insert happened. */
export function createAgentQuestion(
  db: Database.Database,
  input: CreateQuestionInput,
  nowIso: string,
): { row: AgentQuestionRow; created: boolean } {
  const existing = db
    .prepare(
      `SELECT * FROM agent_questions
       WHERE status = 'open' AND session_id = ? AND kind = ? AND message = ?`,
    )
    .get(input.sessionId, input.kind, input.message) as AgentQuestionRow | undefined;
  if (existing) return { row: existing, created: false };

  const id = randomUUID();
  db.prepare(
    `INSERT INTO agent_questions (id, session_id, cwd, project, kind, message, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
  ).run(id, input.sessionId, input.cwd, projectFromCwd(input.cwd), input.kind, input.message, nowIso);
  const row = db.prepare('SELECT * FROM agent_questions WHERE id = ?').get(id) as AgentQuestionRow;
  return { row, created: true };
}

export function getAgentQuestion(
  db: Database.Database,
  id: string,
): AgentQuestionRow | undefined {
  return db.prepare('SELECT * FROM agent_questions WHERE id = ?').get(id) as
    | AgentQuestionRow
    | undefined;
}

export function listAgentQuestions(
  db: Database.Database,
  filter: { status?: QuestionStatus } = {},
): AgentQuestionRow[] {
  if (filter.status) {
    return db
      .prepare('SELECT * FROM agent_questions WHERE status = ? ORDER BY created_at DESC')
      .all(filter.status) as AgentQuestionRow[];
  }
  return db.prepare('SELECT * FROM agent_questions ORDER BY created_at DESC').all() as AgentQuestionRow[];
}

export function ackAgentQuestion(
  db: Database.Database,
  id: string,
  nowIso: string,
): AgentQuestionRow | undefined {
  const result = db
    .prepare(
      `UPDATE agent_questions SET status = 'acknowledged', acked_at = ?
       WHERE id = ? AND status = 'open'`,
    )
    .run(nowIso, id);
  if (result.changes === 0) return undefined;
  return getAgentQuestion(db, id);
}

export interface AgentQuestionJson {
  id: string;
  sessionId: string;
  cwd: string;
  project: string | null;
  kind: string;
  message: string;
  status: QuestionStatus;
  createdAt: string;
  ackedAt: string | null;
}

export function questionToJson(row: AgentQuestionRow): AgentQuestionJson {
  return {
    id: row.id,
    sessionId: row.session_id,
    cwd: row.cwd,
    project: row.project,
    kind: row.kind,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
    ackedAt: row.acked_at,
  };
}
