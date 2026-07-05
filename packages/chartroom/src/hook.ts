import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findGitRoot } from './repo.js';
import { buildFreshIndex, titleFor } from './indexer.js';
import { writeIndex } from './index-schema.js';
import { readFrontmatter, injectId } from './frontmatter.js';
import { generateId } from './id.js';
import { computeLinkFixes } from './fix-links.js';

// SHA1 hash of the empty git tree object -- a well-known constant, valid in every git repo,
// used as the diff base for the very first commit (before any HEAD exists). Plan §9.2 step 1's
// `git diff --cached ... -M` implicitly assumes a HEAD to diff against; this is the standard git
// idiom for handling the "first commit ever" edge case without special-casing the diff command.
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export interface PreCommitHookOptions {
  /** Repo root to operate in. Defaults to `findGitRoot(process.cwd())` -- overridable for tests
   * and the acceptance script, which run against disposable scratch repos. */
  repoRoot?: string;
}

export type FileAction = 'unchanged' | 'id-injected' | 'links-fixed' | 'id-injected-and-links-fixed';

export interface PreCommitHookFileResult {
  path: string;
  action: FileAction;
  /** true if the working tree had additional unstaged edits on top of this file's staged blob
   * (plan §9.2 step 3d) -- in that case only the index blob was updated, never the working tree. */
  partiallyStaged: boolean;
}

export interface PreCommitHookResult {
  ok: boolean;
  files: PreCommitHookFileResult[];
  /** human-readable notes to surface to the user (e.g. the partial-staging sync reminder). */
  notes: string[];
  /** set only when ok === false (a fatal, unrecoverable error -- not "found something to fix"). */
  error?: string;
}

function git(repoRoot: string, args: string[], input?: string): string {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    input,
    maxBuffer: 1024 * 1024 * 64,
  });
}

