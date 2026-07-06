import type Database from 'better-sqlite3';
import type { InstalledSkill } from './installed.js';

/**
 * Aggregations over the invocations store (spec §A metrics v1): per-name trigger counts with
 * the proactive-vs-explicit split, attributed token totals, first/last seen, per-day trend,
 * and dead-skill detection against the installed census.
 *
 * Name-merge rule: a skill fired proactively lands as kind='skill' (Skill tool_use); the SAME
 * skill fired by the human as `/name` lands as kind='command'. Report rows therefore group by
 * NAME across the skill+command kinds — a name that only ever appears as a command (e.g.
 * `/model`) is still a legitimate slash-command row. Agents aggregate separately by
 * subagent_type.
 */
export interface ReportRow {
  name: string;
  category: 'skill' | 'agent';
  total: number;
  proactive: number;
  explicit: number;
  /** proactive / total — the "do the descriptions work" ratio; null when total is 0. */
  proactiveRatio: number | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
  firstSeen: string | null;
  lastSeen: string | null;
  projects: string[];
}

export interface TrendPoint {
  date: string;
  count: number;
}

export interface DeadSkill {
  name: string;
  scope: string;
  origin: string;
  lastSeen: string | null;
  daysSilent: number | null;
}

export interface ReportOptions {
  /** Restrict to one project label (basename of the session cwd). */
  project?: string;
  /** Only invocations from the last N days. */
  days?: number;
  now?: () => Date;
}

interface AggRow {
  name: string;
  kind: string;
  total: number;
  proactive: number;
  explicit: number;
  input_tokens: number;
  output_tokens: number;
  cache_create_tokens: number;
  cache_read_tokens: number;
  first_seen: string | null;
  last_seen: string | null;
  projects: string | null;
}

