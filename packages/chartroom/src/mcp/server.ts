// Plan §2/§3.7: builds one `McpServer` instance's tool definitions, parameterized by a
// `ToolRepoContext` factory so the exact same registration code serves both `commands/mcp.ts`
// (stdio, single repo) and `daemon/routes/mcp.ts` (HTTP, per registered repo) -- see repo-context.ts
// for why the factory indirection (rather than a single fixed context) is needed: the stdio path
// wants a brand-new, freshly-rebuilt context per tool call, the HTTP path wants to read the
// daemon's already-live state on every call. `contextFactory()` is invoked once per tool
// invocation, inside each `registerTool` callback below.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { resolveTool, readDocTool, searchTool, listUnansweredQuestionsTool, answerStatusTool } from './tools.js';
import type { ToolRepoContext } from './repo-context.js';

const SERVER_NAME = 'chart-room';
const SERVER_VERSION = '0.1.0';

/** Every tool here is a pure, fast, idempotent read (or read-only status check) -- results are
 * returned as `content: [{ type: 'text', text: JSON.stringify(...) }]` (no `outputSchema`
 * registered, matching `team-tasks`'s own MCP server's `textResult` convention, §1.1) so an agent
 * gets the full structured JSON verbatim without this layer reshaping it. */
function textResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/**
 * Builds one `McpServer` with all five tools (plan §3), given a factory that produces a fresh
 * `ToolRepoContext` for each tool invocation. Callers (`commands/mcp.ts`, `daemon/routes/mcp.ts`)
 * are responsible for `.connect()`-ing this to a transport.
 */
export function buildMcpServer(contextFactory: () => ToolRepoContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    'resolve',
    {
      title: 'Resolve a doc id or path',
      description:
        "Resolve a Chart Room id, a path (possibly stale after a move/rename), or a filename against " +
        "this repo's live doc index. Returns one of: matchType 'id' (exact id match), 'path' (path as " +
        "written still exists), 'filename' (unique filename match elsewhere in the repo), 'fuzzy' " +
        "(a best-effort title guess, guess: true -- treat as a suggestion, not a certainty), " +
        "'tombstone' (the id/path used to exist but was deleted -- includes lastPath and deletedAt), " +
        "or 'not-found'. Call this whenever a doc Read fails or a link looks stale, instead of asking " +
        'a human where the file went.',
      inputSchema: {
        query: z.string().describe('an id, a repo-relative path, a bare filename, or free text to fuzzy-match against a doc title'),
      },
    },
    ({ query }) => textResult(resolveTool(contextFactory(), query)),
  );

  server.registerTool(
    'read_doc',
    {
      title: 'Read a doc by id',
      description:
        "Read a Chart-Room-managed doc by its id (from a prior resolve/search call, or a link's own " +
        "title=\"id:<id>\" attribute). Returns matchType 'found' (id, path, title, headings, raw text), " +
        "'tombstone' (this id used to exist -- lastPath, deletedAt), or 'not-found'. Prefer this over a " +
        'raw filesystem Read when you already have an id, since it never fails on a stale path.',
      inputSchema: { id: z.string().describe('a doc id, as returned by resolve/search or a link\'s title="id:..." attribute') },
    },
    ({ id }) => textResult(readDocTool(contextFactory(), id)),
  );

  server.registerTool(
    'search',
    {
      title: 'Search docs by title/heading',
      description:
        'Find the right doc by topic when you don\'t already know its id -- scores your query against ' +
        'each doc\'s title and headings (not full document bodies; use Grep for full-text search across ' +
        'file contents). Returns up to `limit` results as { id, path, title, score }, best first.',
      inputSchema: {
        query: z.string().describe('free-text topic/title to search for'),
        limit: z.number().int().positive().optional().describe('max results to return (default 10)'),
      },
    },
    ({ query, limit }) => textResult(searchTool(contextFactory(), query, limit)),
  );

  server.registerTool(
    'list_unanswered_questions',
    {
      title: 'List unanswered ask-me questions',
      description:
        'List every unanswered :::ask-me question across this repo\'s docs (not :::actions checklist ' +
        'items -- those have no per-item answer). Each entry is { docId, docPath, directiveId, prompt, ' +
        'type }. Use answer_status to check whether a specific one has since been answered by a human.',
      inputSchema: {},
    },
    () => textResult(listUnansweredQuestionsTool(contextFactory())),
  );

  server.registerTool(
    'answer_status',
    {
      title: 'Check an ask-me question\'s answer status',
      description:
        'Check whether a specific :::ask-me question (by its directiveId) has been answered by a ' +
        "human yet. Returns matchType 'found' ({ answered, answerText?, docId, docPath }), " +
        "'ambiguous' (2+ questions across this repo share this id -- disambiguate manually), or " +
        "'not-found'. There is no tool to submit an answer -- a human answers in the browser viewer.",
      inputSchema: { question_id: z.string().describe('the :::ask-me directive\'s own id attribute') },
    },
    ({ question_id }) => textResult(answerStatusTool(contextFactory(), question_id)),
  );

  return server;
}
