import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';

const SHIP_DIR_NAME = '.ship';
const DB_FILE_NAME = 'ship-comms.db';
const SCHEMA_VERSION = 1;

export interface MessageRow {
  id: string;
  from_session: string;
  to_session: string;
  text: string;
  created_at: string;
  /** ISO timestamp of the poll that handed the message over; NULL = still queued. */
  delivered_at: string | null;
}

export function shipCommsDbPath(homeDir?: string): string {
  return join(homeDir ?? homedir(), SHIP_DIR_NAME, DB_FILE_NAME);
}

export function openShipCommsDb(homeDir?: string): Database.Database {
  const path = shipCommsDbPath(homeDir);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      from_session TEXT NOT NULL,
      to_session TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_to_undelivered
      ON messages (to_session, delivered_at, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_from
      ON messages (from_session, created_at);
  `);
  db.pragma(`user_version = ${SCHEMA_VERSION}`);
  return db;
}

export interface CreateMessageInput {
  fromSession: string;
  toSession: string;
  text: string;
}

export function createMessage(
  db: Database.Database,
  input: CreateMessageInput,
  nowIso: string,
): MessageRow {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO messages (id, from_session, to_session, text, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.fromSession, input.toSession, input.text, nowIso);
  return db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow;
}

/** Atomically hands over every undelivered message addressed to `session`: marks them delivered
 * (one transaction -- a crashed reader before the mark re-receives, never loses) and returns
 * them oldest-first. At-least-once semantics, matching the hook's fail-open posture. */
export function pollMessages(db: Database.Database, session: string, nowIso: string): MessageRow[] {
  const take = db.transaction((): MessageRow[] => {
    const rows = db
      .prepare(
        `SELECT * FROM messages
         WHERE to_session = ? AND delivered_at IS NULL
         ORDER BY created_at ASC, id ASC`,
      )
      .all(session) as MessageRow[];
    if (rows.length > 0) {
      const mark = db.prepare('UPDATE messages SET delivered_at = ? WHERE id = ?');
      for (const row of rows) {
        mark.run(nowIso, row.id);
        row.delivered_at = nowIso;
      }
    }
    return rows;
  });
  return take();
}

/** Both directions, delivered included, oldest-first -- the session's full conversation record. */
export function listHistory(db: Database.Database, session: string): MessageRow[] {
  return db
    .prepare(
      `SELECT * FROM messages
       WHERE to_session = ? OR from_session = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(session, session) as MessageRow[];
}

export function countUndelivered(db: Database.Database): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM messages WHERE delivered_at IS NULL')
    .get() as { n: number };
  return row.n;
}

export interface MessageJson {
  id: string;
  fromSession: string;
  toSession: string;
  text: string;
  createdAt: string;
  deliveredAt: string | null;
}

export function messageToJson(row: MessageRow): MessageJson {
  return {
    id: row.id,
    fromSession: row.from_session,
    toSession: row.to_session,
    text: row.text,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at,
  };
}
