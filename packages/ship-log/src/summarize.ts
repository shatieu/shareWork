import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { CommitInfo } from './git-delta.js';

/** Injectable child-process runner (plan §5: "fake claude runner (injectable spawn)") -- tests
 * substitute a fake to assert success/timeout/non-zero-exit handling without ever spawning a
 * real `claude` process. */
export type ClaudeSpawn = (
  command: string,
  args: string[],
  options: { cwd: string; encoding: 'utf8'; timeout: number; env: NodeJS.ProcessEnv },
) => SpawnSyncReturns<string>;

export interface SummarizeInput {
  project: string | null;
  branch: string | null;
  commits: CommitInfo[];
  files: string[];
  transcriptTail: string;
}

export interface SummarizeResult {
  text: string;
  model: string;
}

/** Injected interface (plan §3.9) -- everything downstream (capture.ts, rollup) takes this in so
 * tests use a fake and production wires the default `claude -p` implementation. Returning `null`
 * means "no summary available"; the caller always has a deterministic fallback. */
export type Summarizer = (input: SummarizeInput) => Promise<SummarizeResult | null>;

/** Same-shape prompt input for the daily rollup (plan §3.9: "same interface with a different
 * prompt over the day's entries"). */
export interface RollupSummarizeInput {
  date: string;
  entries: Array<{ project: string | null; branch: string | null; summary: string }>;
}

export type RollupSummarizer = (input: RollupSummarizeInput) => Promise<SummarizeResult | null>;

const DEFAULT_MODEL = 'haiku';
const DEFAULT_TIMEOUT_MS = 60_000;
/** Prompt-text safety cap: the transcript tail is already size-capped at ~16 KB (transcript.ts),
 * but the prompt is passed as a single argv entry (verified working for `-p "<prompt>"` in
 * report 02 R4) -- trim further so the full command line comfortably stays under Windows'
 * ~32K CreateProcess limit even with a large tail. */
const MAX_TRANSCRIPT_CHARS_IN_PROMPT = 4000;

function buildEntryPrompt(input: SummarizeInput): string {
  const commitLines = input.commits.length
    ? input.commits.map((c) => `- ${c.subject}`).join('\n')
    : '(no commits)';
  const tail = input.transcriptTail.slice(-MAX_TRANSCRIPT_CHARS_IN_PROMPT);
  return [
    'Summarize this coding session in 1-3 plain sentences for a changelog. No preamble.',
    `Project: ${input.project ?? 'unknown'}`,
    `Branch: ${input.branch ?? 'unknown'}`,
    `Files touched: ${input.files.length}`,
    'Commits:',
    commitLines,
    'Recent transcript excerpt:',
    tail || '(none)',
  ].join('\n');
}

function buildRollupPrompt(input: RollupSummarizeInput): string {
  const lines = input.entries.map(
    (e, i) => `${i + 1}. [${e.project ?? 'unknown'}/${e.branch ?? '?'}] ${e.summary}`,
  );
  return [
    `Write a short daily digest (a few sentences, markdown ok) for ${input.date} covering all`,
    'projects worked on. No preamble, just the digest.',
    'Sessions:',
    ...lines,
  ].join('\n');
}

/**
 * Run `claude -p --model haiku` as a child process (plan §3.9 / DECISIONS-NEEDED "Package 4"
 * default). Neutral cwd (never the captured repo -- §8.1 loop guard: a project-scoped
 * `.claude/settings.json` hook install doesn't fire from a directory that isn't the project) and
 * the `SHIP_LOG_SUMMARIZER=1` env marker emit.mjs treats as "exit 0 immediately" (belt-and-braces
 * with the cwd guard). Hard 60 s timeout; any failure/timeout/non-zero exit/unparsable JSON
 * returns `null` -- capture.ts always has a deterministic fallback so an entry/fragment never
 * depends on network access or spend.
 */
