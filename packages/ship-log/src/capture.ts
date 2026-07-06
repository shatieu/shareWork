import { basename } from 'node:path';
import type Database from 'better-sqlite3';
import {
  ensureSessionRow,
  findOrphanSessions,
  getSession,
  insertEntry,
  markCaptured,
  markSessionEnded,
  touchStop,
  upsertSessionStart,
  type SessionRow,
} from './db.js';
import { computeDelta, currentBranch, currentHead, findRepoRoot } from './git-delta.js';
import { readTranscriptTail } from './transcript.js';
import { fallbackSummary, type Summarizer } from './summarize.js';
import { writeFragment } from './fragments.js';

/** Minimal shape capture.ts needs out of an envelope -- decoupled from the zod-validated
 * `HookEventEnvelope` type so tests can hand-build fixtures without pulling in suite-conventions.
 */
export interface CaptureEnvelope {
  hook_event_name: string;
  session_id: string;
  cwd: string;
  transcript_path?: string;
  emitted_at: string;
  payload: Record<string, unknown>;
}

export interface CaptureContext {
  db: Database.Database;
  summarizer: Summarizer;
  now: () => Date;
  /** Fragment noise policy (DECISIONS-NEEDED "Package 4" #2 default): only write an in-repo
   * fragment when the session actually changed the repo. `'always'` is the documented
   * alternative, kept as a constructor knob rather than a hardcoded rule. */
  fragmentPolicy: 'changed-only' | 'always';
  /** Orphan-sweep threshold (plan §3.8 default: 2h). */
  orphanThresholdMs: number;
}

