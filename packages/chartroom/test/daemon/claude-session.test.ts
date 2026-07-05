import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rebuild, type RepoState } from '../../src/daemon/repo-state.js';
import { buildServer, type RepoRuntime } from '../../src/daemon/server.js';
import { cleanClaudeEnv, type SpawnLike } from '../../src/daemon/routes/claude-session.js';

let repoRoot: string;

/** Every legitimate Deck client attaches the CSRF-proof header (plan 03 §4.5). */
const deckHeaders = { 'x-ship-deck': '1' };

interface SpawnCall {
  command: string;
  args: string[];
  options: { detached: boolean; stdio: string; env: NodeJS.ProcessEnv; cwd?: string };
}

function runtimeFor(id: string, absPath: string, initialState: RepoState): RepoRuntime {
  let state = initialState;
  return {
    id,
    name: id,
    absPath,
    getState: () => state,
    setState: (next) => {
      state = next;
    },
  };
}

function recordingSpawner(calls: SpawnCall[], onUnref?: () => void): SpawnLike {
  return (command, args, options) => {
    calls.push({ command, args, options: options as SpawnCall['options'] });
    return {
      unref: () => onUnref?.(),
    };
  };
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-claude-session-test-'));
  writeFileSync(join(repoRoot, 'a.md'), '---\nid: a\n---\n\n# A\n', 'utf8');
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('POST /api/repos/:repoId/claude-session (plan 03 §4.5)', () => {
  it('missing x-ship-deck header -> 403, and nothing is spawned', async () => {
    const calls: SpawnCall[] = [];
    const app = buildServer([runtimeFor('repo-a', repoRoot, rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
      claudeSession: { spawner: recordingSpawner(calls), platform: 'win32', hasWindowsTerminal: () => true },
    });

    const response = await app.inject({ method: 'POST', url: '/api/repos/repo-a/claude-session' });
    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: string }).error).toContain('x-ship-deck');
    expect(calls).toHaveLength(0);
  });

  it('unknown repo -> 404, and nothing is spawned', async () => {
    const calls: SpawnCall[] = [];
    const app = buildServer([runtimeFor('repo-a', repoRoot, rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
      claudeSession: { spawner: recordingSpawner(calls) },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/repos/nope/claude-session',
      headers: deckHeaders,
    });
    expect(response.statusCode).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('win32 + wt: direct wt.exe spawn, -w new, -d <repo>, cmd /k claude (researcher R1 argv)', async () => {
    const calls: SpawnCall[] = [];
    let unrefed = false;
    const app = buildServer([runtimeFor('repo-a', repoRoot, rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
      claudeSession: {
        spawner: recordingSpawner(calls, () => {
          unrefed = true;
        }),
        platform: 'win32',
        hasWindowsTerminal: () => true,
        baseEnv: { PATH: 'x' },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/repos/repo-a/claude-session',
      headers: deckHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('wt.exe');
    expect(calls[0].args).toEqual(['-w', 'new', '-d', repoRoot, 'cmd', '/k', 'claude']);
    expect(calls[0].options.detached).toBe(true);
    expect(calls[0].options.stdio).toBe('ignore');
    expect(unrefed).toBe(true);
  });

  it('win32 + wt handles a repo path with spaces as a plain argv element (no manual quoting)', async () => {
    const spacedRoot = mkdtempSync(join(tmpdir(), 'chartroom claude space '));
    try {
      writeFileSync(join(spacedRoot, 'a.md'), '---\nid: a\n---\n\n# A\n', 'utf8');
      const calls: SpawnCall[] = [];
      const app = buildServer([runtimeFor('spaced', spacedRoot, rebuild(spacedRoot))], {
        uiDistDir: join(spacedRoot, 'no-such-ui-dist'),
        claudeSession: { spawner: recordingSpawner(calls), platform: 'win32', hasWindowsTerminal: () => true },
      });
      const response = await app.inject({
        method: 'POST',
        url: '/api/repos/spaced/claude-session',
        headers: deckHeaders,
      });
      expect(response.statusCode).toBe(200);
      // Node's win32 arg quoting handles the space; the route must pass the path verbatim.
      expect(calls[0].args).toContain(spacedRoot);
    } finally {
      rmSync(spacedRoot, { recursive: true, force: true });
    }
  });

  it('win32 without Windows Terminal falls back to cmd /c start with title + cwd (no cd /d)', async () => {
    const calls: SpawnCall[] = [];
    const app = buildServer([runtimeFor('repo-a', repoRoot, rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
      claudeSession: { spawner: recordingSpawner(calls), platform: 'win32', hasWindowsTerminal: () => false },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/repos/repo-a/claude-session',
      headers: deckHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(calls[0].command).toBe('cmd');
    expect(calls[0].args).toEqual(['/c', 'start', 'Claude — repo-a', 'cmd', '/k', 'claude']);
    // Researcher R1: spawn's cwd propagates through `cmd /c start` to the new console.
    expect(calls[0].options.cwd).toBe(repoRoot);
  });

  it('win32: a repo path containing ";" routes to the cmd fallback even when wt is available', async () => {
    // wt treats ";" as a command delimiter (researcher R1 caveat) -- the fallback is verbatim-safe.
    const calls: SpawnCall[] = [];
    const trickyPath = join(repoRoot, 'a;b');
    const app = buildServer([runtimeFor('tricky', trickyPath, rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
      claudeSession: { spawner: recordingSpawner(calls), platform: 'win32', hasWindowsTerminal: () => true },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/repos/tricky/claude-session',
      headers: deckHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(calls[0].command).toBe('cmd');
    expect(calls[0].options.cwd).toBe(trickyPath);
  });

  it('strips Claude-session markers from the child env (researcher R2, vendor-mirrored list)', async () => {
    const calls: SpawnCall[] = [];
    const app = buildServer([runtimeFor('repo-a', repoRoot, rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
      claudeSession: {
        spawner: recordingSpawner(calls),
        platform: 'win32',
        hasWindowsTerminal: () => true,
        baseEnv: {
          PATH: 'keep-me',
          CLAUDECODE: '1',
          CLAUDE_CODE_SESSION_ID: 's',
          CLAUDE_CODE_CHILD_SESSION: 'c',
          CLAUDE_CODE_BRIDGE_SESSION_ID: 'b',
          CLAUDE_CODE_ENTRYPOINT: 'cli',
          AI_AGENT: 'x',
          INVOCATION_ID: 'systemd-ish',
        },
      },
    });

    await app.inject({ method: 'POST', url: '/api/repos/repo-a/claude-session', headers: deckHeaders });
    const env = calls[0].options.env;
    expect(env.PATH).toBe('keep-me');
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
    expect(env.CLAUDE_CODE_BRIDGE_SESSION_ID).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(env.AI_AGENT).toBeUndefined();
    expect(env.INVOCATION_ID).toBe('');
  });

  it('darwin: writes a per-request launcher and opens it in Terminal', async () => {
    const calls: SpawnCall[] = [];
    const app = buildServer([runtimeFor('repo-a', repoRoot, rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
      claudeSession: { spawner: recordingSpawner(calls), platform: 'darwin' },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/repos/repo-a/claude-session',
      headers: deckHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(calls[0].command).toBe('open');
    expect(calls[0].args[0]).toBe('-a');
    expect(calls[0].args[1]).toBe('Terminal');
    // Per-request unique launcher file (TOCTOU fix) -- name embeds a timestamp + random suffix.
    expect(calls[0].args[2]).toMatch(/claude-session-\d+-[0-9a-f]{8}\.command$/);
  });

  it('linux: x-terminal-emulator with a cd-and-exec shell command', async () => {
    const calls: SpawnCall[] = [];
    const app = buildServer([runtimeFor('repo-a', repoRoot, rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
      claudeSession: { spawner: recordingSpawner(calls), platform: 'linux' },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/repos/repo-a/claude-session',
      headers: deckHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(calls[0].command).toBe('x-terminal-emulator');
    expect(calls[0].args[0]).toBe('-e');
    expect(calls[0].args[1]).toContain('exec claude');
  });

  it('a synchronous spawn failure -> readable 500', async () => {
    const spawner: SpawnLike = () => {
      throw new Error('spawn wt ENOENT');
    };
    const app = buildServer([runtimeFor('repo-a', repoRoot, rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
      claudeSession: { spawner, platform: 'win32', hasWindowsTerminal: () => true },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/repos/repo-a/claude-session',
      headers: deckHeaders,
    });
    expect(response.statusCode).toBe(500);
    expect((response.json() as { error: string }).error).toContain('spawn wt ENOENT');
  });
});

describe('cleanClaudeEnv', () => {
  it('never mutates the base env object', () => {
    const base: NodeJS.ProcessEnv = { CLAUDECODE: '1', PATH: 'p' };
    const cleaned = cleanClaudeEnv(base);
    expect(base.CLAUDECODE).toBe('1');
    expect(cleaned.CLAUDECODE).toBeUndefined();
    expect(cleaned.PATH).toBe('p');
  });
});