function sinceDate(days: number | undefined, now: () => Date): string | null {
  if (days === undefined) return null;
  const d = new Date(now().getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function buildRows(db: Database.Database, options: ReportOptions): ReportRow[] {
  const now = options.now ?? (() => new Date());
  const since = sinceDate(options.days, now);
  const agg = db
    .prepare(
      `SELECT name, kind,
              COUNT(*) AS total,
              SUM(CASE WHEN trigger_mode = 'proactive' THEN 1 ELSE 0 END) AS proactive,
              SUM(CASE WHEN trigger_mode = 'explicit' THEN 1 ELSE 0 END) AS explicit,
              SUM(input_tokens) AS input_tokens,
              SUM(output_tokens) AS output_tokens,
              SUM(cache_create_tokens) AS cache_create_tokens,
              SUM(cache_read_tokens) AS cache_read_tokens,
              MIN(ts) AS first_seen,
              MAX(ts) AS last_seen,
              GROUP_CONCAT(DISTINCT project) AS projects
       FROM invocations
       WHERE (@project IS NULL OR project = @project)
         AND (@since IS NULL OR date >= @since)
       GROUP BY name, kind`,
    )
    .all({ project: options.project ?? null, since }) as AggRow[];

  const byKey = new Map<string, ReportRow>();
  for (const row of agg) {
    const category: ReportRow['category'] = row.kind === 'agent' ? 'agent' : 'skill';
    const key = `${category}:${row.name}`;
    const existing = byKey.get(key) ?? {
      name: row.name,
      category,
      total: 0,
      proactive: 0,
      explicit: 0,
      proactiveRatio: null,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
      firstSeen: null,
      lastSeen: null,
      projects: [],
    };
    existing.total += row.total;
    existing.proactive += row.proactive;
    existing.explicit += row.explicit;
    existing.inputTokens += row.input_tokens;
    existing.outputTokens += row.output_tokens;
    existing.cacheCreateTokens += row.cache_create_tokens;
    existing.cacheReadTokens += row.cache_read_tokens;
    if (row.first_seen && (!existing.firstSeen || row.first_seen < existing.firstSeen)) {
      existing.firstSeen = row.first_seen;
    }
    if (row.last_seen && (!existing.lastSeen || row.last_seen > existing.lastSeen)) {
      existing.lastSeen = row.last_seen;
    }
    for (const project of (row.projects ?? '').split(',')) {
      if (project && !existing.projects.includes(project)) existing.projects.push(project);
    }
    byKey.set(key, existing);
  }

  const rows = [...byKey.values()];
  for (const row of rows) {
    row.proactiveRatio = row.total > 0 ? row.proactive / row.total : null;
    row.projects.sort();
  }
  rows.sort((a, b) => b.total - a.total || (a.name < b.name ? -1 : 1));
  return rows;
}

export function buildTrend(db: Database.Database, options: ReportOptions = {}): TrendPoint[] {
  const now = options.now ?? (() => new Date());
  const since = sinceDate(options.days, now);
  return db
    .prepare(
      `SELECT date, COUNT(*) AS count FROM invocations
       WHERE date IS NOT NULL
         AND (@project IS NULL OR project = @project)
         AND (@since IS NULL OR date >= @since)
       GROUP BY date ORDER BY date`,
    )
    .all({ project: options.project ?? null, since }) as TrendPoint[];
}

/** Distinct session cwds seen in the store — feeds the project-scope installed-skill scan. */
export function knownProjectDirs(db: Database.Database): string[] {
  const rows = db
    .prepare('SELECT DISTINCT cwd FROM invocations WHERE cwd IS NOT NULL ORDER BY cwd')
    .all() as { cwd: string }[];
  return rows.map((r) => r.cwd);
}

export function findDeadSkills(
  db: Database.Database,
  installed: readonly InstalledSkill[],
  options: { days?: number; now?: () => Date } = {},
): DeadSkill[] {
  const days = options.days ?? 30;
  const now = options.now ?? (() => new Date());
  const lastSeenStmt = db.prepare(
    `SELECT MAX(ts) AS last_seen FROM invocations
     WHERE kind IN ('skill', 'command') AND name IN (SELECT value FROM json_each(?))`,
  );

  const dead: DeadSkill[] = [];
  for (const skill of installed) {
    const row = lastSeenStmt.get(JSON.stringify(skill.aliases)) as { last_seen: string | null };
    const lastSeen = row.last_seen;
    if (lastSeen === null) {
      dead.push({ name: skill.name, scope: skill.scope, origin: skill.origin, lastSeen: null, daysSilent: null });
      continue;
    }
    const silentMs = now().getTime() - new Date(lastSeen).getTime();
    const daysSilent = Math.floor(silentMs / (24 * 60 * 60 * 1000));
    if (daysSilent >= days) {
      dead.push({ name: skill.name, scope: skill.scope, origin: skill.origin, lastSeen, daysSilent });
    }
  }
  dead.sort((a, b) => (b.daysSilent ?? Number.MAX_SAFE_INTEGER) - (a.daysSilent ?? Number.MAX_SAFE_INTEGER));
  return dead;
}

export interface Summary {
  generatedAt: string;
  options: { project: string | null; days: number | null; deadDays: number };
  totals: { invocations: number; skills: number; agents: number };
  skills: ReportRow[];
  agents: ReportRow[];
  trend: TrendPoint[];
  deadSkills: DeadSkill[];
}

/** The one payload shape shared by the CLI's --json output and the station's
 * `/api/skill-analytics/summary` endpoint (spec §A output). */
export function buildSummary(
  db: Database.Database,
  installed: readonly InstalledSkill[],
  options: ReportOptions & { deadDays?: number } = {},
): Summary {
  const now = options.now ?? (() => new Date());
  const rows = buildRows(db, options);
  const skills = rows.filter((r) => r.category === 'skill');
  const agents = rows.filter((r) => r.category === 'agent');
  const deadDays = options.deadDays ?? 30;
  return {
    generatedAt: now().toISOString(),
    options: { project: options.project ?? null, days: options.days ?? null, deadDays },
    totals: {
      invocations: rows.reduce((sum, r) => sum + r.total, 0),
      skills: skills.length,
      agents: agents.length,
    },
    skills,
    agents,
    trend: buildTrend(db, options),
    deadSkills: findDeadSkills(db, installed, { days: deadDays, now }),
  };
}
