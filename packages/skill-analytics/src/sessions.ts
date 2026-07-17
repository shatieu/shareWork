import type Database from 'better-sqlite3';
import type { SessionUsageRow } from './db.js';

/**
 * Per-session token usage queries (wave2-I). Read side of the `session_usage` table the
 * incremental collector maintains; counts are message-id-deduped (one API response = one
 * count). Token counts only — never cost estimates (model pricing drifts; ccusage owns cost).
 */

export interface SessionUsageEntry {
  sessionId: string;
  /** Last path segment of the session's cwd — the transcript-derived project label. */
  project: string | null;
  cwd: string | null;
  transcriptPath: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
  /** Distinct API responses counted (post-dedupe), not JSONL line count. */
  messageCount: number;
  model: string | null;
  firstTs: string | null;
  lastTs: string | null;
  /** From ship-log's watched-state contract when mounted; undefined when it isn't. */
  watched?: boolean;
}

function toEntry(row: SessionUsageRow): SessionUsageEntry {
  return {
    sessionId: row.session_id,
    project: row.project,
    cwd: row.cwd,
    transcriptPath: row.transcript_path,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheCreateTokens: row.cache_create_tokens,
    cacheReadTokens: row.cache_read_tokens,
    messageCount: row.message_count,
    model: row.model,
    firstTs: row.first_ts,
    lastTs: row.last_ts,
  };
}

export interface ListSessionUsageOptions {
  /** Max rows (default 200 — a local single-user deck never needs more on screen). */
  limit?: number;
  /** Filter to one transcript-derived project label. */
  project?: string;
}

/** Sessions sorted by last activity, newest first (NULL last_ts sorts to the bottom). */
export function listSessionUsage(
  db: Database.Database,
  options: ListSessionUsageOptions = {},
): SessionUsageEntry[] {
  const limit = options.limit ?? 200;
  const rows = (
    options.project !== undefined
      ? db
          .prepare(
            `SELECT * FROM session_usage WHERE project = ?
             ORDER BY last_ts IS NULL, last_ts DESC, session_id LIMIT ?`,
          )
          .all(options.project, limit)
      : db
          .prepare(
            `SELECT * FROM session_usage
             ORDER BY last_ts IS NULL, last_ts DESC, session_id LIMIT ?`,
          )
          .all(limit)
  ) as SessionUsageRow[];
  return rows.map(toEntry);
}

export function getSessionUsage(
  db: Database.Database,
  sessionId: string,
): SessionUsageEntry | undefined {
  const row = db.prepare('SELECT * FROM session_usage WHERE session_id = ?').get(sessionId) as
    | SessionUsageRow
    | undefined;
  return row ? toEntry(row) : undefined;
}
