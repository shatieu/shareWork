import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { computeExpectedHref } from '../../link-paths.js';
import { normalizeSlashes } from '../../repo.js';
import type { RepoRuntime } from '../server.js';

const MAX_BYTES = 10 * 1024 * 1024;

function findRepo(repos: RepoRuntime[], repoId: string): RepoRuntime | undefined {
  return repos.find((repo) => repo.id === repoId);
}

/**
 * `POST /api/repos/:repoId/docs/:docId/assets` (plan §6.1) -- accepts raw image bytes in the
 * request body (a plain binary POST, `Content-Type` identifying the image type; the client's
 * `uploadAsset` sends the pasted `Blob`'s own MIME type, `image/png` in the overwhelming common
 * clipboard-paste case). Writes them to `assets/<doc-id>/<timestamp>.png` -- repo-root-relative
 * (plan §6.1 step 2's reading of the spec's "configurable folder" wording), always named `.png`
 * per the spec's literal path shape regardless of the pasted image's actual byte format (no
 * transcoding library added for this -- the bytes are written verbatim under a `.png` name, matching
 * the plan's own "no new dependency needed" reasoning; a real re-encode would need an image
 * library not on the approved dependency list).
 *
 * This route's only job is: write bytes to disk, return the relative href the client should insert
 * (computed via phase-1's own `computeExpectedHref`, so the link is correct from the very first
 * paste). It does **not** touch `.docs/index.json` itself -- the very next doc save (§5.1, always
 * triggers a synchronous `rebuild()`) re-runs `collectAssets` and picks the new asset up
 * automatically, with zero new indexing logic here (plan §6.1 step 5).
 */
export function registerDocAssetsRoute(app: FastifyInstance, repos: RepoRuntime[]): void {
  // Fastify only auto-parses 'application/json'/'text/*' bodies by default -- register a raw-buffer
  // parser for the image content types this endpoint actually expects, so `request.body` is the
  // exact bytes posted, untouched.
  app.addContentTypeParser(
    ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/octet-stream'],
    { parseAs: 'buffer' },
    (_request, payload, done) => {
      done(null, payload);
    },
  );

  app.post('/api/repos/:repoId/docs/:docId/assets', async (request, reply) => {
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

    const bytes = request.body;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      return reply.code(400).send({ error: 'expected raw image bytes in the request body' });
    }
    if (bytes.length > MAX_BYTES) {
      return reply.code(413).send({ error: `payload exceeds the ${MAX_BYTES}-byte safety cap` });
    }

    const assetDirAbs = join(repo.absPath, 'assets', docId);
    mkdirSync(assetDirAbs, { recursive: true });
    const filename = `${Date.now()}.png`;
    const assetAbsPath = join(assetDirAbs, filename);
    writeFileSync(assetAbsPath, bytes);

    const assetRelPath = normalizeSlashes(relative(repo.absPath, assetAbsPath));
    const href = computeExpectedHref(doc.path, assetRelPath);

    return { href };
  });
}
