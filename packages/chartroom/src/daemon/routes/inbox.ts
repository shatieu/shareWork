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
 * The pure cross-repo aggregation behind `GET /api/inbox` (plan §6.1) -- iterates every
 * registered `RepoRuntime` and collects every unanswered `:::ask-me` question and every
 * unchecked `:::actions` item into one flat list. A **pure in-memory aggregation** over each
 * repo's already-computed `state.interactiveBlocks` (phase 4's `repo-state.ts::rebuild()`
 * extension, plan §3.4) -- no re-parsing on this read path at all.
 *
 * Extracted (bridge phase 3, plan 06 §1.2) so the station can also offer it as the `listInbox`
 * in-process contract: ship-inbox's one-page aggregation pulls Chart Room questions through
 * `getContract('chartroom', 'listInbox')` instead of an HTTP round-trip to its own hull.
 */
export function collectInboxItems(repos: RepoRuntime[]): InboxItem[] {
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
}

/** `GET /api/inbox` -- the flat cross-repo list, served straight from {@link collectInboxItems}. */
export function registerInboxRoute(app: FastifyInstance, repos: RepoRuntime[]): void {
  app.get('/api/inbox', async () => collectInboxItems(repos));
}
