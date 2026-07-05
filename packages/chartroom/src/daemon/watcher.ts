import { watch, type FSWatcher } from 'chokidar';
import { rebuild, type RepoState } from './repo-state.js';

const DEBOUNCE_MS = 200;

/**
 * Directory names always skipped by the chokidar watcher, regardless of .gitignore contents.
 * Deliberately a small, standalone duplicate of phase-1's `repo.ts::BUILTIN_SKIP_DIRS` (a private,
 * unexported module-level constant) rather than adding an `export` keyword to a phase-1 file
 * (plan §1.2). This list only needs to be a cheap over-approximation -- the real source of truth
 * for "what counts as a doc" is `buildFreshIndex`'s own fully .gitignore-aware
 * `discoverDocFiles` call, re-run on every settle regardless of what chokidar fired on.
 */
const IGNORED_DIR_NAMES = new Set(['.git', 'node_modules', '.turbo', 'dist', 'coverage', '.docs']);

function isIgnoredPath(path: string): boolean {
  const segments = path.split(/[\\/]/);
  return segments.some((segment) => IGNORED_DIR_NAMES.has(segment));
}

export interface WatchedRepo {
  repoId: string;
  repoRoot: string;
  watcher: FSWatcher;
}

export type RebuildListener = (repoId: string, state: RepoState) => void;

/**
 * Start one chokidar watcher for a single registered repo root (plan §4.2: one watcher per repo,
 * never a single global watcher, so one repo's churn never triggers rebuilds in another). Any
 * add/change/unlink/addDir/unlinkDir event is collected behind a hand-rolled ~200ms debounce
 * (plain setTimeout, no new dependency) before triggering exactly one rebuild.
 */
export function startWatcher(repoId: string, repoRoot: string, onRebuild: RebuildListener): WatchedRepo {
  let timer: ReturnType<typeof setTimeout> | undefined;

  function scheduleRebuild(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const state = rebuild(repoRoot);
      onRebuild(repoId, state);
    }, DEBOUNCE_MS);
  }

  const watcher = watch(repoRoot, {
    ignored: (path: string) => isIgnoredPath(path),
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100 },
  });

  watcher.on('add', scheduleRebuild);
  watcher.on('change', scheduleRebuild);
  watcher.on('unlink', scheduleRebuild);
  watcher.on('addDir', scheduleRebuild);
  watcher.on('unlinkDir', scheduleRebuild);

  return { repoId, repoRoot, watcher };
}

export async function stopWatcher(watched: WatchedRepo): Promise<void> {
  await watched.watcher.close();
}
