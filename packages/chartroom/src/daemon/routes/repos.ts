import type { FastifyInstance } from 'fastify';
import type { RepoRuntime } from '../server.js';

export interface RepoSummary {
  id: string;
  name: string;
  absPath: string;
  /** identified + unidentified docs (Deck RepoTree badge data, plan 03 §3.1). */
  docCount: number;
  brokenLinkCount: number;
  /** Unanswered `:::ask-me` + unchecked `:::actions` items -- deliberately the same definition
   * as `GET /api/inbox` (both iterate `state.interactiveBlocks`), just counted instead of
   * listed, so the repo badge and the inbox can never disagree. NOTE: `interactiveBlocks` is
   * id-keyed today (identified docs only); the key-keyed rework that counts id-less docs too is
   * the parked v1.2 inbox-correctness slice, which upgrades both surfaces together. */
  needsYouCount: number;
}

function countNeedsYou(state: ReturnType<RepoRuntime['getState']>): number {
  let count = 0;
  for (const [docId, blocks] of Object.entries(state.interactiveBlocks)) {
    if (!state.index.docs[docId]) continue;
    for (const question of blocks.askMe) {
      if (!question.answered) count += 1;
    }
    for (const action of blocks.actions) {
      if (!action.checked) count += 1;
    }
  }
  return count;
}

/** `GET /api/repos` -> `[{id, name, absPath, docCount, brokenLinkCount, needsYouCount}]` for
 * every registered repo (plan §4.1; stats added for the Deck's RepoTree, plan 03 §4.6). Pure
 * in-memory reads over each repo's current state snapshot -- no filesystem access on this path. */
export function registerReposRoute(app: FastifyInstance, repos: RepoRuntime[]): void {
  app.get('/api/repos', async (): Promise<RepoSummary[]> => {
    return repos.map((repo) => {
      const state = repo.getState();
      return {
        id: repo.id,
        name: repo.name,
        absPath: repo.absPath,
        docCount: Object.keys(state.index.docs).length + state.index.unidentified.length,
        brokenLinkCount: state.check.brokenLinks.length,
        needsYouCount: countNeedsYou(state),
      };
    });
  });
}
