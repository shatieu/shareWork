import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { BrokenLinkIssue } from '../../check.js';
import type { DocEntry } from '../../index-schema.js';
import type { BacklinkEntry } from '../backlinks.js';
import { findDoc } from '../doc-lookup.js';
import type { RepoRuntime } from '../server.js';

export interface DocSummary {
  id: string | null;
  path: string;
  title: string;
}

/**
 * `BrokenLinkIssue` (check.ts, unmodified) plus `deletedAt`, looked up server-side from the same
 * repo's already-computed `index.deleted` map for `matchType === 'tombstone'` entries. `check.ts`'s
 * own shape doesn't carry `deletedAt` -- this is not new tombstone-*detection* logic (the value is
 * already sitting in `index.deleted[targetId].deletedAt`, computed by phase-1's `buildFreshIndex`
 * unmodified), just an API-response enrichment so the UI can render the spec's exact "gone since
 * <deletedAt>" tombstone wording (plan §6.6) without the client needing its own second lookup.
 */
export interface BrokenLinkIssueWithDeletedAt extends BrokenLinkIssue {
  deletedAt?: string;
}

export interface DocDetailResponse {
  /** frontmatter id, or null for an unidentified (id-less) doc -- v1.1 contract. */
  id: string | null;
  /** canonical doc key (`id ?? path`) -- what the UI should put in its own URLs. */
  key: string;
  doc: DocEntry;
  raw: string;
  backlinks: BacklinkEntry[];
  brokenLinks: BrokenLinkIssueWithDeletedAt[];
}

function findRepo(repos: RepoRuntime[], repoId: string): RepoRuntime | undefined {
  return repos.find((repo) => repo.id === repoId);
}

/**
 * `GET /api/repos/:repoId/docs` (list) and `GET /api/repos/:repoId/docs/:docId` (single doc: entry
 * + raw content + backlinks + brokenLinks filtered to that doc's path) -- plan §4.1. Since v1.1,
 * `:docId` is a doc *key* resolved via `doc-lookup.ts::findDoc` (exact id, then exact
 * repo-relative path), so id-less docs -- most of any real repo -- are addressable too; their
 * backlinks are `[]` by construction (backlinks are keyed by target id). `brokenLinks` is
 * `check.ts::runCheck().brokenLinks` filtered to `path === doc.path`; zero new tombstone
 * detection logic lives here, it only surfaces what phase-1's `check.ts` already computed (plus
 * the `deletedAt` enrichment described above).
 */
export function registerDocsRoutes(app: FastifyInstance, repos: RepoRuntime[]): void {
  app.get('/api/repos/:repoId/docs', async (request, reply) => {
    const { repoId } = request.params as { repoId: string };
    const repo = findRepo(repos, repoId);
    if (!repo) {
      return reply.code(404).send({ error: `unknown repo '${repoId}'` });
    }

    const state = repo.getState();
    const list: DocSummary[] = [
      ...Object.entries(state.index.docs).map(([id, doc]) => ({ id, path: doc.path, title: doc.title })),
      ...state.index.unidentified.map((doc) => ({ id: null, path: doc.path, title: doc.title })),
    ];
    return list;
  });

  app.get('/api/repos/:repoId/docs/:docId', async (request, reply) => {
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

    const raw = readFileSync(join(repo.absPath, found.entry.path), 'utf8');
    const backlinks = found.id ? (state.backlinks[found.id] ?? []) : [];
    const brokenLinks: BrokenLinkIssueWithDeletedAt[] = state.check.brokenLinks
      .filter((issue) => issue.path === found.entry.path)
      .map((issue) => ({
        ...issue,
        deletedAt: issue.matchType === 'tombstone' ? state.index.deleted[issue.targetId]?.deletedAt : undefined,
      }));

    const response: DocDetailResponse = {
      id: found.id,
      key: found.key,
      doc: found.entry,
      raw,
      backlinks,
      brokenLinks,
    };
    return response;
  });
}
