import type { FastifyInstance } from 'fastify';
import type { ActivityLog } from '../activity.js';

const DEFAULT_LIMIT = 50;

/**
 * `GET /api/activity?limit=50` (wave-2 feature 2) -- newest-first slice of the daemon's cross-repo
 * activity feed. The log itself lives in `activity.ts` (ring buffer + debounced persistence); this
 * route is a dumb read. A server built without an activity log (unit tests that don't care about
 * the feed) serves an empty list rather than a 404, so the UI can always poll this endpoint.
 */
export function registerActivityRoute(app: FastifyInstance, activity?: ActivityLog): void {
  app.get('/api/activity', async (request) => {
    const { limit: limitRaw } = request.query as { limit?: string };
    const parsed = limitRaw !== undefined ? Number(limitRaw) : DEFAULT_LIMIT;
    const limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_LIMIT;
    return activity?.list(limit) ?? [];
  });
}
