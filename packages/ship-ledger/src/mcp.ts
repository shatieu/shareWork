import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { DIFFICULTIES } from 'suite-conventions';
import {
  createItem,
  getItem,
  itemToJson,
  listItems,
  updateItem,
  LEDGER_PRIORITIES,
  LEDGER_SOURCES,
  LEDGER_STATUSES,
} from './db.js';

/**
 * The ledger's MCP surface (Ship_Spec §3: "exposed as an MCP server (agents read/write)").
 * Four tools -- create/get/list/update -- over the same SQLite store the HTTP station serves;
 * WAL keeps a stdio MCP process and a running hull consistent (ship-log's proven two-process
 * pattern). Deletion is deliberately absent: the ledger is an append-and-evolve record.
 *
 * Tool results are the item's canonical JSON (`itemToJson`) as text content -- identical shape
 * to the HTTP API so agents and UIs read one contract.
 */
export function createLedgerMcpServer(
  db: Database.Database,
  options: { now?: () => Date; version?: string } = {},
): McpServer {
  const now = options.now ?? (() => new Date());
  const server = new McpServer({ name: 'ship-ledger', version: options.version ?? '0.1.0' });

  const statusEnum = z.enum(LEDGER_STATUSES);
  const priorityEnum = z.enum(LEDGER_PRIORITIES);
  const difficultyEnum = z.enum(DIFFICULTIES);

  const asResult = (payload: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  });

  server.registerTool(
    'ledger_create',
    {
      title: 'Create a ledger item',
      description:
        "Add an item to the Ship's persistent cross-project ledger (~/.ship/ledger.db). " +
        'Use for work that must outlive this session. `source` defaults to "agent". ' +
        'Set `difficulty` (S/M/L/XL) and `remaining_guess_h` when you can estimate honestly.',
      inputSchema: {
        title: z.string().min(1).describe('Short imperative title, like a task card heading.'),
        spec_md: z.string().optional().describe('Markdown spec / acceptance notes.'),
        project: z.string().optional().describe('Project label (repo directory basename).'),
        status: statusEnum.optional().describe('Defaults to "open".'),
        priority: priorityEnum.optional().describe('Defaults to "normal".'),
        source: z.enum(LEDGER_SOURCES).optional().describe('Defaults to "agent".'),
        session_id: z.string().optional().describe('Originating Claude Code session id.'),
        difficulty: difficultyEnum.optional(),
        remaining_guess_h: z.number().nonnegative().optional()
          .describe('Honest remaining-hours guess -- never a promise.'),
      },
    },
    async (args) => {
      const row = createItem(
        db,
        {
          title: args.title,
          specMd: args.spec_md,
          project: args.project ?? null,
          status: args.status,
          priority: args.priority,
          source: args.source ?? 'agent',
          sessionRefs: args.session_id ? [args.session_id] : [],
          difficulty: args.difficulty ?? null,
          remainingGuessH: args.remaining_guess_h ?? null,
        },
        now().toISOString(),
      );
      return asResult(itemToJson(row));
    },
  );

  server.registerTool(
    'ledger_get',
    {
      title: 'Get a ledger item',
      description: 'Fetch one ledger item by id.',
      inputSchema: {
        id: z.string().describe('Item id (uuid).'),
      },
    },
    async (args) => {
      const row = getItem(db, args.id);
      if (!row) {
        throw new Error(`no ledger item with id '${args.id}'`);
      }
      return asResult(itemToJson(row));
    },
  );

  server.registerTool(
    'ledger_list',
    {
      title: 'List ledger items',
      description:
        'List ledger items across all projects, optionally filtered by project, status, or source.',
      inputSchema: {
        project: z.string().optional(),
        status: statusEnum.optional(),
        source: z.enum(LEDGER_SOURCES).optional(),
      },
    },
    async (args) => {
      const rows = listItems(db, {
        project: args.project,
        status: args.status,
        source: args.source,
      });
      return asResult(rows.map(itemToJson));
    },
  );

  server.registerTool(
    'ledger_update',
    {
      title: 'Update a ledger item',
      description:
        'Patch a ledger item: status (stage_progress recomputes deterministically), title, ' +
        'spec_md, priority, difficulty, remaining_guess_h; add_session_ref appends this ' +
        'session to the item\'s history. Native-mirror items may be annotated too -- the ' +
        'native task files themselves are never written back.',
      inputSchema: {
        id: z.string().describe('Item id (uuid).'),
        title: z.string().min(1).optional(),
        spec_md: z.string().optional(),
        project: z.string().optional(),
        status: statusEnum.optional(),
        priority: priorityEnum.optional(),
        difficulty: difficultyEnum.optional(),
        remaining_guess_h: z.number().nonnegative().optional(),
        add_session_ref: z.string().optional(),
      },
    },
    async (args) => {
      const row = updateItem(
        db,
        args.id,
        {
          title: args.title,
          specMd: args.spec_md,
          project: args.project,
          status: args.status,
          priority: args.priority,
          difficulty: args.difficulty,
          remainingGuessH: args.remaining_guess_h,
          addSessionRef: args.add_session_ref,
        },
        now().toISOString(),
      );
      if (!row) {
        throw new Error(`no ledger item with id '${args.id}'`);
      }
      return asResult(itemToJson(row));
    },
  );

  return server;
}
