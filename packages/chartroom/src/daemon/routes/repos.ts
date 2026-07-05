import type { FastifyInstance } from 'fastify';
import type { RepoRuntime } from '../server.js';

export interface RepoSummary {
  id: string;
  name: string;
  absPath: string;
}

/** `GET /api/repos` -> `[{id, name, absPath}]` for every registered repo (plan §4.1). */
export function registerReposRoute(app: FastifyInstance, repos: RepoRuntime[]): void {
  app.get('/api/repos', async (): Promise<RepoSummary[]> => {
    return repos.map((repo) => ({ id: repo.id, name: repo.name, absPath: repo.absPath }));
  });
}
