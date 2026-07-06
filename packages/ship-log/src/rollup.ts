import type Database from 'better-sqlite3';
import { getRollup, listEntries, upsertRollup, type RollupRow } from './db.js';
import { fallbackRollupDigest, type RollupSummarizer } from './summarize.js';

export interface BuildRollupOptions {
  db: Database.Database;
  date: string;
  summarizer: RollupSummarizer;
  now: () => Date;
}

/** Build (or rebuild) the daily rollup (plan §3.9): one Haiku call over the day's entries across
 * ALL projects -- same injected-summarizer/deterministic-fallback discipline as entry capture. */
export async function buildRollup(opts: BuildRollupOptions): Promise<RollupRow> {
  const entries = listEntries(opts.db, { date: opts.date });
  const summarizeInput = {
    date: opts.date,
    entries: entries.map((e) => ({ project: e.project, branch: e.branch, summary: e.summary })),
  };

  let digest: string;
  let model: string | null;
  let summarized: Awaited<ReturnType<RollupSummarizer>> = null;
  try {
    summarized = await opts.summarizer(summarizeInput);
  } catch {
    summarized = null;
  }
  if (summarized) {
    digest = summarized.text;
    model = summarized.model;
  } else {
    digest = fallbackRollupDigest(summarizeInput);
    model = null;
  }

  const row: RollupRow = {
    date: opts.date,
    digest_md: digest,
    model,
    entry_count: entries.length,
    created_at: opts.now().toISOString(),
  };
  upsertRollup(opts.db, row);
  return row;
}

export function getStoredRollup(db: Database.Database, date: string): RollupRow | undefined {
  return getRollup(db, date);
}
