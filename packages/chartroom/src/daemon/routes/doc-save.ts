import { writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { rebuild } from '../repo-state.js';
import type { RepoRuntime } from '../server.js';

/** Generous default byte-size cap (plan §5.1 (c)) -- cheap defensive hygiene, not a real security
 * boundary (this is a local-only, loopback-bound daemon, spec §1's single-user framing). */
const MAX_BYTES = 10 * 1024 * 1024;

function findRepo(repos: RepoRuntime[], repoId: string): RepoRuntime | undefined {
  return repos.find((repo) => repo.id === repoId);
}

/**
 * `PUT /api/repos/:repoId/docs/:docId` (plan §5.1) -- the first daemon/UI-side code path in the
 * whole Chart Room project that writes to a `*.md` file (phase 1's CLI mutates files too, but
 * never the daemon). The client sends the already-reconstructed full file content (frontmatter +
 * spliced body, computed entirely client-side by `roundTrip.ts`); this route is a dumb, trusted
 * write of exactly those bytes, plus a few cheap safety checks -- it does not itself run any
 * block-diffing (plan §5.1: "the daemon does not run any block-diffing itself").
 *
 * After a successful write, immediately calls `rebuild()` (the same function the chokidar watcher
 * itself calls) and swaps this repo's in-memory state via `repo.setState` (plan §5.3) so the
 * response reflects fresh index/backlinks/check state synchronously, without waiting for the
 * watcher's own ~200ms debounce. The watcher fires too, redundantly -- a deliberate, accepted,
 * harmless no-op rebuild (plan §5.3), not suppressed.
 */
export function registerDocSaveRoute(app: FastifyInstance, repos: RepoRuntime[]): void {
  app.put('/api/repos/:repoId/docs/:docId', async (request, reply) => {
    const { repoId, docId } = request.params as { repoId: string; docId: string };
    const repo = findRepo(repos, repoId);
    if (!repo) {
      return reply.code(404).send({ error: `unknown repo '${repoId}'` });
    }

    const state = repo.getState();
    const doc = state.index.docs[docId];
    if (!doc) {
      return reply.code(404).send({ error: `unknown doc '${docId}' in repo '${repoId}'` });
    }

    const body = request.body as { raw?: unknown } | undefined;
    if (!body || typeof body.raw !== 'string') {
      return reply.code(400).send({ error: 'request body must be JSON { raw: string }' });
    }
    if (Buffer.byteLength(body.raw, 'utf8') > MAX_BYTES) {
      return reply.code(413).send({ error: `payload exceeds the ${MAX_BYTES}-byte safety cap` });
    }

    const repoAbsResolved = resolve(repo.absPath);
    const absPath = resolve(join(repoAbsResolved, doc.path));
    // Defensive traversal guard (plan §5.1 (b)) -- `doc.path` comes from the trusted in-memory
    // index (never user input directly), so this is a low-probability, belt-and-suspenders check,
    // included anyway per the project's general safety posture (mirrors @fastify/static's own
    // traversal guard already relied on for the raw-asset mount, phase 2).
    if (absPath !== repoAbsResolved && !absPath.startsWith(repoAbsResolved + sep)) {
      return reply.code(400).send({ error: 'resolved path escapes the repo root' });
    }

    writeFileSync(absPath, body.raw, 'utf8');

    const newState = rebuild(repo.absPath);
    repo.setState(newState);

    return { ok: true };
  });
}
