// Plan §3.7: a small, local interface (`ToolRepoContext`) that `mcp/tools.ts`'s five functions are
// written against, rather than directly against either `RepoRuntime` (the daemon's own type) or a
// bespoke stdio-only rebuild function. This is the single design decision that keeps `tools.ts` a
// single, independently unit-testable module (fixture-driven tests against a hand-built
// `ToolRepoContext`, no daemon or git repo needed) rather than two parallel implementations that
// could silently drift.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rebuild, type RepoState } from '../daemon/repo-state.js';
import type { ChartRoomIndex } from '../index-schema.js';
import type { InteractiveBlocks } from '../interactive-blocks.js';

export interface ToolRepoContext {
  getIndex(): ChartRoomIndex;
  getInteractiveBlocks(): Record<string, InteractiveBlocks>;
  /** `path` is a repo-root-relative path, as found in `index.docs[id].path`. */
  readDocRaw(path: string): string;
}

/**
 * Stdio-transport context (plan §3.7): cwd-scoped, single repo, "always-fresh" rule -- `rebuild()`
 * (phase 4's own `daemon/repo-state.ts::rebuild`, unmodified, reused directly rather than
 * re-deriving a second index+interactive-blocks builder) runs at most once per context instance,
 * memoized for the lifetime of that instance. `commands/mcp.ts` constructs a brand-new context
 * per incoming tool call (never reuses one across calls), so this still satisfies "one fresh
 * rebuild per tool invocation" (plan §3.1) without redundantly rebuilding twice within the same
 * call if a tool happens to read both `getIndex()` and `getInteractiveBlocks()`.
 */
export function createStdioRepoContext(repoRoot: string): ToolRepoContext {
  let cached: RepoState | undefined;
  const getState = (): RepoState => {
    if (!cached) cached = rebuild(repoRoot);
    return cached;
  };
  return {
    getIndex: () => getState().index,
    getInteractiveBlocks: () => getState().interactiveBlocks,
    readDocRaw: (path: string) => readFileSync(join(repoRoot, path), 'utf8'),
  };
}

/** Minimal shape this needs from a `RepoRuntime` (daemon/server.ts) -- kept narrow rather than
 * importing the full `RepoRuntime` type, to avoid a needless import-cycle risk between `mcp/` and
 * `daemon/`. */
export interface HttpRepoContextSource {
  absPath: string;
  getState(): RepoState;
}

/**
 * HTTP-transport context (plan §3.7): reads the daemon's already-live, chokidar-kept-fresh
 * `RepoState` directly -- zero extra work, same reuse pattern every existing REST route
 * (`docs.ts`/`inbox.ts`) already established.
 */
export function createHttpRepoContext(source: HttpRepoContextSource): ToolRepoContext {
  return {
    getIndex: () => source.getState().index,
    getInteractiveBlocks: () => source.getState().interactiveBlocks,
    readDocRaw: (path: string) => readFileSync(join(source.absPath, path), 'utf8'),
  };
}
