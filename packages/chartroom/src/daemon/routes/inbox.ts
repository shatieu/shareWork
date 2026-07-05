import type { FastifyInstance } from 'fastify';
import { collectNeedsYou } from '../needs-you.js';
import type { RepoRuntime } from '../server.js';

export interface InboxItem {
  repoId: string;
  repoName: string;
  /** doc key (`id ?? path`, doc-lookup.ts convention, wave 2) -- field name kept as `docId` for
   * backward compatibility with the phase-4 API shape the UI already consumes. */
  docId: string;
  docPath: string;
  kind: 'ask-me' | 'actions';
  directiveId: string;
  label: string;
  /** ask-me only. */
  type?: string;
}

/**
 * `GET /api/inbox` (plan §6.1) -- iterates every registered `RepoRuntime` and aggregates every
 * unanswered `:::ask-me` question and every unchecked `:::actions` item across all of them into one
 * flat, cross-repo list. The per-repo extraction lives in `needs-you.ts::collectNeedsYou` (wave 2,
 * shared with `routes/repos.ts`'s `needsYouCount` stat so the two can never disagree) -- still a
 * **pure in-memory aggregation** over each repo's already-computed `state.interactiveBlocks`, no
 * re-parsing on this read path at all.
 */
export function registerInboxRoute(app: FastifyInstance, repos: RepoRuntime[]): void {
  app.get('/api/inbox', async () => {
    const items: InboxItem[] = [];

    for (const repo of repos) {
      for (const item of collectNeedsYou(repo.getState())) {
        items.push({
          repoId: repo.id,
          repoName: repo.name,
          docId: item.docKey,
          docPath: item.docPath,
          kind: item.kind,
          directiveId: item.directiveId,
          label: item.label,
          ...(item.type !== undefined ? { type: item.type } : {}),
        });
      }
    }

    return items;
  });
}
