import { posix } from 'node:path';

/**
 * Strip a leading "./" and normalize backslashes to forward slashes, for tolerant href comparison
 * so a cosmetic difference (explicit "./" prefix) is never flagged as stale.
 */
export function normalizeHref(href: string): string {
  const slashed = href.split('\\').join('/');
  return slashed.startsWith('./') ? slashed.slice(2) : slashed;
}

/**
 * Compute the relative href that a link inside `fromRelPath` should use to point at
 * `targetRelPath` — both repo-root-relative, forward-slash paths. Mirrors how a markdown link's
 * path is written: relative to the *directory* of the linking file. Shared by the indexer
 * (computing `outbound[].stale`) and fix-links/the hook (computing the replacement href) — plan
 * §6.2 calls out this logic must be identical in both places.
 */
export function computeExpectedHref(fromRelPath: string, targetRelPath: string): string {
  const fromDir = posix.dirname(fromRelPath);
  const rel = posix.relative(fromDir, targetRelPath);
  return normalizeHref(rel);
}
