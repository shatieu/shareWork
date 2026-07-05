import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rebuild, type RepoState } from '../../src/daemon/repo-state.js';
import { buildServer, type RepoRuntime } from '../../src/daemon/server.js';
import type { SpawnLike } from '../../src/daemon/routes/claude-session.js';

let repoRoot: string;

function runtimeFor(id: string, initialState: RepoState): RepoRuntime {
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
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-claude-session-test-'));
  writeFileSync(join(repoRoot, 'a.md'), '---\nid: a\n---\n\n# A\n', 'utf8');
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('POST /api/repos/:repoId/claude-session (wave-2 feature 6)', () => {
  it('unknown repo -> 404, and nothing is spawned', async () => {
    const calls: unknown[][] = [];
    const spawner: SpawnLike = (...args) => {
      calls.push(args);
      return { unref: () => {} };
    };
    const app = buildServer([runtimeFor('repo-a', rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
      claudeSession: { spawner },
    });

    const response = await app.inject({ method: 'POST', url: '/api/repos/nope/claude-session' });
    expect(response.statusCode).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('known repo -> { ok: true } with the terminal spawned detached at the repo root (win32 + wt)', async () => {
    const calls: Array<{ command: string; args: string[]; options: { detached: boolean; stdio: string } }> = [];
    let unrefed = false;
    const spawner: SpawnLike = (command, args, options) => {
      calls.push({ command, args, options });
      return {
        unref: () => {
          unrefed = true;
        },
      };
    };
    const app = buildServer([runtimeFor('repo-a', rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
      claudeSession: { spawner, platform: 'win32', hasWindowsTerminal: () => true },
    });

    const response = await app.inject({ method: 'POST', url: '/api/repos/repo-a/claude-session' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('cmd');
    expect(calls[0].args).toEqual(['/c', 'start', '', 'wt', '-d', repoRoot, 'claude']);
    expect(calls[0].options).toEqual({ detached: true, stdio: 'ignore' });
    expect(unrefed).toBe(true);
  });

  it('win32 without Windows Terminal falls back to a plain cmd window', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const spawner: SpawnLike = (command, args) => {
      calls.push({ command, args });
      return { unref: () => {} };
    };
    const app = buildServer([runtimeFor('repo-a', rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
      claudeSession: { spawner, platform: 'win32', hasWindowsTerminal: () => false },
    });

    const response = await app.inject({ method: 'POST', url: '/api/repos/repo-a/claude-session' });
    expect(response.statusCode).toBe(200);
    expect(calls[0].command).toBe('cmd');
    expect(calls[0].args).toContain('/k');
    expect(calls[0].args.join(' ')).toContain('claude');
  });

  it('a synchronous spawn failure -> readable 500', async () => {
    const spawner: SpawnLike = () => {
      throw new Error('spawn wt ENOENT');
    };
    const app = buildServer([runtimeFor('repo-a', rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
      claudeSession: { spawner, platform: 'win32', hasWindowsTerminal: () => true },
    });

    const response = await app.inject({ method: 'POST', url: '/api/repos/repo-a/claude-session' });
    expect(response.statusCode).toBe(500);
    expect(response.json().error).toContain('spawn wt ENOENT');
  });
});
