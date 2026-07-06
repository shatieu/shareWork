import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openShipLogDb, listEntries, getSession } from '../src/db.js';
import {
  createCaptureContext,
  onSessionEnd,
  onSessionStart,
  onStop,
  sweepOrphans,
  type CaptureContext,
  type CaptureEnvelope,
} from '../src/capture.js';
import type { Summarizer } from '../src/summarize.js';

let fakeHome: string;
let repo: string;
let db: Database.Database;

function git(cwd: string, args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

function initRepoWithCommit(dir: string) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  writeFileSync(join(dir, 'a.txt'), 'one\n');
  git(dir, ['add', 'a.txt']);
  git(dir, ['commit', '-q', '-m', 'initial commit']);
}

const fakeSummarizer: Summarizer = async () => ({ text: 'Fake summary.', model: 'fake' });
const nullSummarizer: Summarizer = async () => null;

function envelope(hookEventName: string, sessionId: string, cwd: string, extra: Record<string, unknown> = {}): CaptureEnvelope {
  return {
    hook_event_name: hookEventName,
    session_id: sessionId,
    cwd,
    transcript_path: undefined,
    emitted_at: new Date().toISOString(),
    payload: extra,
  };
}

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'ship-log-capture-test-home-'));
  repo = mkdtempSync(join(tmpdir(), 'ship-log-capture-test-repo-'));
  db = openShipLogDb(fakeHome);
});

afterEach(() => {
  db.close();
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe('full SessionStart -> Stop -> SessionEnd flow', () => {
  it('produces exactly one entry and one fragment', async () => {
    initRepoWithCommit(repo);
    const ctx = createCaptureContext(db, fakeSummarizer);
    const sessionId = 'sess-full-flow-1';

    onSessionStart(ctx, envelope('SessionStart', sessionId, repo));

    writeFileSync(join(repo, 'b.txt'), 'two\n');
    git(repo, ['add', 'b.txt']);
    git(repo, ['commit', '-q', '-m', 'add b']);

    onStop(ctx, envelope('Stop', sessionId, repo));
    expect(listEntries(db)).toHaveLength(0); // Stop never writes an entry

    await onSessionEnd(ctx, envelope('SessionEnd', sessionId, repo, { reason: 'other' }));

    const entries = listEntries(db);
    expect(entries).toHaveLength(1);
    expect(entries[0].summary).toBe('Fake summary.');
    expect(getSession(db, sessionId)?.captured).toBe(1);

    const fragmentFiles = readdirSync(join(repo, 'changelog', 'entries'));
    expect(fragmentFiles).toHaveLength(1);
  });

  it('SessionEnd is idempotent -- a second SessionEnd never double-writes', async () => {
    initRepoWithCommit(repo);
    const ctx = createCaptureContext(db, fakeSummarizer);
    const sessionId = 'sess-idempotent-1';

    onSessionStart(ctx, envelope('SessionStart', sessionId, repo));
    writeFileSync(join(repo, 'c.txt'), 'three\n');
    git(repo, ['add', 'c.txt']);
    git(repo, ['commit', '-q', '-m', 'add c']);

    await onSessionEnd(ctx, envelope('SessionEnd', sessionId, repo));
    await onSessionEnd(ctx, envelope('SessionEnd', sessionId, repo));

    expect(listEntries(db)).toHaveLength(1);
    expect(readdirSync(join(repo, 'changelog', 'entries'))).toHaveLength(1);
  });

  it('a no-delta session gets an entry but no fragment (noise floor)', async () => {
    initRepoWithCommit(repo);
    const ctx = createCaptureContext(db, fakeSummarizer);
    const sessionId = 'sess-no-delta-1';

    onSessionStart(ctx, envelope('SessionStart', sessionId, repo));
    // No commits, no dirty files this time.
    await onSessionEnd(ctx, envelope('SessionEnd', sessionId, repo));

    const entries = listEntries(db);
    expect(entries).toHaveLength(1);
    expect(entries[0].fragment_path).toBeNull();
    expect(existsSync(join(repo, 'changelog', 'entries'))).toBe(false);
  });

  it('degrades gracefully when the summarizer returns null (fallback summary, still completes)', async () => {
    initRepoWithCommit(repo);
    const ctx = createCaptureContext(db, nullSummarizer);
    const sessionId = 'sess-null-summarizer-1';

    onSessionStart(ctx, envelope('SessionStart', sessionId, repo));
    writeFileSync(join(repo, 'd.txt'), 'four\n');
    git(repo, ['add', 'd.txt']);
    git(repo, ['commit', '-q', '-m', 'fallback commit']);

    await onSessionEnd(ctx, envelope('SessionEnd', sessionId, repo));

    const entries = listEntries(db);
    expect(entries[0].summary).toContain('fallback commit');
    expect(entries[0].summary_model).toBeNull();
  });
});

describe('missing SessionStart (degraded/partial capture)', () => {
  it('SessionEnd without a prior SessionStart still captures, marked partial', async () => {
    initRepoWithCommit(repo);
    const ctx = createCaptureContext(db, fakeSummarizer);
    const sessionId = 'sess-missing-start-1';

    await onSessionEnd(ctx, envelope('SessionEnd', sessionId, repo));

    const entries = listEntries(db);
    expect(entries).toHaveLength(1);
    expect(entries[0].partial).toBe(1);
  });
});

describe('orphan sweep', () => {
  it('captures a session stale beyond the threshold with end_reason=orphaned', async () => {
    initRepoWithCommit(repo);
    let now = new Date('2026-07-06T00:00:00.000Z');
    const ctx: CaptureContext = createCaptureContext(db, fakeSummarizer, {
      now: () => now,
      orphanThresholdMs: 2 * 60 * 60 * 1000,
    });
    const sessionId = 'sess-orphan-1';

    onSessionStart(ctx, envelope('SessionStart', sessionId, repo));
    onStop(ctx, { ...envelope('Stop', sessionId, repo), emitted_at: now.toISOString() });

    writeFileSync(join(repo, 'e.txt'), 'five\n');
    git(repo, ['add', 'e.txt']);
    git(repo, ['commit', '-q', '-m', 'orphaned commit']);

    now = new Date('2026-07-06T03:00:00.000Z'); // 3h later -- past the 2h threshold
    const sweptCount = await sweepOrphans(ctx);

    expect(sweptCount).toBe(1);
    const session = getSession(db, sessionId)!;
    expect(session.captured).toBe(1);
    expect(session.end_reason).toBe('orphaned');
    expect(listEntries(db)).toHaveLength(1);
  });

  it('does not sweep a session within the threshold', async () => {
    initRepoWithCommit(repo);
    const now = new Date('2026-07-06T00:00:00.000Z');
    const ctx = createCaptureContext(db, fakeSummarizer, {
      now: () => now,
      orphanThresholdMs: 2 * 60 * 60 * 1000,
    });
    onSessionStart(ctx, { ...envelope('SessionStart', 'sess-fresh-1', repo), emitted_at: now.toISOString() });

    const sweptCount = await sweepOrphans(ctx);
    expect(sweptCount).toBe(0);
  });
});
