import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import ignoreModule, { type Ignore } from 'ignore';
import type { ChartRoomIndex, DocEntry } from './index-schema.js';
import { computeBacklinks } from './daemon/backlinks.js';

// Same CJS-interop cast as repo.ts (see the comment there): the `ignore` package's default
// export isn't reliably callable under NodeNext without it.
const ignore = ignoreModule as unknown as (options?: { ignorecase?: boolean }) => Ignore;

const SECONDS_PER_DAY = 86_400;

/**
 * Injectable git seam: run `git <args>` in `repoRoot`, return stdout, throw on failure. Tests
 * inject a fake; production uses `defaultGitRunner` (execFileSync pattern per hook.ts).
 */
export type GitRunner = (repoRoot: string, args: string[]) => string;

export const defaultGitRunner: GitRunner = (repoRoot, args) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });

export interface StalenessSeams {
  git?: GitRunner;
}

export interface TtlExpiredIssue {
  /** null for unidentified docs (no `id:` frontmatter). */
  id: string | null;
  path: string;
  ttlDays: number;
  /** whole days since the doc's last change (floored). */
  ageDays: number;
}

export interface StaleAgainstSourcesIssue {
  /** null for unidentified docs (no `id:` frontmatter). */
  id: string | null;
  path: string;
  /** matched `sources:` files whose last change is newer than the doc's. */
  newerSources: string[];
}

export interface OrphanIssue {
  id: string;
  path: string;
}

export interface StalenessResult {
  ttlExpired: TtlExpiredIssue[];
  staleAgainstSources: StaleAgainstSourcesIssue[];
  orphans: OrphanIssue[];
}

/**
 * Unix epoch (seconds) of the last change to `relPath`: `git log -1 --format=%ct -- <path>`,
 * falling back to fs mtime ONLY when git has no commit for the path (untracked file) or git
 * itself fails. Documented v1 limitation: uncommitted edits to a *tracked* file don't move its
 * git timestamp — the mtime fallback never applies to committed paths. Returns undefined when
 * neither git nor the filesystem knows the path.
 */
export function lastChangeEpoch(repoRoot: string, relPath: string, git: GitRunner = defaultGitRunner): number | undefined {
  let out = '';
  try {
    out = git(repoRoot, ['log', '-1', '--format=%ct', '--', relPath]).trim();
  } catch {
    out = '';
  }
  if (out.length > 0) {
    const epoch = Number.parseInt(out, 10);
    if (Number.isFinite(epoch)) return epoch;
  }
  try {
    return Math.floor(statSync(join(repoRoot, relPath)).mtimeMs / 1000);
  } catch {
    return undefined;
  }
}

/** All git-tracked files (repo-relative, forward-slash, NUL-safe) — empty on git failure. */
export function listTrackedFiles(repoRoot: string, git: GitRunner = defaultGitRunner): string[] {
  try {
    return git(repoRoot, ['ls-files', '-z'])
      .split('\0')
      .filter((p) => p.length > 0);
  } catch {
    return [];
  }
}

/**
 * Filter a file list through gitignore-syntax `globs` (the already-shipped `ignore` package —
 * no new dependency). Note the gitignore semantics: a bare `package.json` matches at any depth;
 * anchor with a leading `/` for root-only.
 */
export function matchGlobs(files: string[], globs: string[]): string[] {
  const matcher = ignore().add(globs);
  return files.filter((p) => matcher.ignores(p));
}

/** `git ls-files` ∩ gitignore-syntax `globs` — the files a doc's `sources:` refers to. */
export function matchSources(repoRoot: string, globs: string[], git: GitRunner = defaultGitRunner): string[] {
  return matchGlobs(listTrackedFiles(repoRoot, git), globs);
}

/**
 * Pure staleness pass over an already-built index (spec §6, plan §4.A):
 * - `ttlExpired`: opted-in docs whose own last change is older than their `ttl_days`.
 * - `staleAgainstSources`: opted-in docs where a `sources:`-matched file changed after the doc.
 * - `orphans`: identified docs with zero inbound id-links, via the existing
 *   `daemon/backlinks.ts::computeBacklinks`. Unidentified docs are excluded by construction
 *   (they cannot receive id-links; listing them all would be noise, not signal).
 *
 * Perf bound: git subprocesses run only for opted-in docs (one `git log` per unique path
 * needing a timestamp, memoized; one `git ls-files` per run when any `sources:` is present).
 * Zero opt-ins → zero subprocesses, so the daemon-rebuild cost is unchanged.
 */
export function runStalenessCheck(
  repoRoot: string,
  index: ChartRoomIndex,
  nowEpoch: number,
  seams: StalenessSeams = {},
): StalenessResult {
  const git = seams.git ?? defaultGitRunner;

  const allDocs: Array<{ id: string | null; entry: DocEntry }> = [
    ...Object.entries(index.docs).map(([id, entry]) => ({ id: id as string | null, entry })),
    ...index.unidentified.map((entry) => ({ id: null, entry })),
  ];

  const epochCache = new Map<string, number | undefined>();
  const epochOf = (relPath: string): number | undefined => {
    if (!epochCache.has(relPath)) {
      epochCache.set(relPath, lastChangeEpoch(repoRoot, relPath, git));
    }
    return epochCache.get(relPath);
  };

  let trackedFiles: string[] | undefined; // lazy: `git ls-files` runs at most once per check
  const tracked = (): string[] => {
    if (trackedFiles === undefined) {
      trackedFiles = listTrackedFiles(repoRoot, git);
    }
    return trackedFiles;
  };

  const ttlExpired: TtlExpiredIssue[] = [];
  const staleAgainstSources: StaleAgainstSourcesIssue[] = [];

  for (const { id, entry } of allDocs) {
    const opts = entry.staleness;
    if (!opts) continue;
    const docEpoch = epochOf(entry.path);
    if (docEpoch === undefined) continue; // doc vanished mid-check — nothing sane to compare

    if (opts.ttlDays !== undefined) {
      const ageSeconds = nowEpoch - docEpoch;
      if (ageSeconds > opts.ttlDays * SECONDS_PER_DAY) {
        ttlExpired.push({
          id,
          path: entry.path,
          ttlDays: opts.ttlDays,
          ageDays: Math.floor(ageSeconds / SECONDS_PER_DAY),
        });
      }
    }

    if (opts.sources && opts.sources.length > 0) {
      const newerSources = matchGlobs(tracked(), opts.sources).filter((p) => {
        if (p === entry.path) return false; // a doc matching its own globs is never "newer than itself"
        const sourceEpoch = epochOf(p);
        return sourceEpoch !== undefined && sourceEpoch > docEpoch;
      });
      if (newerSources.length > 0) {
        staleAgainstSources.push({ id, path: entry.path, newerSources });
      }
    }
  }

  const backlinks = computeBacklinks(index);
  const orphans: OrphanIssue[] = Object.entries(index.docs)
    .filter(([id]) => (backlinks[id] ?? []).length === 0)
    .map(([id, entry]) => ({ id, path: entry.path }));

  return { ttlExpired, staleAgainstSources, orphans };
}
