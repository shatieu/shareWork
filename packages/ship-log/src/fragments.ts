import { existsSync, mkdirSync, openSync, closeSync, writeSync, constants } from 'node:fs';
import { join } from 'node:path';
import type { CommitInfo } from './git-delta.js';

const FRAGMENTS_RELDIR = join('changelog', 'entries');

/** Filename-safe slug from a branch name, falling back to the first words of the summary
 * (plan §3.10). Never empty -- falls back to 'session' as a last resort. */
export function slugify(source: string | undefined | null): string {
  if (!source) return 'session';
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'session';
}

export interface FragmentInput {
  repoRoot: string;
  date: string; // YYYY-MM-DD
  sessionId: string;
  project?: string | null;
  branch?: string | null;
  summary: string;
  commits: CommitInfo[];
  files: string[];
  partial?: boolean;
}

export interface FragmentResult {
  path: string;
  written: boolean; // false when the file already existed (create-only skip)
}

/**
 * Write a create-only changelog fragment (plan §3.10, towncrier/changesets pattern). Filename is
 * collision-free by construction: `<date>--<slug>--<session8>.md`. Uses the `wx` open flag so an
 * existing file is NEVER overwritten or edited -- if present, this is a no-op (logged by the
 * caller), matching the "fragments are append-only, never edited" invariant.
 */
export function writeFragment(input: FragmentInput): FragmentResult {
  const dir = join(input.repoRoot, FRAGMENTS_RELDIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const session8 = input.sessionId.slice(0, 8);
  const slugSource = input.branch && input.branch.length > 0 ? input.branch : input.summary;
  const slug = slugify(slugSource);
  const filename = `${input.date}--${slug}--${session8}.md`;
  const path = join(dir, filename);

  if (existsSync(path)) {
    return { path, written: false };
  }

  const body = renderFragment(input);

  let fd: number;
  try {
    // 'wx' = create-only, fails if the path already exists (race-safe against the existsSync
    // check above -- two racing captures for the same session id would still only let one win).
    fd = openSync(path, constants.O_CREAT | constants.O_WRONLY | constants.O_EXCL);
  } catch {
    return { path, written: false };
  }
  try {
    writeSync(fd, body, null, 'utf8');
  } finally {
    closeSync(fd);
  }
  return { path, written: true };
}

function renderFragment(input: FragmentInput): string {
  const session8 = input.sessionId.slice(0, 8);
  const frontmatterLines = [
    '---',
    `id: log-${session8}`,
    `date: ${input.date}`,
    `project: ${input.project ?? ''}`,
    `branch: ${input.branch ?? ''}`,
    `session: ${input.sessionId}`,
  ];
  if (input.partial) frontmatterLines.push('partial: true');
  frontmatterLines.push('---', '');

  const commitLines =
    input.commits.length > 0
      ? input.commits.map((c) => `- ${c.hash.slice(0, 8)} ${c.subject}`).join('\n')
      : '_No commits recorded for this session._';

  const body = [
    `# ${input.project ?? 'session'} — ${input.date}`,
    '',
    input.summary,
    '',
    '## Commits',
    '',
    commitLines,
    '',
    `## Files touched (${input.files.length})`,
    '',
  ].join('\n');

  return frontmatterLines.join('\n') + body + '\n';
}