function hasHeadCommit(repoRoot: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], {
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

/** Plan §9.2 step 1: staged paths, added/copied/modified/renamed, rename-detected so a `git mv`
 * shows the new path directly -- filtered to `*.md` (step 2). */
function listStagedMarkdownFiles(repoRoot: string): string[] {
  const base = hasHeadCommit(repoRoot) ? 'HEAD' : EMPTY_TREE_SHA;
  const out = git(repoRoot, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-M', base]);
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.toLowerCase().endsWith('.md'))
    .map((line) => line.split('\\').join('/'));
}

/** The staged blob content for `relPath` -- exactly what's about to be committed, independent of
 * any unstaged edits sitting in the working tree on top of it (plan §9.2 step 3a). */
function readStagedBlob(repoRoot: string, relPath: string): string {
  return git(repoRoot, ['show', `:${relPath}`]);
}

/** True if the working tree has edits on top of the staged blob for `relPath` (partial staging). */
function hasUnstagedChanges(repoRoot: string, relPath: string): boolean {
  return git(repoRoot, ['diff', '--name-only', '--', relPath]).trim().length > 0;
}

/** Preserve the file's existing index mode (normally 100644) rather than hardcoding it. */
function currentIndexMode(repoRoot: string, relPath: string): string {
  const out = git(repoRoot, ['ls-files', '-s', '--', relPath]).trim();
  const mode = out.split(/\s+/)[0];
  return mode && /^[0-7]{6}$/.test(mode) ? mode : '100644';
}

/** Plan §9.2 step 3d: write the new content straight into the git object store and point the
 * index entry at it -- never touches the working tree file (callers decide that separately). */
function writeBlobAndUpdateIndex(repoRoot: string, relPath: string, content: string): void {
  const sha = git(repoRoot, ['hash-object', '-w', '--stdin'], content).trim();
  const mode = currentIndexMode(repoRoot, relPath);
  git(repoRoot, ['update-index', '--cacheinfo', mode, sha, relPath]);
}

interface ProcessResult {
  action: FileAction;
  partiallyStaged: boolean;
  note?: string;
}

/**
 * Process one staged markdown file (plan §9.2 step 3): inject a missing id, repair stale outbound
 * links, and write the result back as an index blob (and, if the file has no partial staging in
 * flight, back to the working tree too). Never touches any file other than `relPath`'s own blob /
 * working-tree copy.
 */
function processStagedFile(repoRoot: string, relPath: string, idsAssignedThisRun: Set<string>): ProcessResult {
  const originalStaged = readStagedBlob(repoRoot, relPath);
  // Captured *before* any mutation: whether this file has unstaged edits on top of what's staged
  // right now. This is the fact we must act on -- not whatever the diff looks like after we've
  // possibly rewritten the index blob below.
  const partiallyStaged = hasUnstagedChanges(repoRoot, relPath);

  // Rebuild a fresh index using the working tree for every *other* file, but this file's own
  // staged content for computing its outbound links / missing-id state (plan §9.2 step 3b).
  const overrides = new Map([[relPath, originalStaged]]);
  const { index, missingIdPaths } = buildFreshIndex(repoRoot, { contentOverrides: overrides });

  let content = originalStaged;
  let idInjected = false;
  if (missingIdPaths.includes(relPath)) {
    const fm = readFrontmatter(content);
    const base = titleFor(fm.data, content, relPath);
    const existingIds = new Set<string>([...Object.keys(index.docs), ...idsAssignedThisRun]);
    const newId = generateId(base, existingIds);
    content = injectId(content, newId);
    idsAssignedThisRun.add(newId);
    idInjected = true;
  }

  const fixResult = computeLinkFixes(relPath, content, index);
  const finalContent = fixResult.changed ? fixResult.newText : content;

  if (finalContent === originalStaged) {
    return { action: 'unchanged', partiallyStaged };
  }

  writeBlobAndUpdateIndex(repoRoot, relPath, finalContent);

  let note: string | undefined;
  if (partiallyStaged) {
    note =
      `chartroom: normalized staged content of ${relPath}; working tree has additional unstaged ` +
      `edits, run 'chartroom fix-links' after your next commit to sync.`;
  } else {
    writeFileSync(join(repoRoot, relPath), finalContent, 'utf8');
  }

  const action: FileAction = idInjected && fixResult.changed ? 'id-injected-and-links-fixed' : idInjected ? 'id-injected' : 'links-fixed';
  return { action, partiallyStaged, note };
}

/**
 * Core pre-commit hook logic (plan §9), safe to call in-process (never calls `process.exit`,
 * never creates a commit). Used directly by tests and the acceptance script; `runPreCommitHook`
 * below is the process-exiting wrapper the installed git hook shim actually calls.
 */
export function executePreCommitHook(options: PreCommitHookOptions = {}): PreCommitHookResult {
  let repoRoot: string;
  try {
    repoRoot = options.repoRoot ?? findGitRoot(process.cwd());
  } catch (err) {
    return { ok: false, files: [], notes: [], error: (err as Error).message };
  }

  let stagedMdFiles: string[];
  try {
    stagedMdFiles = listStagedMarkdownFiles(repoRoot);
  } catch (err) {
    return { ok: false, files: [], notes: [], error: `failed to list staged files: ${(err as Error).message}` };
  }

  const files: PreCommitHookFileResult[] = [];
  const notes: string[] = [];
  const idsAssignedThisRun = new Set<string>();

  for (const relPath of stagedMdFiles) {
    try {
      const result = processStagedFile(repoRoot, relPath, idsAssignedThisRun);
      files.push({ path: relPath, action: result.action, partiallyStaged: result.partiallyStaged });
      if (result.note) notes.push(result.note);
    } catch (err) {
      // A single file's plumbing failing (e.g. a race deleting it mid-run) must not abort the
      // whole hook or block the commit -- this is a repair pass, not a gate (plan §9.1/§9.2 step 5).
      notes.push(`chartroom: warning - failed to process staged file ${relPath}: ${(err as Error).message}`);
    }
  }

  // Plan §9.2 step 4: refresh .docs/index.json on disk (cache refresh only, not part of the commit).
  try {
    const { index } = buildFreshIndex(repoRoot);
    writeIndex(repoRoot, index);
  } catch (err) {
    notes.push(`chartroom: warning - failed to refresh .docs/index.json: ${(err as Error).message}`);
  }

  return { ok: true, files, notes };
}

/**
 * Process-exiting entrypoint, called by the installed `.git/hooks/pre-commit` shim (plan §9.4)
 * and by the CLI's hidden `hook-pre-commit` command. Always exits 0 on a normal run (this hook
 * only repairs, it never blocks a commit) and exits 1 only on an unrecoverable fatal error.
 */
export function runPreCommitHook(options: PreCommitHookOptions = {}): void {
  const result = executePreCommitHook(options);
  for (const note of result.notes) {
    console.log(note);
  }
  if (!result.ok) {
    console.error(`chartroom: pre-commit hook failed: ${result.error}`);
    process.exit(1);
    return;
  }
  process.exit(0);
}
