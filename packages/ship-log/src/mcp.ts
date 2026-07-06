import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { EntryRow, RollupRow, SessionRow } from './db.js';

/**
 * The changelog's read-only MCP surface (Ship_Spec §7: the Quartermaster "reads the ledger +
 * changelog + rollups (via MCP)"). Three tools -- entries/rollup/sessions -- over the same
 * SQLite store the HTTP station serves; WAL keeps a stdio MCP process and a running hull
 * consistent (the same two-process pattern ship-ledger's MCP proved in package 5).
 *
 * Deliberately READ-ONLY: writes happen exclusively through hook capture (§4 "zero human
 * discipline") -- an agent editing history would defeat the truth store. `log_rollup` returns
 * only STORED rollups and never builds one (building spends a summarizer call; a read surface
 * must be free). Building stays with `ship-log rollup` / `POST /api/ship-log/rollup/<date>`.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const dateArg = (what: string) =>
  z.string().regex(DATE_RE, 'YYYY-MM-DD').describe(`${what} (local date, YYYY-MM-DD).`);

/** Entries with commits/files decoded -- agents should never have to parse *_json columns. */
function entryToJson(row: EntryRow): Record<string, unknown> {
  return {
    id: row.id,
    session_id: row.session_id,
    date: row.date,
    project: row.project,
    repo_root: row.repo_root,
    branch: row.branch,
    commits: JSON.parse(row.commits_json) as unknown,
    files: JSON.parse(row.files_json) as unknown,
    summary: row.summary,
    summary_model: row.summary_model,
    fragment_path: row.fragment_path,
    created_at: row.created_at,
    partial: row.partial === 1,
  };
}

function sessionToJson(row: SessionRow): Record<string, unknown> {
  return { ...row, captured: row.captured === 1 };
}

function rollupToJson(row: RollupRow): Record<string, unknown> {
  return { ...row };
}

export interface QueryEntriesFilter {
  date?: string;
  since?: string;
  until?: string;
  project?: string;
  limit?: number;
}

/** Newest-first entry query with date-range filters -- the Quartermaster's "since last week"
 * shape. Kept beside the MCP server (rollup.ts's `listEntries` stays oldest-first/exact-date
 * for digest building). */
export function queryEntries(db: Database.Database, filter: QueryEntriesFilter = {}): EntryRow[] {
  const clauses: string[] = [];
  const params: Record<string, string | number> = {};
  if (filter.date) {
    clauses.push('date = @date');
    params.date = filter.date;
  }
  if (filter.since) {
    clauses.push('date >= @since');
    params.since = filter.since;
  }
  if (filter.until) {
    clauses.push('date <= @until');
    params.until = filter.until;
  }
  if (filter.project) {
    clauses.push('project = @project');
    params.project = filter.project;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(filter.limit ?? 50, 500));
  params.limit = limit;
  return db
    .prepare(`SELECT * FROM entries ${where} ORDER BY date DESC, created_at DESC LIMIT @limit`)
    .all(params) as EntryRow[];
}

export function listRecentSessions(
  db: Database.Database,
  filter: { project?: string; limit?: number } = {},
): SessionRow[] {
  const clauses: string[] = [];
  const params: Record<string, string | number> = {};
  if (filter.project) {
    clauses.push('project = @project');
    params.project = filter.project;
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(filter.limit ?? 20, 200));
  params.limit = limit;
  return db
    .prepare(`SELECT * FROM sessions ${where} ORDER BY started_at DESC LIMIT @limit`)
    .all(params) as SessionRow[];
}

export function listRollupDates(db: Database.Database): string[] {
  return (db.prepare('SELECT date FROM rollups ORDER BY date DESC').all() as { date: string }[])
    .map((r) => r.date);
}

export function createShipLogMcpServer(
  db: Database.Database,
  options: { version?: string } = {},
): McpServer {
  const server = new McpServer({ name: 'ship-log', version: options.version ?? '0.1.0' });

  const asResult = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  });

  server.registerTool(
    'log_entries',
    {
      title: 'List changelog entries',
      description:
        "Read the Ship's cross-project changelog (~/.ship/log.db): one entry per captured " +
        'session, newest first, with decoded commits/files and the session summary. Filter by ' +
        'exact `date` or a `since`/`until` range (YYYY-MM-DD) and/or `project` (repo directory ' +
        'basename). Read-only -- entries are written solely by hook capture.',
      inputSchema: {
        date: dateArg('Exact date').optional(),
        since: dateArg('Range start, inclusive').optional(),
        until: dateArg('Range end, inclusive').optional(),
        project: z.string().optional().describe('Project label (repo directory basename).'),
        limit: z.number().int().min(1).max(500).optional().describe('Default 50, newest first.'),
      },
    },
    async (args) =>
      asResult(
        queryEntries(db, {
          date: args.date,
          since: args.since,
          until: args.until,
          project: args.project,
          limit: args.limit,
        }).map(entryToJson),
      ),
  );

  server.registerTool(
    'log_rollup',
    {
      title: 'Get a stored daily rollup',
      description:
        'Fetch the STORED cross-project rollup digest for a date (YYYY-MM-DD). Never builds ' +
        'one -- if the date has no stored rollup the result lists the dates that do (build via ' +
        '`ship-log rollup --date <d>` or the hull HTTP API, then re-read).',
      inputSchema: {
        date: dateArg('Rollup date'),
      },
    },
    async (args) => {
      const row = db.prepare('SELECT * FROM rollups WHERE date = ?').get(args.date) as
        | RollupRow
        | undefined;
      if (!row) {
        return asResult({
          rollup: null,
          message: `no stored rollup for ${args.date}`,
          available_dates: listRollupDates(db),
        });
      }
      return asResult(rollupToJson(row));
    },
  );

  server.registerTool(
    'log_sessions',
    {
      title: 'List recent sessions',
      description:
        'List recently captured Claude Code sessions (newest first): cwd, project, branch, ' +
        'start/end times, end reason. Filter by `project`. Read-only.',
      inputSchema: {
        project: z.string().optional().describe('Project label (repo directory basename).'),
        limit: z.number().int().min(1).max(200).optional().describe('Default 20, newest first.'),
      },
    },
    async (args) =>
      asResult(listRecentSessions(db, { project: args.project, limit: args.limit }).map(sessionToJson)),
  );

  return server;
}
