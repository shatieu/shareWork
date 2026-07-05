// Pure-string reimplementation of chartroom's `link-paths.ts::computeExpectedHref`/`normalizeHref`
// (phase 1, unmodified) — deliberately duplicated rather than cross-package-imported, unlike
// `segmentBlocks.ts`'s `chartroom/markdown` import.
//
// Why the difference: `chartroom/markdown`'s `AstNode` is imported with `import type`, which is
// fully erased at build time — zero runtime code ends up in the browser bundle. `link-paths.ts`,
// by contrast, is a real value import (`computeExpectedHref` actually *runs* every time a Ctrl+K
// link is inserted) and its implementation uses `node:path`'s `posix` namespace internally.
// Verified empirically against the real `vite build` output: Vite/rolldown externalizes
// `node:path` for a browser bundle as an *empty stub object* (not a working polyfill), so
// `posix.dirname(...)` throws `TypeError: Cannot read properties of undefined (reading 'dirname')`
// the instant a real browser (no Node.js) actually executes that code path. This is a confirmed,
// not hypothetical, browser-runtime break — caught by actually building and inspecting the output
// during implementation, not assumed away. Duplicating the tiny (~20-line) relative-path logic
// here, using plain string operations with no `node:path` dependency at all, is the correct fix —
// same "duplicate small logic across the package boundary" precedent phase 2 already established,
// now with a concrete confirmed reason rather than just instinct.
//
// Both paths are always repo-root-relative, forward-slash-normalized strings (never real OS paths,
// never containing `.`/`..` segments) throughout this codebase, so this only needs to implement
// that specific, narrow case — not `path.posix`'s full generality.

function dirnameOf(relPath: string): string[] {
  const idx = relPath.lastIndexOf('/');
  if (idx === -1) return [];
  return relPath.slice(0, idx).split('/').filter((s) => s.length > 0);
}

/** Mirrors `link-paths.ts::normalizeHref`: strip a leading "./" and normalize backslashes. */
export function normalizeHref(href: string): string {
  const slashed = href.split('\\').join('/');
  return slashed.startsWith('./') ? slashed.slice(2) : slashed;
}

/**
 * Mirrors `link-paths.ts::computeExpectedHref` exactly (same inputs -> same output for every case
 * that function handles): the relative href a link inside `fromRelPath` should use to point at
 * `targetRelPath`, both repo-root-relative, forward-slash paths.
 */
export function computeExpectedHref(fromRelPath: string, targetRelPath: string): string {
  const fromParts = dirnameOf(fromRelPath);
  const targetParts = targetRelPath.split('/').filter((s) => s.length > 0);

  let common = 0;
  while (
    common < fromParts.length &&
    common < targetParts.length - 1 && // never treat the target's own filename as a shared dir
    fromParts[common] === targetParts[common]
  ) {
    common += 1;
  }

  const ups = fromParts.length - common;
  const downs = targetParts.slice(common);
  const relParts = [...Array<string>(ups).fill('..'), ...downs];
  return normalizeHref(relParts.length === 0 ? targetParts[targetParts.length - 1] : relParts.join('/'));
}
