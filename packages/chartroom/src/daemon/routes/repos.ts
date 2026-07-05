import type { FastifyInstance } from 'fastify';
import { collectNeedsYou } from '../needs-you.js';
import type { RepoRuntime } from '../server.js';

export interface RepoSummary {
  id: string;
  name: string;
  absPath: string;
  /** identified + unidentified docs (wave-2 feature 3). */
  docCount: number;
  brokenLinkCount: number;
  /** unanswered `:::ask-me` + unchecked `:::actions` items -- same definition as `GET /api/inbox`
   * (both go through `needs-you.ts::collectNeedsYou`), just counted instead of listed. */
  needsYouCount: number;
}

/** `GET /api/repos` -> `[{id, name, absPath, docCount, brokenLinkCount, needsYouCount}]` for every
 * registered repo (plan §4.1, stats added in wave 2 feature 3). Pure in-memory reads over each
 * repo's current state snapshot -- no filesystem access on this path. */
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
        needsYouCount: collectNeedsYou(state).length,
      };
    });
  });
}
