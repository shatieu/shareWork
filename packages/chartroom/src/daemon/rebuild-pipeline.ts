import { rebuild, type RepoState } from './repo-state.js';
import { runAutoRepair } from './auto-repair.js';
import type { ActivityLog } from './activity.js';

/** Loop guard (wave-2 feature 2): if a repair pass *that changed files* runs more than this many
 * times within the window for the same repo, something outside our control is fighting the fix
 * engine (the engines themselves are idempotent) -- stop repairing and say so, rather than
 * rewriting the user's files in a tight loop. */
const MAX_CHANGING_PASSES = 3;
const LOOP_WINDOW_MS = 10_000;

export interface RepoIdentity {
  id: string;
  name: string;
  absPath: string;
}

interface RepoCounts {
  docs: number;
  broken: number;
}

function countsOf(state: RepoState): RepoCounts {
  return {
    docs: Object.keys(state.index.docs).length + state.index.unidentified.length,
    broken: state.check.brokenLinks.length,
  };
}

/** Where a 'check failed' event should take the user: the first file containing a broken link
 * (its doc key for in-app navigation, `id ?? path` per doc-lookup.ts), plus a human detail line
 * naming that file and how many more are affected — so the activity feed entry is a door, not
 * just a headline. */
function brokenNavigation(state: RepoState): { docKey?: string; path?: string; detail?: string } {
  const affectedPaths = [...new Set(state.check.brokenLinks.map((issue) => issue.path))];
  if (affectedPaths.length === 0) return {};
  const firstPath = affectedPaths[0];
  let docKey = firstPath;
  for (const [id, doc] of Object.entries(state.index.docs)) {
    if (doc.path === firstPath) {
      docKey = id;
      break;
    }
  }
  const more = affectedPaths.length - 1;
  const detail = more > 0 ? `in ${firstPath} (+${more} more file${more > 1 ? 's' : ''})` : `in ${firstPath}`;
  return { docKey, path: firstPath, detail };
}

/**
 * The serve-time glue between "a repo's state was just rebuilt" (boot, watcher, or a save route's
 * synchronous rebuild) and everything wave-2 layers on top of that moment: run the auto-repair
 * pass, rebuild again immediately if it changed files (so the served state never lags our own
 * writes), and translate what happened into activity-feed events -- with anti-spam rules:
 *
 *  - 'repair': one event per individual href change, always;
 *  - 'rebuild': only when the doc count or broken-link count actually changed vs. the previously
 *    processed state (the watcher re-fires after our own writes; an unchanged rebuild is noise);
 *  - 'check': only on a 0→N or N→0 broken-link-count transition (boot counts as starting from 0,
 *    so a repo that boots broken gets one honest 'check failed' event).
 *
 * Kept as its own small class (not inlined in commands/serve.ts) so tests can drive the full
 * boot-rebuild-repair-settle cycle without a CLI, a TCP listener, or a real chokidar watcher.
 */
export class RebuildPipeline {
  private readonly activity: ActivityLog;
  /** last *processed* counts per repo -- the baseline the anti-spam comparisons run against. */
  private readonly lastCounts = new Map<string, RepoCounts>();
  /** timestamps (ms) of recent repair passes that changed files, per repo, for the loop guard. */
  private readonly changingPasses = new Map<string, number[]>();
  /** repos whose loop guard already fired within the current window -- warn once, not per pass. */
  private readonly warnedLoop = new Set<string>();

  constructor(activity: ActivityLog) {
    this.activity = activity;
  }

  /**
   * Process a freshly rebuilt state for `repo` and return the state the caller should install
   * (the post-repair rebuild when repairs happened, otherwise the input state unchanged).
   */
  process(repo: RepoIdentity, state: RepoState, now: () => number = Date.now): RepoState {
    let current = state;

    if (this.loopGuardTripped(repo, now())) {
      if (!this.warnedLoop.has(repo.id)) {
        this.warnedLoop.add(repo.id);
        this.activity.log({
          ts: new Date().toISOString(),
          repoId: repo.id,
          repoName: repo.name,
          kind: 'check',
          summary: 'auto-repair paused — repair loop detected',
          detail: `more than ${MAX_CHANGING_PASSES} file-changing repair passes within ${LOOP_WINDOW_MS / 1000}s; leaving files alone until the churn settles`,
        });
      }
    } else {
      this.warnedLoop.delete(repo.id);
      const repair = runAutoRepair(repo.absPath, current);
      if (repair.changedFiles > 0) {
        this.recordChangingPass(repo.id, now());
        for (const draft of repair.events) {
          this.activity.log({
            ts: new Date().toISOString(),
            repoId: repo.id,
            repoName: repo.name,
            kind: 'repair',
            summary: draft.summary,
            detail: draft.detail,
            docKey: draft.docKey,
            path: draft.path,
          });
        }
        // Our own writes changed the files the input state was built from -- rebuild immediately
        // so the installed state (and the counts below) reflect the repaired reality, not a
        // pre-repair snapshot. The watcher will fire again too, harmlessly (idempotent pass).
        current = rebuild(repo.absPath);
      }
    }

    const counts = countsOf(current);
    const previous = this.lastCounts.get(repo.id);
    this.lastCounts.set(repo.id, counts);

    if (previous && (previous.docs !== counts.docs || previous.broken !== counts.broken)) {
      this.activity.log({
        ts: new Date().toISOString(),
        repoId: repo.id,
        repoName: repo.name,
        kind: 'rebuild',
        summary: 'index rebuilt',
        detail: `${counts.docs} docs · ${counts.broken} broken`,
      });
    }

    const previousBroken = previous?.broken ?? 0;
    if (previousBroken === 0 && counts.broken > 0) {
      const nav = brokenNavigation(current);
      this.activity.log({
        ts: new Date().toISOString(),
        repoId: repo.id,
        repoName: repo.name,
        kind: 'check',
        summary: `check failed — ${counts.broken} broken link(s)`,
        detail: nav.detail,
        docKey: nav.docKey,
        path: nav.path,
      });
    } else if (previousBroken > 0 && counts.broken === 0) {
      this.activity.log({
        ts: new Date().toISOString(),
        repoId: repo.id,
        repoName: repo.name,
        kind: 'check',
        summary: 'check passed — 0 broken',
      });
    }

    return current;
  }

  private loopGuardTripped(repo: RepoIdentity, nowMs: number): boolean {
    const recent = this.recentPasses(repo.id, nowMs);
    return recent.length >= MAX_CHANGING_PASSES;
  }

  private recordChangingPass(repoId: string, nowMs: number): void {
    const recent = this.recentPasses(repoId, nowMs);
    recent.push(nowMs);
    this.changingPasses.set(repoId, recent);
  }

  private recentPasses(repoId: string, nowMs: number): number[] {
    const all = this.changingPasses.get(repoId) ?? [];
    return all.filter((t) => nowMs - t <= LOOP_WINDOW_MS);
  }
}