export function createCaptureContext(
  db: Database.Database,
  summarizer: Summarizer,
  overrides: Partial<Omit<CaptureContext, 'db' | 'summarizer'>> = {},
): CaptureContext {
  return {
    db,
    summarizer,
    now: overrides.now ?? (() => new Date()),
    fragmentPolicy: overrides.fragmentPolicy ?? 'changed-only',
    orphanThresholdMs: overrides.orphanThresholdMs ?? 2 * 60 * 60 * 1000,
  };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** SessionStart (plan §3.8): upsert the session row with repo context resolved once here
 * (repoRoot/branchStart/headStart) -- `Stop`/`SessionEnd` never re-resolve it. */
export function onSessionStart(ctx: CaptureContext, envelope: CaptureEnvelope): void {
  const repoRoot = findRepoRoot(envelope.cwd);
  const project = repoRoot ? basename(repoRoot) : basename(envelope.cwd) || null;
  const branchStart = repoRoot ? currentBranch(repoRoot) : null;
  const headStart = repoRoot ? currentHead(repoRoot) : null;

  upsertSessionStart(ctx.db, {
    sessionId: envelope.session_id,
    cwd: envelope.cwd,
    repoRoot,
    project,
    branchStart,
    headStart,
    transcriptPath: envelope.transcript_path ?? null,
    startedAt: envelope.emitted_at,
  });
}

/** Stop (plan §3.8): cheap checkpoint only -- last_stop_at + transcript path. No entry is ever
 * written here (an entry per turn would be noise; SessionEnd is the authoritative trigger). */
export function onStop(ctx: CaptureContext, envelope: CaptureEnvelope): void {
  const existing = getSession(ctx.db, envelope.session_id);
  if (!existing) {
    // Missing SessionStart (hooks installed mid-session) -- create a minimal degraded row so the
    // orphan sweep and eventual SessionEnd have something to work with.
    ensureSessionRow(ctx.db, {
      sessionId: envelope.session_id,
      cwd: envelope.cwd,
      transcriptPath: envelope.transcript_path ?? null,
      startedAt: envelope.emitted_at,
    });
  }
  touchStop(ctx.db, envelope.session_id, envelope.emitted_at, envelope.transcript_path);
}

/** SessionEnd (plan §3.8): mark ended, then capture (idempotent -- a captured session is a
 * no-op even if SessionEnd fires twice). */
export async function onSessionEnd(ctx: CaptureContext, envelope: CaptureEnvelope): Promise<void> {
  let session = getSession(ctx.db, envelope.session_id);
  if (!session) {
    // Missing SessionStart entirely -- degraded capture (plan §3.8 last paragraph).
    ensureSessionRow(ctx.db, {
      sessionId: envelope.session_id,
      cwd: envelope.cwd,
      transcriptPath: envelope.transcript_path ?? null,
      startedAt: envelope.emitted_at,
    });
    session = getSession(ctx.db, envelope.session_id);
  }
  if (!session) return; // should be unreachable; defensive

  const reason = typeof envelope.payload.reason === 'string' ? envelope.payload.reason : null;
  markSessionEnded(ctx.db, envelope.session_id, envelope.emitted_at, reason);

  if (session.captured) return; // idempotent: fragment/entry can never be double-written

  await captureSession(ctx, { ...session, ended_at: envelope.emitted_at, end_reason: reason });
}

/**
 * The actual capture work shared by SessionEnd and the orphan sweep: git delta, transcript tail,
 * summarize (with deterministic fallback), insert entry, write fragment (subject to the noise
 * policy), mark captured.
 */
export async function captureSession(
  ctx: CaptureContext,
  session: SessionRow,
  opts: { endReasonOverride?: string; partial?: boolean } = {},
): Promise<void> {
  const repoRoot = session.repo_root;
  const delta = repoRoot ? computeDelta(repoRoot, session.head_start, session.started_at) : null;
  const branch = delta?.branch ?? session.branch_start ?? null;
  const commits = delta?.commits ?? [];
  const files = delta?.files ?? [];

  const transcriptTail = readTranscriptTail(session.transcript_path);

  const summarizeInput = {
    project: session.project,
    branch,
    commits,
    files,
    transcriptTail,
  };

  let summaryText: string;
  let summaryModel: string | null;
  const summarized = await safeSummarize(ctx.summarizer, summarizeInput);
  if (summarized) {
    summaryText = summarized.text;
    summaryModel = summarized.model;
  } else {
    summaryText = fallbackSummary(summarizeInput);
    summaryModel = null;
  }

  const now = ctx.now();
  const date = isoDate(now);
  const partial = opts.partial ?? !session.branch_start;

  const hasDelta = commits.length > 0 || files.length > 0;
  let fragmentPath: string | null = null;
  if (repoRoot && (ctx.fragmentPolicy === 'always' || hasDelta)) {
    const result = writeFragment({
      repoRoot,
      date,
      sessionId: session.session_id,
      project: session.project,
      branch,
      summary: summaryText,
      commits,
      files,
      partial,
    });
    if (result.written) fragmentPath = result.path;
  }

  insertEntry(ctx.db, {
    sessionId: session.session_id,
    date,
    project: session.project,
    repoRoot,
    branch,
    commits,
    files,
    summary: summaryText,
    summaryModel,
    fragmentPath,
    createdAt: now.toISOString(),
    partial,
  });

  markCaptured(ctx.db, session.session_id);
}

async function safeSummarize(
  summarizer: Summarizer,
  input: Parameters<Summarizer>[0],
): ReturnType<Summarizer> {
  try {
    return await summarizer(input);
  } catch {
    return null;
  }
}

/** Orphan sweep (plan §3.8): sessions checkpointed more than `orphanThresholdMs` ago, never
 * captured -- captured with `end_reason='orphaned'`. Run at station start and before each rollup
 * build. */
export async function sweepOrphans(ctx: CaptureContext): Promise<number> {
  const nowIso = ctx.now().toISOString();
  const orphans = findOrphanSessions(ctx.db, nowIso, ctx.orphanThresholdMs);
  for (const session of orphans) {
    if (!session.ended_at) {
      markSessionEnded(ctx.db, session.session_id, nowIso, 'orphaned');
    }
    await captureSession(ctx, { ...session, end_reason: 'orphaned' });
  }
  return orphans.length;
}
