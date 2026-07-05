import type { FastifyInstance } from 'fastify';
import { diceCoefficient, tokenize } from '../../resolver.js';
import type { RepoRuntime } from '../server.js';

const DEFAULT_LIMIT = 20;

/** Fuzzy fallback floor -- same Dice-coefficient heuristic as `resolver.ts` step 4, but with the
 * wave-2 contract's own fixed threshold (0.4) rather than the resolver's stricter guess gate,
 * since a ranked search result list tolerates weaker matches than a single silent resolution. */
const FUZZY_MIN_SCORE = 0.4;

/** Fixed score tiers -- exact id always beats a title substring beats a heading substring beats a
 * path substring beats any fuzzy title match (wave-2 feature 4's stated rank order). Fuzzy scores
 * scale within their own tier so better token overlap still ranks higher among fuzzy hits. */
const SCORE_ID = 100;
const SCORE_TITLE = 90;
const SCORE_HEADING = 80;
const SCORE_PATH = 70;
const SCORE_FUZZY_MAX = 40;

export interface SearchResult {
  repoId: string;
  repoName: string;
  /** doc key (`id ?? path`, doc-lookup.ts convention). */
  docKey: string;
  path: string;
  title: string;
  matchKind: 'id' | 'title' | 'heading' | 'path';
  /** only for heading matches: the heading text that matched. */
  heading?: string;
  score: number;
}

/**
 * `GET /api/search?q=<text>&limit=20` (wave-2 feature 4) -- cross-repo doc search over ids,
 * titles, headings, and paths, all in-memory against each repo's current index snapshot.
 * Per doc: the best id/title/path match yields at most one row (dedupe keeping the best), while
 * heading matches may contribute up to 2 *extra* rows per doc (each tagged with the heading that
 * matched, so the UI can deep-link/preview meaningfully). Empty/whitespace queries return `[]`.
 */
export function registerSearchRoute(app: FastifyInstance, repos: RepoRuntime[]): void {
  app.get('/api/search', async (request) => {
    const { q, limit: limitRaw } = request.query as { q?: string; limit?: string };
    const query = (q ?? '').trim();
    if (query.length === 0) return [];

    const parsedLimit = limitRaw !== undefined ? Number(limitRaw) : DEFAULT_LIMIT;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : DEFAULT_LIMIT;

    const needle = query.toLowerCase();
    const queryTokens = tokenize(query);
    const results: SearchResult[] = [];

    for (const repo of repos) {
      const state = repo.getState();
      const docs: Array<{ id: string | null; path: string; title: string; headings: string[] }> = [
        ...Object.entries(state.index.docs).map(([id, doc]) => ({
          id,
          path: doc.path,
          title: doc.title,
          headings: doc.headings,
        })),
        ...state.index.unidentified.map((doc) => ({
          id: null,
          path: doc.path,
          title: doc.title,
          headings: doc.headings,
        })),
      ];

      for (const doc of docs) {
        const base = {
          repoId: repo.id,
          repoName: repo.name,
          docKey: doc.id ?? doc.path,
          path: doc.path,
          title: doc.title,
        };

        // Best single non-heading match for this doc (dedupe keeping the best).
        let primary: SearchResult | undefined;
        if (doc.id === query) {
          primary = { ...base, matchKind: 'id', score: SCORE_ID };
        } else if (doc.title.toLowerCase().includes(needle)) {
          primary = { ...base, matchKind: 'title', score: SCORE_TITLE };
        } else if (doc.path.toLowerCase().includes(needle)) {
          primary = { ...base, matchKind: 'path', score: SCORE_PATH };
        } else {
          const dice = diceCoefficient(queryTokens, tokenize(doc.title));
          if (dice >= FUZZY_MIN_SCORE) {
            primary = { ...base, matchKind: 'title', score: SCORE_FUZZY_MAX * dice };
          }
        }
        if (primary) results.push(primary);

        // Heading matches: up to 2 extra rows per doc, each carrying the matched heading.
        let headingRows = 0;
        for (const heading of doc.headings) {
          if (headingRows >= 2) break;
          if (!heading.toLowerCase().includes(needle)) continue;
          results.push({ ...base, matchKind: 'heading', heading, score: SCORE_HEADING });
          headingRows += 1;
        }
      }
    }

    results.sort(
      (a, b) =>
        b.score - a.score ||
        a.repoId.localeCompare(b.repoId) ||
        a.path.localeCompare(b.path) ||
        (a.heading ?? '').localeCompare(b.heading ?? ''),
    );
    return results.slice(0, limit);
  });
}
