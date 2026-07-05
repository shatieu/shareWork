import { basename, isAbsolute, relative, sep } from 'node:path';

function normalizeSlashes(p: string): string {
  return p.split(sep).join('/');
}

/**
 * Derives the string to hand to `chartroom resolve` from a `Read` tool's own `tool_input.file_path`
 * (plan §1.4 step 2/§9.2's mandated pure, independently-testable function). Three cases:
 * - already relative -> returned as-is (slash-normalized), assumed already repo-relative.
 * - absolute and inside `repoRoot` -> made repo-relative.
 * - absolute and *outside* `repoRoot` entirely -> falls back to the bare basename, deliberately
 *   never emitting a `../../..`-shaped path-traversal string (a defensive floor, not an expected
 *   real-world case for a repo-scoped hook).
 *
 * Kept dependency-free (only `node:path`) and duplicated, in full, inside
 * `hook-template/chartroom-post-tool-use.mjs` (a standalone script with zero npm dependencies,
 * copied into a *different* repo's `.claude/hooks/` -- it cannot `import` this compiled package's
 * own dist output). The two copies must be kept in sync by hand; this file is the one covered by
 * `test/hooks/deriveResolveCandidate.test.ts`.
 */
export function deriveResolveCandidate(filePath: string, repoRoot: string): string {
  if (!isAbsolute(filePath)) {
    return normalizeSlashes(filePath);
  }
  const rel = relative(repoRoot, filePath);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return basename(filePath);
  }
  return normalizeSlashes(rel);
}
