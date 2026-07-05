import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rebuild, type RepoState } from '../../src/daemon/repo-state.js';
import { buildServer, type RepoRuntime } from '../../src/daemon/server.js';

let repoRootA: string;
let repoRootB: string;

function writeDoc(repoRoot: string, relPath: string, content: string): void {
  const abs = join(repoRoot, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function runtimeFor(id: string, repoRoot: string, initialState: RepoState): RepoRuntime {
  let state = initialState;
  return {
    id,
    name: id,
    absPath: repoRoot,
    getState: () => state,
    setState: (next) => {
      state = next;
    },
  };
}

beforeEach(() => {
  repoRootA = mkdtempSync(join(tmpdir(), 'chartroom-inbox-test-a-'));
  repoRootB = mkdtempSync(join(tmpdir(), 'chartroom-inbox-test-b-'));
});

afterEach(() => {
  rmSync(repoRootA, { recursive: true, force: true });
  rmSync(repoRootB, { recursive: true, force: true });
});

describe('GET /api/inbox (plan §6.1)', () => {
  it('aggregates unanswered ask-me + unchecked actions across two repos, excluding answered/checked ones', async () => {
    writeDoc(
      repoRootA,
      'a1.md',
      [
        '---',
        'id: a1',
        '---',
        '',
        ':::ask-me{id="q-unanswered" type="text"}',
        'Unanswered question in repo A',
        ':::',
        '',
        ':::ask-me{id="q-answered" type="text" answered="true"}',
        'Already answered question',
        '',
        '> **Answer** (2026-01-01, X): done',
        ':::',
        '',
        ':::actions{id="action-unchecked"}',
        '- [ ] Unchecked action in repo A',
        ':::',
        '',
        ':::actions{id="action-checked"}',
        '- [x] Checked action in repo A',
        ':::',
        '',
      ].join('\n'),
    );
    writeDoc(
      repoRootB,
      'b1.md',
      [
        '---',
        'id: b1',
        '---',
        '',
        ':::ask-me{id="q-b" type="yesno"}',
        'Unanswered question in repo B',
        ':::',
        '',
      ].join('\n'),
    );

    const stateA = rebuild(repoRootA);
    const stateB = rebuild(repoRootB);
    const app = buildServer(
      [runtimeFor('repo-a', repoRootA, stateA), runtimeFor('repo-b', repoRootB, stateB)],
      { uiDistDir: join(repoRootA, 'no-such-ui-dist') },
    );

    const response = await app.inject({ method: 'GET', url: '/api/inbox' });
    expect(response.statusCode).toBe(200);
    const items = response.json() as Array<Record<string, unknown>>;

    expect(items).toHaveLength(3);

    const askMeA = items.find((i) => i.directiveId === 'q-unanswered');
    expect(askMeA).toMatchObject({ repoId: 'repo-a', docId: 'a1', kind: 'ask-me', label: 'Unanswered question in repo A', type: 'text' });

    const askMeB = items.find((i) => i.directiveId === 'q-b');
    expect(askMeB).toMatchObject({ repoId: 'repo-b', docId: 'b1', kind: 'ask-me', label: 'Unanswered question in repo B', type: 'yesno' });

    const actionA = items.find((i) => i.directiveId === 'action-unchecked');
    expect(actionA).toMatchObject({ repoId: 'repo-a', docId: 'a1', kind: 'actions', label: 'Unchecked action in repo A' });

    expect(items.some((i) => i.directiveId === 'q-answered')).toBe(false);
    expect(items.some((i) => i.directiveId === 'action-checked')).toBe(false);
  });

  it('returns an empty list when no repos are registered', async () => {
    const app = buildServer([], { uiDistDir: join(repoRootA, 'no-such-ui-dist') });
    const response = await app.inject({ method: 'GET', url: '/api/inbox' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });
});
