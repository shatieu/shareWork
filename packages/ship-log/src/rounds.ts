import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import type Database from 'better-sqlite3';
import { listEntries, listEntryDates, type EntryRow } from './db.js';
import type { RollupSummarizer, SummarizeResult } from './summarize.js';

/**
 * The chaplain's rounds (wave2-J): a machine-written daily digest of every captured session
 * across ALL projects, dropped where the chaplain's resurrection rite reads it --
 * `~/.ship/chaplain/rounds/<date>.md`. Built from the day's `entries` rows (whose per-session
 * haiku summaries capture already paid for); ONE further haiku call per rounds run for the lead
 * paragraph, with the same injected-summarizer/deterministic-fallback discipline as the rollup.
 */
export interface RoundsDeps {
  db: Database.Database;
  /** ONE model call per rounds run -- same `claude -p --model haiku` spawn as the daily rollup
   * (summarize.ts); `null`/throw falls back to a deterministic lead. */
  summarizer: RollupSummarizer;
  now: () => Date;
  /** Home-directory override -- tests never touch the real `~/.ship/chaplain`. */
  homeDir?: string;
}

export interface RoundsRunResult {
  date: string;
  /** Absolute path of the written `rounds/<date>.md`. */
  path: string;
  entryCount: number;
  projectCount: number;
  /** Digest model, or null when the deterministic fallback lead was used. */
  model: string | null;
}

export function chaplainRoundsDir(homeDir?: string): string {
  return join(homeDir ?? homedir(), '.ship', 'chaplain', 'rounds');
}

export function roundsFilePath(date: string, homeDir?: string): string {
  return join(chaplainRoundsDir(homeDir), `${date}.md`);
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Scratchpad/live-proof sessions pollute the registry (wave2-j findings, adjacent
 * discoveries) -- a repo_root under the OS temp dir is test debris, not the Captain's work,
 * so the rounds digest skips it. Entries with no repo_root at all (degraded captures) are kept:
 * a real session whose start was missed still belongs on the chaplain's rounds. */
function isTempRepo(repoRoot: string | null): boolean {
  if (!repoRoot) return false;
  const norm = resolve(repoRoot).toLowerCase();
  const tmp = resolve(tmpdir()).toLowerCase();
  return norm === tmp || norm.startsWith(tmp + sep);
}

/** Deterministic lead used when the summarizer yields nothing -- same posture as
 * `fallbackRollupDigest`: the rounds file never depends on network access or spend. */
export function fallbackRoundsLead(date: string, entryCount: number, projectCount: number): string {
  if (entryCount === 0) return `No sessions recorded for ${date}.`;
  const sessions = `${entryCount} session${entryCount === 1 ? '' : 's'}`;
  const projects = `${projectCount} project${projectCount === 1 ? '' : 's'}`;
  return `${sessions} across ${projects} on ${date}. No model digest (summarizer unavailable); per-project details below.`;
}

function parseJsonArray(json: string): unknown[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function composeRounds(
  date: string,
  groups: Map<string, EntryRow[]>,
  lead: string,
  model: string | null,
  generatedAtIso: string,
): string {
  const lines: string[] = [`# Rounds -- ${date}`, '', lead.trim(), ''];
  for (const [project, entries] of groups) {
    lines.push(`## ${project} (${entries.length} session${entries.length === 1 ? '' : 's'})`, '');
    for (const entry of entries) {
      const commits = parseJsonArray(entry.commits_json).length;
      const files = parseJsonArray(entry.files_json).length;
      const branch = entry.branch ?? '?';
      const counts = `${commits} commit${commits === 1 ? '' : 's'}, ${files} file${files === 1 ? '' : 's'}`;
      lines.push(`- [${branch}] ${entry.summary} (${counts})`);
    }
    lines.push('');
  }
  lines.push(
    '---',
    '',
    `_Machine-written by ship-log rounds at ${generatedAtIso}. Digest model: ${model ?? 'deterministic-fallback'}._`,
    '',
  );
  return lines.join('\n');
}

/**
 * Build (or rebuild -- an explicit run always overwrites) the rounds digest for one date and
 * write it atomically: tmp in the PARENT (chaplain) dir + rename, the chapel.ts confess
 * discipline -- a rounds/ reader never sees a half-written file.
 */
export async function buildRounds(deps: RoundsDeps, date: string): Promise<RoundsRunResult> {
  const entries = listEntries(deps.db, { date }).filter((entry) => !isTempRepo(entry.repo_root));

  const groups = new Map<string, EntryRow[]>();
  for (const entry of entries) {
    const project = entry.project ?? 'unknown';
    const group = groups.get(project);
    if (group) group.push(entry);
    else groups.set(project, [entry]);
  }

  let summarized: SummarizeResult | null = null;
  try {
    summarized = await deps.summarizer({
      date,
      entries: entries.map((e) => ({ project: e.project, branch: e.branch, summary: e.summary })),
    });
  } catch {
    summarized = null;
  }
  const lead = summarized ? summarized.text : fallbackRoundsLead(date, entries.length, groups.size);
  const model = summarized ? summarized.model : null;

  const dir = chaplainRoundsDir(deps.homeDir);
  mkdirSync(dir, { recursive: true });
  const target = roundsFilePath(date, deps.homeDir);
  const tmp = join(dirname(dir), `.rounds-${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
  writeFileSync(tmp, composeRounds(date, groups, lead, model, deps.now().toISOString()), 'utf8');
  renameSync(tmp, target);

  return { date, path: target, entryCount: entries.length, projectCount: groups.size, model };
}

/**
 * The lazy at-most-once-per-day trigger (wave2-J): builds the rounds file for every COMPLETED
 * day (`date < today`) that has entries but no `rounds/<date>.md` yet. The file's existence IS
 * the once-per-day marker -- no extra state, and a rebuilt/late day is impossible to double-run.
 * Today's (still-changing) rounds are only ever written by an explicit run (route/Deck button).
 */
export async function runPendingRounds(deps: RoundsDeps): Promise<RoundsRunResult[]> {
  const today = isoDate(deps.now());
  const built: RoundsRunResult[] = [];
  for (const date of listEntryDates(deps.db)) {
    if (date >= today) continue;
    if (existsSync(roundsFilePath(date, deps.homeDir))) continue;
    built.push(await buildRounds(deps, date));
  }
  return built;
}