function runClaude(
  prompt: string,
  timeoutMs: number,
  spawn: ClaudeSpawn = spawnSync,
): SummarizeResult | null {
  const result = spawn(
    'claude',
    [
      '-p',
      prompt,
      '--model',
      DEFAULT_MODEL,
      '--max-turns',
      '1',
      '--max-budget-usd',
      '0.05',
      '--output-format',
      'json',
    ],
    {
      cwd: tmpdir(),
      encoding: 'utf8',
      timeout: timeoutMs,
      // No --allowedTools restriction here: report 04-bridge-phase1-researcher.md R5 (the
      // "--tools ''" legality question) was never empirically verified, so this avoids leaning on
      // an unverified flag. The prompt itself asks only for a text summary and --max-turns 1
      // already caps agentic behavior to a single turn; the neutral tmpdir() cwd means there's no
      // project context/tools worth invoking anyway.
      env: { ...process.env, SHIP_LOG_SUMMARIZER: '1' },
    },
  );

  if (result.error || result.status !== 0 || !result.stdout) {
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout) as { result?: string; is_error?: boolean };
    if (parsed.is_error || typeof parsed.result !== 'string' || !parsed.result.trim()) {
      return null;
    }
    return { text: parsed.result.trim(), model: DEFAULT_MODEL };
  } catch {
    return null;
  }
}

/** Factory form (test seam): pass a fake `spawn` to exercise success/timeout/non-zero-exit
 * handling deterministically. Production code uses `defaultSummarizer`/`defaultRollupSummarizer`
 * below, which close over the real `node:child_process.spawnSync`. */
export function createClaudeSummarizer(spawn: ClaudeSpawn = spawnSync): Summarizer {
  return async (input) => runClaude(buildEntryPrompt(input), DEFAULT_TIMEOUT_MS, spawn);
}

export function createClaudeRollupSummarizer(spawn: ClaudeSpawn = spawnSync): RollupSummarizer {
  return async (input) => runClaude(buildRollupPrompt(input), DEFAULT_TIMEOUT_MS, spawn);
}

/** Acceptance-script seam (plan §6.1): with `SHIP_LOG_FAKE_SUMMARIZER=1` AND `NODE_ENV=test`,
 * the default summarizers return a deterministic fake instead of spawning `claude` -- this is
 * how `acceptance/two-repo-log.mjs` drives the REAL spawned `ship serve` bin without spending
 * tokens or depending on network/credits. Refused outside `NODE_ENV=test` (both conditions
 * checked at call time) so a production hull can never silently produce fake summaries. */
export function fakeSummarizerSeamActive(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SHIP_LOG_FAKE_SUMMARIZER === '1' && env.NODE_ENV === 'test';
}

const claudeSummarizer: Summarizer = createClaudeSummarizer();
const claudeRollupSummarizer: RollupSummarizer = createClaudeRollupSummarizer();

export const defaultSummarizer: Summarizer = async (input) => {
  if (fakeSummarizerSeamActive()) {
    return { text: `[fake-summary] ${fallbackSummary(input)}`, model: 'fake-test-seam' };
  }
  return claudeSummarizer(input);
};

export const defaultRollupSummarizer: RollupSummarizer = async (input) => {
  if (fakeSummarizerSeamActive()) {
    return { text: `[fake-rollup] ${fallbackRollupDigest(input)}`, model: 'fake-test-seam' };
  }
  return claudeRollupSummarizer(input);
};

/** Deterministic fallback used when the summarizer returns null (plan §3.9): commit subjects
 * joined + a file-count note -- capture always completes without network/credits. */
export function fallbackSummary(input: SummarizeInput): string {
  if (input.commits.length === 0 && input.files.length === 0) {
    return 'No repo changes recorded for this session.';
  }
  const subjects = input.commits.map((c) => c.subject).filter(Boolean);
  const commitPart = subjects.length ? subjects.join('; ') : 'No commits';
  return `${commitPart} (${input.files.length} file${input.files.length === 1 ? '' : 's'} touched).`;
}

export function fallbackRollupDigest(input: RollupSummarizeInput): string {
  if (input.entries.length === 0) return `No sessions recorded for ${input.date}.`;
  const lines = input.entries.map(
    (e) => `- **${e.project ?? 'unknown'}** (${e.branch ?? '?'}): ${e.summary}`,
  );
  return [`# ${input.date}`, '', ...lines].join('\n');
}
