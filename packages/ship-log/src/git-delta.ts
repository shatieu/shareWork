import { spawnSync } from 'node:child_process';

export interface CommitInfo {
  hash: string;
  subject: string;
}

export interface GitDelta {
  branch: string | null;
  commits: CommitInfo[];
  files: string[];
}

function runGit(repoRoot: string, args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    return { ok: false, stdout: '' };
  }
  return { ok: true, stdout: result.stdout ?? '' };
}

function splitLines(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Whether `repoRoot` is inside a git work tree at all -- unlike `rev-parse --abbrev-ref HEAD`,
 * this doesn't require a commit to exist yet, so it correctly distinguishes "not a repo" from
 * "empty repo" (a fresh `git init` with zero commits is a valid work tree). */
function isInsideWorkTree(repoRoot: string): boolean {
  const result = runGit(repoRoot, ['rev-parse', '--is-inside-work-tree']);
  return result.ok && result.stdout.trim() === 'true';
}

/** Current branch name via `symbolic-ref` (not `rev-parse --abbrev-ref HEAD`): this resolves
 * even in a brand-new empty repo (HEAD is a symbolic ref from `git init` onward, well before the
 * first commit) and correctly returns nothing for a detached HEAD (symbolic-ref fails there,
 * whereas `rev-parse --abbrev-ref HEAD` would return the literal string "HEAD"). */
function resolveBranch(repoRoot: string): string | null {
  const result = runGit(repoRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (!result.ok) return null; // detached HEAD, or otherwise unresolvable
  const branch = result.stdout.trim();
  return branch || null;
}

/**
 * Compute the git delta for a captured session (plan §3.6). Tolerant by design: not a git repo,
 * an empty repo, detached HEAD, or a missing `headStart` all degrade to a best-effort delta
 * rather than throwing -- a broken git state must never block a SessionEnd capture.
 */
export function computeDelta(
  repoRoot: string,
  headStart: string | null | undefined,
  startedAt?: string,
): GitDelta | null {
  if (!isInsideWorkTree(repoRoot)) {
    // Not a git repo (or git missing) -- no delta at all.
    return null;
  }
  const branch = resolveBranch(repoRoot);

  const commits: CommitInfo[] = [];
  if (headStart) {
    const range = `${headStart}..HEAD`;
    const logResult = runGit(repoRoot, ['log', `--format=%H%x09%s`, range]);
    if (logResult.ok) {
      for (const line of splitLines(logResult.stdout)) {
        const tabIndex = line.indexOf('\t');
        if (tabIndex === -1) continue;
        commits.push({ hash: line.slice(0, tabIndex), subject: line.slice(tabIndex + 1) });
      }
    }
  } else if (startedAt) {
    // Missing head_start (hooks installed mid-session / spool loss) -- fall back to time-boxed
    // history so a degraded capture still has something.
    const logResult = runGit(repoRoot, ['log', `--since=${startedAt}`, `--format=%H%x09%s`]);
    if (logResult.ok) {
      for (const line of splitLines(logResult.stdout)) {
        const tabIndex = line.indexOf('\t');
        if (tabIndex === -1) continue;
        commits.push({ hash: line.slice(0, tabIndex), subject: line.slice(tabIndex + 1) });
      }
    }
  }

  const filesSet = new Set<string>();
  if (headStart) {
    const diffResult = runGit(repoRoot, ['diff', '--name-only', `${headStart}..HEAD`]);
    if (diffResult.ok) {
      for (const f of splitLines(diffResult.stdout)) filesSet.add(f);
    }
  }
  const statusResult = runGit(repoRoot, ['status', '--porcelain']);
  if (statusResult.ok) {
    for (const line of splitLines(statusResult.stdout)) {
      // porcelain format: "XY path" (or "XY orig -> path" for renames) -- take the last token.
      const parts = line.split('->');
      const tail = parts[parts.length - 1].trim();
      const path = tail.replace(/^[ MADRCU?!]{1,2}\s+/, '').trim();
      if (path) filesSet.add(path);
    }
  }

  return { branch, commits, files: [...filesSet] };
}

/** `git rev-parse --show-toplevel` from a hook event's `cwd` (plan §3.6). Returns null when the
 * cwd isn't inside a git work tree. */
export function findRepoRoot(cwd: string): string | null {
  const result = runGit(cwd, ['rev-parse', '--show-toplevel']);
  if (!result.ok) return null;
  const path = result.stdout.trim();
  return path || null;
}

/** `git rev-parse HEAD` at capture start -- null for an empty repo (no commits yet) or a
 * non-repo. */
export function currentHead(repoRoot: string): string | null {
  const result = runGit(repoRoot, ['rev-parse', 'HEAD']);
  if (!result.ok) return null;
  const head = result.stdout.trim();
  return head || null;
}

/** Current branch at SessionStart time -- null for detached HEAD or a non-repo. See
 * `resolveBranch` above for why this uses `symbolic-ref`, not `rev-parse --abbrev-ref`. */
export function currentBranch(repoRoot: string): string | null {
  return resolveBranch(repoRoot);
}
