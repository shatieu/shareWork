import type { FastifyInstance } from 'fastify';

/**
 * The serve-command-owned callback that actually performs a live registration (find git root →
 * persist to `~/.chartroom/repos.json` → build state → push a RepoRuntime → start a watcher).
 * Injected as a seam so route tests never touch the real home
 * directory or spawn watchers. Returns the registered repo's identity; throws with a readable
 * message when the path has no git root.
 */
export type RepoRegistrar = (absPath: string) => Promise<{
  id: string;
  name: string;
  absPath: string;
  alreadyRegistered: boolean;
}>;

/**
 * `POST /api/repos/register` `{ path }` — live counterpart of the `chartroom register` CLI (v1.1) used by
 * `chartroom open` against an already-running daemon. Unlike the v1 design (static mounts fixed at boot), raw assets are now
 * served by a dynamic route over the shared runtimes array, so a repo registered here is browsable
 * immediately, no daemon restart.
 */
export function registerRepoRegisterRoute(app: FastifyInstance, registrar?: RepoRegistrar): void {
  app.post('/api/repos/register', async (request, reply) => {
    if (!registrar) {
      return reply.code(501).send({ error: 'live registration is not available in this server mode' });
    }
    const body = request.body as { path?: unknown } | null;
    const path = body && typeof body.path === 'string' ? body.path.trim() : '';
    if (!path) {
      return reply.code(400).send({ error: 'body must be { "path": "<absolute directory>" }' });
    }
    try {
      const result = await registrar(path);
      return result;
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
