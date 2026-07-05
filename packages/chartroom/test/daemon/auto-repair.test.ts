import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rebuild } from '../../src/daemon/repo-state.js';
import { runAutoRepair } from '../../src/daemon/auto-repair.js';
import { RebuildPipeline } from '../../src/daemon/rebuild-pipeline.js';
import { ActivityLog } from '../../src/daemon/activity.js';

let repoRoot: string;
let fakeHome: string;

function writeDoc(relPath: string, content: string): void {
  const abs = join(repoRoot, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-auto-repair-test-'));
  fakeHome = mkdtempSync(join(tmpdir(), 'chartroom-auto-repair-test-home-'));
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
});

/** The canonical scenario: a linked doc moves, the (id-less!) source doc's href goes stale. */
function setupMovedTarget(): void {
  writeDoc('docs/rotate.md', '---\nid: key-rotation\n---\n\n# Key rotation\n');
  writeDoc('index.md', '# Index\n\nSee [Rotate](docs/rotate.md "id:key-rotation").\n');
  rebuild(repoRoot); // baseline index while everything still lines up

  mkdirSync(join(repoRoot, 'ops'), { recursive: true });
  renameSync(join(repoRoot, 'docs', 'rotate.md'), join(repoRoot, 'ops', 'rotate.md'));
}

describe('runAutoRepair (daemon-side link repair, wave-2 feature 2)', () => {
  it('rewrites the stale href in the source file and emits one repair event', () => {
    setupMovedTarget();
    const state = rebuild(repoRoot); // what the watcher would produce after the move

    const result = runAutoRepair(repoRoot, state);

    expect(result.changedFiles).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toEqual({
      summary: 'link repaired via id:key-rotation',
      detail: 'index.md — href docs/rotate.md → ops/rotate.md',
      docKey: 'index.md', // index.md is id-less, so its key is its path
      path: 'index.md',
    });

    const repaired = readFileSync(join(repoRoot, 'index.md'), 'utf8');
    expect(repaired).toContain('[Rotate](ops/rotate.md "id:key-rotation")');
    expect(repaired).not.toContain('docs/rotate.md');
  });

  it('is idempotent: a second pass over the repaired repo changes nothing', () => {
    setupMovedTarget();
    runAutoRepair(repoRoot, rebuild(repoRoot));

    const secondPass = runAutoRepair(repoRoot, rebuild(repoRoot));
    expect(secondPass.changedFiles).toBe(0);
    expect(secondPass.events).toEqual([]);
  });
});

describe('RebuildPipeline (serve-time repair + activity wiring)', () => {
  const repo = () => ({ id: 'repo-a', name: 'repo-a', absPath: repoRoot });

  it('repairs on process(), returns the post-repair state, and logs repair events', () => {
    setupMovedTarget();
    const activity = new ActivityLog(fakeHome);
    const pipeline = new RebuildPipeline(activity);

    const installed = pipeline.process(repo(), rebuild(repoRoot));

    // The installed state reflects the repaired file, not the pre-repair snapshot.
    const indexEntry = [...installed.index.unidentified].find((d) => d.path === 'index.md');
    expect(indexEntry?.outbound[0]?.hrefAsWritten).toBe('ops/rotate.md');
    expect(indexEntry?.outbound[0]?.stale).toBe(false);

    const repairs = activity.list(50).filter((e) => e.kind === 'repair');
    expect(repairs).toHaveLength(1);
    expect(repairs[0].summary).toBe('link repaired via id:key-rotation');
    expect(repairs[0].repoId).toBe('repo-a');
    expect(repairs[0].docKey).toBe('index.md');

    // The watcher re-fires after our own write; the follow-up process() must settle silently.
    const before = activity.list(50).length;
    pipeline.process(repo(), rebuild(repoRoot));
    expect(activity.list(50).length).toBe(before);
  });

  it('logs check failed on 0->N broken, then rebuild + check passed on N->0', () => {
    writeDoc('a.md', '---\nid: a\n---\n\n# A\n\n[Gone](nowhere.md "id:missing-doc").\n');
    const activity = new ActivityLog(fakeHome);
    const pipeline = new RebuildPipeline(activity);

    pipeline.process(repo(), rebuild(repoRoot));
    const afterBoot = activity.list(50);
    expect(afterBoot.some((e) => e.kind === 'check' && e.summary === 'check failed — 1 broken link(s)')).toBe(true);

    // Fix the doc: the broken link goes away -> counts changed -> rebuild + check passed.
    writeDoc('a.md', '---\nid: a\n---\n\n# A\n');
    pipeline.process(repo(), rebuild(repoRoot));
    const events = activity.list(50);
    expect(events.some((e) => e.kind === 'rebuild' && e.detail === '1 docs · 0 broken')).toBe(true);
    expect(events.some((e) => e.kind === 'check' && e.summary === 'check passed — 0 broken')).toBe(true);
  });

  it('loop guard: more than 3 file-changing passes within 10s pauses repair with a warning', () => {
    const activity = new ActivityLog(fakeHome);
    const pipeline = new RebuildPipeline(activity);

    writeDoc('target.md', '---\nid: t\n---\n\n# T\n');
    const staleSource = '# S\n\n[T](wrong/target.md "id:t").\n';

    // Simulate an external process fighting the repairer: re-corrupt the source after every pass.
    for (let i = 0; i < 3; i += 1) {
      writeDoc('source.md', staleSource);
      pipeline.process(repo(), rebuild(repoRoot));
      expect(readFileSync(join(repoRoot, 'source.md'), 'utf8')).toContain('](target.md');
    }

    // 4th changing pass within the window: guard trips, file is left alone, warning logged once.
    writeDoc('source.md', staleSource);
    pipeline.process(repo(), rebuild(repoRoot));
    expect(readFileSync(join(repoRoot, 'source.md'), 'utf8')).toContain('](wrong/target.md');

    const warnings = activity
      .list(200)
      .filter((e) => e.kind === 'check' && e.summary.includes('repair loop detected'));
    expect(warnings).toHaveLength(1);
  });
});
