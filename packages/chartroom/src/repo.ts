import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import ignoreModule, { type Ignore } from 'ignore';

// The `ignore` package is a plain CJS module whose default export type isn't reliably inferred as
// callable under NodeNext + esModuleInterop (its .d.ts's `export default` merges oddly with the
// namespace TS synthesizes for CJS interop). Cast once here rather than fight the upstream types.
const ignore = ignoreModule as unknown as (options?: { ignorecase?: boolean }) => Ignore;

/** Directory names always skipped during doc discovery, regardless of .gitignore contents. */
const BUILTIN_SKIP_DIRS = new Set(['.git', 'node_modules', '.turbo', 'dist', 'coverage', '.docs']);

export class NotAGitRepoError extends Error {
  constructor(cwd: string) {
    super(`not a git repository (or any parent up to filesystem root): ${cwd}`);
    this.name = 'NotAGitRepoError';
  }
}

/** Walk up from `cwd` until a directory containing `.git` is found. Throws NotAGitRepoError if none. */
export function findGitRoot(cwd: string = process.cwd()): string {
  let dir = cwd;
  while (true) {
    if (existsSync(join(dir, '.git'))) {
      return dir;
    }
    const parent = join(dir, '..');
    if (parent === dir) {
      throw new NotAGitRepoError(cwd);
    }
    dir = parent;
  }
}

/**
 * Normalize a CLI-supplied path argument to a repo-root-relative, forward-slash path.
 * Absolute paths are made relative to repoRoot; relative paths are assumed already
 * repo-root-relative (per plan §6.4 — the CLI does not do cwd-relative resolution).
 */
export function toRepoRelative(repoRoot: string, inputPath: string): string {
  const p = isAbsolute(inputPath) ? relative(repoRoot, inputPath) : inputPath;
  return normalizeSlashes(p);
}

export function normalizeSlashes(p: string): string {
  return p.split(sep).join('/');
}

/**
 * Load ignore rules for doc discovery: the repo's top-level `.gitignore` plus an optional
 * top-level `.chartroomignore` (same gitignore syntax, fed into the same matcher). The latter
 * scopes Chart Room's *doc discovery* without making git itself ignore anything -- for content
 * that is tracked in git but must never be treated as a managed doc (vendored apps, byte-exact
 * test fixtures, templates copied verbatim into other repos, ...).
 */
function loadIgnoreRules(repoRoot: string): Ignore {
  const ig = ignore();
  for (const name of ['.gitignore', '.chartroomignore']) {
    const p = join(repoRoot, name);
    if (existsSync(p)) {
      ig.add(readFileSync(p, 'utf8'));
    }
  }
  return ig;
}

/**
 * Discover all *.md files under repoRoot, skipping built-in noise directories and anything
 * matched by the repo's own top-level .gitignore or .chartroomignore. Returns repo-root-relative,
 * forward-slash paths.
 */
export function discoverDocFiles(repoRoot: string): string[] {
  const ig = loadIgnoreRules(repoRoot);
  const results: string[] = [];

  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = join(dir, entry);
      const rel = normalizeSlashes(relative(repoRoot, abs));
      if (rel && ig.ignores(rel)) continue;

      let st;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }

      if (st.isDirectory()) {
        if (BUILTIN_SKIP_DIRS.has(entry)) continue;
        walk(abs);
      } else if (st.isFile() && entry.toLowerCase().endsWith('.md')) {
        results.push(rel);
      }
    }
  }

  walk(repoRoot);
  return results.sort();
}
