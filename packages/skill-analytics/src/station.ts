import { homedir } from 'node:os';
import type { FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import { DECK_CLIENT_HEADER, type HostContext, type StationDescriptor } from 'suite-conventions';
import { openSkillAnalyticsDb, skillAnalyticsDbPath } from './db.js';
import { collectTranscripts, type CollectResult } from './collect.js';
import { defaultClaudeProjectsDir } from './transcripts.js';
import { listInstalledSkills } from './installed.js';
import { getSessionUsage, listSessionUsage, type SessionUsageEntry } from './sessions.js';
import {
  buildSummary,
  findDeadSkills,
  knownProjectDirs,
  type ReportOptions,
  type Summary,
} from './report.js';

export interface SkillAnalyticsStationOptions {
  /** Home-directory override — tests never touch the real `~/.ship` / `~/.claude`. */
  homeDir?: string;
  /** Transcript root override (default `<home>/.claude/projects`). READ-ONLY. */
  claudeDir?: string;
  now?: () => Date;
}

export interface SkillAnalyticsStation extends StationDescriptor {
  /** Exposed for the standalone bin and tests — same handle the routes use. */
  readonly db: Database.Database;
  collect(): CollectResult;
}

/**
 * Skill analytics as a mounted Deck station (Trio_Specs §A; plan 11 §1). Deliberately **no
 * `tab`** — the console package (9) owns Deck tab routing; this station serves the JSON the
 * console renders (spec: "a JSON endpoint the Ship console renders as a dashboard panel") and
 * offers a `getSummary` in-process contract. The chartroom-ui `SkillAnalyticsPanel` component
 * is the ready-to-mount face of these routes.
 *
 * Privacy: reads local transcripts read-only, stores identifiers + token counts only, binds
 * under the hull (127.0.0.1-only), never uploads anything anywhere.
 */
export function createSkillAnalyticsStation(
  options: SkillAnalyticsStationOptions = {},
): SkillAnalyticsStation {
  const homeDir = options.homeDir ?? homedir();
  const claudeDir = options.claudeDir ?? defaultClaudeProjectsDir(homeDir);
  const now = options.now ?? (() => new Date());
  const db = openSkillAnalyticsDb(homeDir);

  const summary = (opts: ReportOptions & { deadDays?: number } = {}): Summary => {
    const installed = listInstalledSkills({ homeDir, projectDirs: knownProjectDirs(db) });
    return buildSummary(db, installed, { ...opts, now });
  };

  const intQuery = (value: string | undefined): number | undefined => {
    if (value === undefined) return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const station: SkillAnalyticsStation = {
    name: 'skill-analytics',
    db,

    collect() {
      return collectTranscripts(db, claudeDir);
    },

    registerRoutes(app: FastifyInstance, ctx: HostContext) {
      app.get<{ Querystring: { project?: string; days?: string; deadDays?: string } }>(
        '/api/skill-analytics/summary',
        async (request) =>
          summary({
            project: request.query.project,
            days: intQuery(request.query.days),
            deadDays: intQuery(request.query.deadDays),
          }),
      );

      app.get<{ Querystring: { project?: string; days?: string } }>(
        '/api/skill-analytics/skills',
        async (request) => {
          const s = summary({ project: request.query.project, days: intQuery(request.query.days) });
          return { skills: s.skills, agents: s.agents, generatedAt: s.generatedAt };
        },
      );

      app.get<{ Querystring: { days?: string } }>('/api/skill-analytics/dead', async (request) => {
        const installed = listInstalledSkills({ homeDir, projectDirs: knownProjectDirs(db) });
        return findDeadSkills(db, installed, { days: intQuery(request.query.days), now });
      });

      // Per-session token usage (wave2-I). Deck-header-gated: session ids + transcript paths
      // are more identifying than the aggregate summary, so only the Deck client reads them.
      // Watched state joins from ship-log's existing in-process contract when that station is
      // mounted; display names are NOT joined (ship-log offers no such contract today) — the
      // session id + transcript-derived project label is the honest identity here.
      const withWatched = (entries: SessionUsageEntry[]): SessionUsageEntry[] => {
        const listUnwatched = ctx.getContract<() => string[]>('ship-log', 'listUnwatchedSessionIds');
        if (!listUnwatched) return entries;
        try {
          const unwatched = new Set(listUnwatched());
          return entries.map((e) => ({ ...e, watched: !unwatched.has(e.sessionId) }));
        } catch {
          return entries;
        }
      };

      app.get<{ Querystring: { project?: string; limit?: string } }>(
        '/api/skill-analytics/sessions',
        async (request, reply) => {
          if (request.headers[DECK_CLIENT_HEADER] === undefined) {
            return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
          }
          const sessions = withWatched(
            listSessionUsage(db, {
              project: request.query.project,
              limit: intQuery(request.query.limit),
            }),
          );
          return { generatedAt: now().toISOString(), sessions };
        },
      );

      app.get<{ Params: { id: string } }>(
        '/api/skill-analytics/sessions/:id',
        async (request, reply) => {
          if (request.headers[DECK_CLIENT_HEADER] === undefined) {
            return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
          }
          const session = getSessionUsage(db, request.params.id);
          if (!session) return reply.code(404).send({ error: 'unknown session' });
          const [entry] = withWatched([session]);
          return entry;
        },
      );

      // Mutating route → Deck CSRF header required, same rail as every station's writes.
      app.post('/api/skill-analytics/collect', async (request, reply) => {
        if (request.headers[DECK_CLIENT_HEADER] === undefined) {
          return reply.code(403).send({ error: `missing ${DECK_CLIENT_HEADER} header` });
        }
        try {
          return station.collect();
        } catch (err) {
          ctx.log(`skill-analytics: collect failed: ${(err as Error).message}`);
          return reply.code(500).send({ error: 'collect failed' });
        }
      });

      app.get('/api/skill-analytics/health', async () => ({
        ok: true,
        dbPath: skillAnalyticsDbPath(homeDir),
        claudeDir,
      }));
    },

    start(ctx: HostContext) {
      // First collect can be a whole-history parse — run it off the boot path and log the
      // outcome; every later run is incremental and cheap.
      setImmediate(() => {
        try {
          const result = station.collect();
          ctx.log(
            `skill-analytics: collected ${result.newInvocations} new invocation(s) from ` +
              `${result.filesParsed}/${result.filesSeen} transcript(s)`,
          );
        } catch (err) {
          ctx.log(`skill-analytics: initial collect failed: ${(err as Error).message}`);
        }
      });
    },

    stop() {
      db.close();
    },

    contracts: {
      /** In-process contract for the console station: plain function, never the db. */
      getSummary: (opts?: ReportOptions & { deadDays?: number }) => summary(opts),
    },
  };

  return station;
}
