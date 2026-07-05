import { createReadStream, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { RepoRuntime } from '../server.js';

/** Small static mime map for the asset types markdown docs realistically embed. Anything else
 * streams as octet-stream, which the browser downloads rather than renders — acceptable for a
 * local tool, and it avoids a mime-db dependency. */
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

/**
 * `GET /api/repos/:repoId/raw/*` — dynamic raw-asset serving over the live runtimes array. This
 * replaces the original one-`@fastify/static`-mount-per-repo design *specifically so repos can be
 * registered while the daemon runs* (fastify cannot add routes after `.listen()`, so boot-fixed
 * mounts made live registration impossible). Same traversal safety property as the static mounts:
 * the resolved path must stay inside the repo root or the request 403s.
 */
export function registerRawRoute(app: FastifyInstance, repos: RepoRuntime[]): void {
  app.get('/api/repos/:repoId/raw/*', async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const rest = (request.params as Record<string, string>)['*'] ?? '';
    const repo = repos.find((r) => r.id === repoId);
    if (!repo) {
      return reply.code(404).send({ error: `unknown repo '${repoId}'` });
    }

    const repoRoot = resolve(repo.absPath);
    const abs = resolve(repoRoot, decodeURIComponent(rest));
    if (abs !== repoRoot && !abs.startsWith(repoRoot + sep)) {
      return reply.code(403).send({ error: 'path escapes repo root' });
    }

    let stats;
    try {
      stats = statSync(abs);
    } catch {
      return reply.code(404).send({ error: 'not found' });
    }
    if (!stats.isFile()) {
      return reply.code(404).send({ error: 'not found' });
    }

    reply.header('content-type', MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream');
    reply.header('content-length', stats.size);
    return reply.send(createReadStream(abs));
  });
}
