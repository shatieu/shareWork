import type { FastifyInstance } from 'fastify';
import type { RepoRuntime } from '../server.js';

export interface InboxItem {
  repoId: string;
  repoName: string;
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
 * flat, cross-repo list. A **pure in-memory aggregation** over each repo's already-computed
 * `state.interactiveBlocks` (phase 4's `repo-state.ts::rebuild()` extension, plan §3.4) -- no
 * re-parsing on this read path at all.
 */
export function registerInboxRoute(app: FastifyInstance, repos: RepoRuntime[]): void {
  app.get('/api/inbox', async () => {
    const items: InboxItem[] = [];

    for (const repo of repos) {
      const state = repo.getState();
      for (const [docId, blocks] of Object.entries(state.interactiveBlocks)) {
        const doc = state.index.docs[docId];
        if (!doc) continue;

        for (const question of blocks.askMe) {
          if (question.answered) continue;
          items.push({
            repoId: repo.id,
            repoName: repo.name,
            docId,
            docPath: doc.path,
            kind: 'ask-me',
            directiveId: question.directiveId,
            label: question.prompt,
            type: question.type,
          });
        }

        for (const action of blocks.actions) {
          if (action.checked) continue;
          items.push({
            repoId: repo.id,
            repoName: repo.name,
            docId,
            docPath: doc.path,
            kind: 'actions',
            directiveId: action.directiveId,
            label: action.label,
          });
        }
      }
    }

    return items;
  });
}
