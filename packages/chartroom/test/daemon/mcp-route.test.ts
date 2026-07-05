// Plan §8.2/§9 risk #2: unlike every other daemon route test in this project (which uses
// Fastify's `.inject()`, never a real socket -- phase 2's own deliberate choice), this test needs a
// real `.listen({ port: 0 })` (OS-assigned ephemeral port) because `StreamableHTTPServerTransport`
// is built around real Node `IncomingMessage`/`ServerResponse` objects, not `.inject()`'s synthetic
// pair. A real `@modelcontextprotocol/sdk` `Client` drives an actual initialize -> tools/list ->
// tools/call round trip against the daemon's real HTTP MCP route -- this proves the actual wire
// protocol/route wiring works, not just that `tools.ts`'s plain functions return the right value.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { rebuild, type RepoState } from '../../src/daemon/repo-state.js';
import { buildServer, type RepoRuntime } from '../../src/daemon/server.js';

let repoRoot: string;
let app: FastifyInstance | undefined;
let client: Client | undefined;

function writeDoc(relPath: string, content: string): void {
  const abs = join(repoRoot, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function runtimeFor(id: string, initialState: RepoState): RepoRuntime {
  let state = initialState;
  return {
    id,
    name: id,
    absPath: repoRoot,
    getState: () => state,
    setState: (next) => {
      state = next;
    },
  };
}

async function connectClient(port: number, repoId: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/api/repos/${repoId}/mcp`));
  const c = new Client({ name: 'chartroom-test-client', version: '0.0.0' });
  await c.connect(transport);
  return c;
}

function parseToolResult(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  const content = result.content as Array<{ type: string; text?: string }> | undefined;
  const first = content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') {
    throw new Error(`unexpected tool result shape: ${JSON.stringify(result)}`);
  }
  return JSON.parse(first.text);
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-mcp-route-test-'));
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
});

afterEach(async () => {
  if (client) {
    await client.close().catch(() => undefined);
    client = undefined;
  }
  if (app) {
    await app.close();
    app = undefined;
  }
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('HTTP MCP route (real Client, real ephemeral socket)', () => {
  it('tools/list returns exactly the five expected tools with schemas', async () => {
    writeDoc('a.md', '---\nid: a\n---\n\n# A\n');
    const state = rebuild(repoRoot);
    app = buildServer([runtimeFor('repo-a', state)], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const port = Number(new URL(address).port);

    client = await connectClient(port, 'repo-a');
    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual([
      'answer_status',
      'list_unanswered_questions',
      'read_doc',
      'resolve',
      'search',
    ]);
    const resolveTool = tools.find((t) => t.name === 'resolve');
    expect(resolveTool?.inputSchema).toBeDefined();
  });

  it('tools/call resolve against a git-mv-ed doc returns the corrected path', async () => {
    writeDoc('old-name.md', '---\nid: my-doc\n---\n\n# My Doc\n');
    execFileSync('git', ['add', '.'], { cwd: repoRoot });
    execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-q', '-m', 'init'], { cwd: repoRoot });
    execFileSync('git', ['mv', 'old-name.md', 'new-name.md'], { cwd: repoRoot });

    const state = rebuild(repoRoot);
    app = buildServer([runtimeFor('repo-a', state)], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const port = Number(new URL(address).port);

    client = await connectClient(port, 'repo-a');
    const result = await client.callTool({ name: 'resolve', arguments: { query: 'my-doc' } });
    const parsed = parseToolResult(result) as { matchType: string; path?: string };

    expect(parsed.matchType).toBe('id');
    expect(parsed.path).toBe('new-name.md');
  });

  it('tools/call answer_status against an unanswered fixture question returns answered: false', async () => {
    writeDoc('a.md', '---\nid: a\n---\n\n:::ask-me{id="q1" type="yesno"}\nShip it?\n:::\n');
    const state = rebuild(repoRoot);
    app = buildServer([runtimeFor('repo-a', state)], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const port = Number(new URL(address).port);

    client = await connectClient(port, 'repo-a');
    const result = await client.callTool({ name: 'answer_status', arguments: { question_id: 'q1' } });
    const parsed = parseToolResult(result) as { matchType: string; answered?: boolean };

    expect(parsed.matchType).toBe('found');
    expect(parsed.answered).toBe(false);
  });

  it('an unknown repoId returns a 404, no MCP session established', async () => {
    const state = rebuild(repoRoot);
    app = buildServer([runtimeFor('repo-a', state)], { uiDistDir: join(repoRoot, 'no-such-ui-dist') });
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const port = Number(new URL(address).port);

    await expect(connectClient(port, 'no-such-repo')).rejects.toBeTruthy();
  });
});
