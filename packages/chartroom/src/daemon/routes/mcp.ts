import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { buildMcpServer } from '../../mcp/server.js';
import { createHttpRepoContext } from '../../mcp/repo-context.js';
import type { RepoRuntime } from '../server.js';

/**
 * `ALL /api/repos/:repoId/mcp` (plan §1.1/§2/§7): one `McpServer` + one `StreamableHTTPServerTransport`
 * per registered repo, built once at route-registration time -- the repo list is fixed for the
 * lifetime of a `chartroom serve` process (same assumption every other route already makes, plan
 * §5). **Stateless mode** (`sessionIdGenerator: undefined`, plan §1.1/§12 item 2): every one of the
 * five tools (mcp/tools.ts) is a pure, fast, idempotent read, so there is no server-initiated push
 * / resumable-stream need that would justify stateful session machinery -- matches this project's
 * standing "don't build machinery nothing asks for yet" discipline.
 *
 * Each tool call reads the repo's live, chokidar-kept-fresh `RepoState` via `createHttpRepoContext`
 * (repo-context.ts) -- there's no explicit rebuild step here, unlike `commands/mcp.ts`'s stdio path.
 *
 * **A new `McpServer` + `StreamableHTTPServerTransport` pair is built for every incoming request**,
 * not once per repo at route-registration time -- this was not the original design (an earlier
 * version built one long-lived pair per repo and reused it across requests), but the SDK's own
 * shipped stateless-mode example (`examples/server/simpleStatelessStreamableHttp.js`, read
 * directly from the installed package) does exactly this, and reusing a single transport instance
 * across multiple sequential requests was empirically confirmed (this session, via a real
 * `.listen()` + real SDK `Client`) to break on the second request -- a stateless transport's
 * internal request/response bookkeeping assumes one request per instance. Building fresh per
 * request is cheap here (tool logic is pure; `contextFactory` is just a closure over already-live
 * repo state), and both the server and transport are closed when the underlying response closes.
 *
 * `StreamableHTTPServerTransport.handleRequest` needs real Node `IncomingMessage`/`ServerResponse`
 * objects (confirmed by reading the SDK's own installed `.d.ts`, plan §1.1) -- Fastify's
 * `request.raw`/`reply.raw` *are* those objects (standard Fastify behavior), so this is a direct,
 * first-class SDK-supported bridge, not a hand-rolled JSON-RPC-over-HTTP reimplementation.
 * `reply.hijack()` tells Fastify to stop managing the response once handed off to the transport.
 *
 * No authentication (plan §9 risk #3) -- consistent with every prior phase's "loopback-only,
 * single-local-user, no accounts" posture; the daemon already binds `127.0.0.1` only.
 */
export function registerMcpRoute(app: FastifyInstance, repos: RepoRuntime[]): void {
  function findRepo(repoId: string): RepoRuntime | undefined {
    return repos.find((repo) => repo.id === repoId);
  }

  app.all('/api/repos/:repoId/mcp', async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const repo = findRepo(repoId);
    if (!repo) {
      return reply.code(404).send({ error: `unknown repo '${repoId}'` });
    }

    const server = buildMcpServer(() => createHttpRepoContext(repo));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  });
}
