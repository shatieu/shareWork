import { writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { rebuild } from '../repo-state.js';
import { findDoc } from '../doc-lookup.js';
import type { ActivityLog } from '../activity.js';
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
 * Since wave 2, `:docId` is a doc *key* (`id ?? path`, via `doc-lookup.ts::findDoc`), so id-less
 * docs are saveable too, and a successful save logs a 'save' activity event when the daemon runs
 * with an activity log (tests that build the server without one lose nothing but the feed entry).
 *
 * After a successful write, immediately calls `rebuild()` (the same function the chokidar watcher
 * itself calls) and swaps this repo's in-memory state via `repo.setState` (plan §5.3) so the
 * response reflects fresh index/backlinks/check state synchronously, without waiting for the
 * watcher's own ~200ms debounce. The watcher fires too, redundantly -- a deliberate, accepted,
 * harmless no-op rebuild (plan §5.3), not suppressed.
 */
export function registerDocSaveRoute(app: FastifyInstance, repos: RepoRuntime[], activity?: ActivityLog): void {
  app.put('/api/repos/:repoId/docs/:docId', async (request, reply) => {
    const { repoId, docId } = request.params as { repoId: string; docId: string };
    const repo = findRepo(repos, repoId);
    if (!repo) {
      return reply.code(404).send({ error: `unknown repo '${repoId}'` });
    }

    const state = repo.getState();
    const found = findDoc(state, docId);
    if (!found) {
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
    const absPath = resolve(join(repoAbsResolved, found.entry.path));
    // Defensive traversal guard (plan §5.1 (b)) -- `entry.path` comes from the trusted in-memory
    // index (never user input directly), so this is a low-probability, belt-and-suspenders check,
    // included anyway per the project's general safety posture (mirrors @fastify/static's own
    // traversal guard already relied on for the raw-asset mount, phase 2).
    if (absPath !== repoAbsResolved && !absPath.startsWith(repoAbsResolved + sep)) {
      return reply.code(400).send({ error: 'resolved path escapes the repo root' });
    }

    writeFileSync(absPath, body.raw, 'utf8');

    const newState = rebuild(repo.absPath);
    repo.setState(newState);

    activity?.log({
      ts: new Date().toISOString(),
      repoId: repo.id,
      repoName: repo.name,
      kind: 'save',
      summary: `${basename(found.entry.path)} edited`,
      docKey: found.key,
      path: found.entry.path,
    });

    return { ok: true };
  });
}
