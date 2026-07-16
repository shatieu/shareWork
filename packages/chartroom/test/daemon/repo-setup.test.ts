// Setup-wizard routes + the setup module (deck-onboarding-wizard §API 2-4): pure-read audit on an
// empty repo and on a fully set-up repo, idempotent apply (second run all-ok, no file changes),
// human-id -> 400, and /setup/run spawning through the injected SpawnLike with server-generated
// commands only. Scratch repos via mkdtempSync; routes via buildServer + inject.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rebuild, type RepoState } from '../../src/daemon/repo-state.js';
import { buildServer, type RepoRuntime } from '../../src/daemon/server.js';
import type { SpawnLike } from '../../src/daemon/routes/claude-session.js';
import {
  applyRepoSetup,
  auditRepoSetup,
  AUTO_ITEM_IDS,
  CLAUDE_MD_MARKER,
  HUMAN_ITEM_IDS,
  SETUP_ITEM_IDS,
  type SetupAuditItem,
} from '../../src/setup/repo-setup.js';

const deckHeaders = { 'x-ship-deck': '1' };
const SUITE_ROOT = join('C:', 'fake suite', 'shareWork');

let repoRoot: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-repo-setup-test-'));
  mkdirSync(join(repoRoot, '.git'), { recursive: true }); // a plain .git dir is enough (hooks/ is created on demand)
  writeFileSync(join(repoRoot, 'README.md'), '# Scratch\n', 'utf8');
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

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

interface SpawnCall {
  command: string;
  args: string[];
  options: { detached: boolean; stdio: string; env: NodeJS.ProcessEnv; cwd?: string };
}

function recordingSpawner(calls: SpawnCall[]): SpawnLike {
  return (command, args, options) => {
    calls.push({ command, args, options: options as SpawnCall['options'] });
    return { unref: () => {} };
  };
}

function appFor(calls: SpawnCall[] = []) {
  return buildServer([runtimeFor('repo-a', repoRoot, rebuild(repoRoot))], {
    uiDistDir: join(repoRoot, 'no-such-ui-dist'),
    repoSetup: {
      suiteRoot: SUITE_ROOT,
      spawner: recordingSpawner(calls),
      platform: 'win32',
      hasWindowsTerminal: () => true,
      baseEnv: { PATH: 'x', CLAUDECODE: '1' },
    },
  });
}

function itemById(items: SetupAuditItem[], id: string): SetupAuditItem {
  const item = items.find((entry) => entry.id === id);
  if (!item) throw new Error(`item '${id}' not in audit`);
  return item;
}

describe('setup/repo-setup.ts module', () => {
  it('audit on an empty repo: the full canonical checklist, everything missing, pure read', async () => {
    const items = auditRepoSetup(repoRoot, { suiteRoot: SUITE_ROOT });
    expect(items.map((i) => i.id)).toEqual(SETUP_ITEM_IDS);
    expect(SETUP_ITEM_IDS).toEqual([
      'chartroom-init',
      'chartroom-skill',
      'agent-hook',
      'chartroomignore',
      'claude-md-section',
      'gitignore-entries',
      'ship-scrutiny',
      'lookout-init',
      'plugin-marketplace-add',
      'plugin-install',
      'mcp-ship-ledger',
      'mcp-ship-log',
    ]);
    for (const item of items) {
      expect(item.state).toBe('missing');
      expect(item.detail.length).toBeGreaterThan(0);
      expect(item.kind).toBe(HUMAN_ITEM_IDS.includes(item.id) ? 'human' : 'auto');
      if (item.kind === 'human') expect(typeof item.command).toBe('string');
      else expect(item.command).toBeUndefined();
    }
    // pure read: nothing appeared in the repo
    expect(() => readFileSync(join(repoRoot, '.chartroomignore'))).toThrow();
    expect(() => readFileSync(join(repoRoot, '.gitignore'))).toThrow();
  });

  it('human commands are the README canonical forms over the suite root', () => {
    const items = auditRepoSetup(repoRoot, { suiteRoot: SUITE_ROOT });
    expect(itemById(items, 'plugin-marketplace-add').command).toBe(
      `claude plugin marketplace add "${SUITE_ROOT}"`,
    );
    expect(itemById(items, 'plugin-install').command).toBe('claude plugin install ship-crew --scope project');
    expect(itemById(items, 'mcp-ship-ledger').command).toBe(
      `claude mcp add ship-ledger -- node "${join(SUITE_ROOT, 'packages', 'ship-ledger', 'dist', 'cli.js')}" mcp`,
    );
    expect(itemById(items, 'mcp-ship-log').command).toBe(
      `claude mcp add ship-log -- node "${join(SUITE_ROOT, 'packages', 'ship-log', 'dist', 'cli.js')}" mcp`,
    );
  });

  it('apply all auto items -> all ok; audit then reports every auto item present', () => {
    const results = applyRepoSetup(repoRoot, AUTO_ITEM_IDS, { suiteRoot: SUITE_ROOT });
    expect(results.map((r) => r.id)).toEqual(AUTO_ITEM_IDS);
    for (const result of results) {
      expect(result.ok, `${result.id}: ${result.detail}`).toBe(true);
    }

    const items = auditRepoSetup(repoRoot, { suiteRoot: SUITE_ROOT });
    for (const id of AUTO_ITEM_IDS) {
      expect(itemById(items, id).state, id).toBe('present');
    }
    // the settings merge wrote scrutiny AND kept the agent hook's entry (no clobbering)
    const settings = JSON.parse(readFileSync(join(repoRoot, '.claude', 'settings.json'), 'utf8'));
    expect(settings.ship).toEqual({ scrutiny: 'standard' });
    expect(Array.isArray(settings.hooks.PostToolUseFailure)).toBe(true);
  });

  it('second apply is a no-op: all ok again, gitignore/CLAUDE.md/settings byte-identical', () => {
    applyRepoSetup(repoRoot, AUTO_ITEM_IDS, { suiteRoot: SUITE_ROOT });
    const snapshot = ['.gitignore', 'CLAUDE.md', '.chartroomignore', join('.claude', 'settings.json')].map((rel) =>
      readFileSync(join(repoRoot, rel), 'utf8'),
    );
    const lookoutConfig = readFileSync(join(repoRoot, '.ship', 'lookout', 'config.json'), 'utf8');

    const again = applyRepoSetup(repoRoot, AUTO_ITEM_IDS, { suiteRoot: SUITE_ROOT });
    for (const result of again) {
      expect(result.ok, `${result.id}: ${result.detail}`).toBe(true);
    }
    const after = ['.gitignore', 'CLAUDE.md', '.chartroomignore', join('.claude', 'settings.json')].map((rel) =>
      readFileSync(join(repoRoot, rel), 'utf8'),
    );
    expect(after).toEqual(snapshot);
    // the lookout session id survives a re-apply (initConfig idempotency)
    expect(readFileSync(join(repoRoot, '.ship', 'lookout', 'config.json'), 'utf8')).toBe(lookoutConfig);
  });

  it('a refused installer is a per-item error result and does not abort the rest', () => {
    // A differently-authored file at the skill path -- installSkill refuses to clobber it.
    mkdirSync(join(repoRoot, '.claude', 'skills', 'chart-room'), { recursive: true });
    writeFileSync(join(repoRoot, '.claude', 'skills', 'chart-room', 'SKILL.md'), 'someone elses skill\n', 'utf8');

    const audit = auditRepoSetup(repoRoot, { suiteRoot: SUITE_ROOT });
    expect(itemById(audit, 'chartroom-skill').state).toBe('partial');

    const results = applyRepoSetup(repoRoot, ['chartroom-skill', 'chartroomignore'], { suiteRoot: SUITE_ROOT });
    expect(results[0]).toMatchObject({ id: 'chartroom-skill', ok: false });
    expect(results[0].detail).toContain('refused');
    expect(results[1]).toMatchObject({ id: 'chartroomignore', ok: true });
    // the foreign file survived
    expect(readFileSync(join(repoRoot, '.claude', 'skills', 'chart-room', 'SKILL.md'), 'utf8')).toContain(
      'someone elses',
    );
  });

  it('claude-md-section: an existing Chart Room heading counts as present and is never duplicated', () => {
    writeFileSync(join(repoRoot, 'CLAUDE.md'), '# My repo\n\n## Chart Room\n\nhand-written notes\n', 'utf8');
    const audit = auditRepoSetup(repoRoot, { suiteRoot: SUITE_ROOT });
    expect(itemById(audit, 'claude-md-section').state).toBe('present');

    const results = applyRepoSetup(repoRoot, ['claude-md-section'], { suiteRoot: SUITE_ROOT });
    expect(results[0].ok).toBe(true);
    const raw = readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8');
    expect(raw).toContain('hand-written notes');
    expect(raw).not.toContain(CLAUDE_MD_MARKER);
  });

  it('claude-md-section: appends the marker-guarded section to an existing CLAUDE.md', () => {
    writeFileSync(join(repoRoot, 'CLAUDE.md'), '# My repo\n\nexisting content\n', 'utf8');
    applyRepoSetup(repoRoot, ['claude-md-section'], { suiteRoot: SUITE_ROOT });
    const raw = readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8');
    expect(raw.startsWith('# My repo\n\nexisting content\n')).toBe(true);
    expect(raw).toContain(CLAUDE_MD_MARKER);
    expect(raw).toContain('## Chart Room');
  });

  it('gitignore-entries: partial coverage is completed without duplicating existing lines', () => {
    writeFileSync(join(repoRoot, '.gitignore'), 'node_modules/\n.ship/\n', 'utf8');
    const audit = auditRepoSetup(repoRoot, { suiteRoot: SUITE_ROOT });
    expect(itemById(audit, 'gitignore-entries').state).toBe('partial');

    applyRepoSetup(repoRoot, ['gitignore-entries'], { suiteRoot: SUITE_ROOT });
    const raw = readFileSync(join(repoRoot, '.gitignore'), 'utf8');
    const lines = raw.split('\n').map((line) => line.trim());
    for (const entry of ['.ship/', '.docs/', '.ship-crew/']) {
      expect(lines.filter((line) => line === entry)).toHaveLength(1);
    }
    expect(raw.startsWith('node_modules/\n.ship/\n')).toBe(true);
  });

  it('ship-scrutiny: merges without clobbering other settings keys and respects an existing value', () => {
    mkdirSync(join(repoRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(repoRoot, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'ship-crew@sharework': true }, permissions: { allow: ['x'] } }, null, 2),
      'utf8',
    );
    applyRepoSetup(repoRoot, ['ship-scrutiny'], { suiteRoot: SUITE_ROOT });
    const settings = JSON.parse(readFileSync(join(repoRoot, '.claude', 'settings.json'), 'utf8'));
    expect(settings.ship).toEqual({ scrutiny: 'standard' });
    expect(settings.enabledPlugins).toEqual({ 'ship-crew@sharework': true });
    expect(settings.permissions).toEqual({ allow: ['x'] });

    // an existing scrutiny value is never overwritten
    settings.ship.scrutiny = 'paranoid';
    writeFileSync(join(repoRoot, '.claude', 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');
    const results = applyRepoSetup(repoRoot, ['ship-scrutiny'], { suiteRoot: SUITE_ROOT });
    expect(results[0].ok).toBe(true);
    const after = JSON.parse(readFileSync(join(repoRoot, '.claude', 'settings.json'), 'utf8'));
    expect(after.ship.scrutiny).toBe('paranoid');
    const audit = auditRepoSetup(repoRoot, { suiteRoot: SUITE_ROOT });
    expect(itemById(audit, 'ship-scrutiny')).toMatchObject({ state: 'present', detail: 'ship.scrutiny = "paranoid"' });
  });

  it('human items audit from repo files: enabledPlugins and .mcp.json flip them to present', () => {
    mkdirSync(join(repoRoot, '.claude'), { recursive: true });
    writeFileSync(
      join(repoRoot, '.claude', 'settings.json'),
      JSON.stringify({ enabledPlugins: { 'ship-crew@sharework': true } }),
      'utf8',
    );
    writeFileSync(join(repoRoot, '.mcp.json'), JSON.stringify({ mcpServers: { 'ship-ledger': {} } }), 'utf8');

    const items = auditRepoSetup(repoRoot, { suiteRoot: SUITE_ROOT });
    expect(itemById(items, 'plugin-install').state).toBe('present');
    expect(itemById(items, 'plugin-marketplace-add').state).toBe('present');
    expect(itemById(items, 'mcp-ship-ledger').state).toBe('present');
    expect(itemById(items, 'mcp-ship-log').state).toBe('missing');
  });

  it('apply refuses unknown and human ids before touching anything', () => {
    expect(() => applyRepoSetup(repoRoot, ['nope'], { suiteRoot: SUITE_ROOT })).toThrow(/unknown setup item/);
    expect(() => applyRepoSetup(repoRoot, ['chartroomignore', 'plugin-install'], { suiteRoot: SUITE_ROOT })).toThrow(
      /human step/,
    );
    // the valid id listed alongside the bad one was NOT applied
    expect(() => readFileSync(join(repoRoot, '.chartroomignore'))).toThrow();
  });
});

describe('GET/POST /api/repos/:repoId/setup (routes)', () => {
  it('403s without the x-ship-deck header on all three routes', async () => {
    const app = appFor();
    for (const [method, url] of [
      ['GET', '/api/repos/repo-a/setup'],
      ['POST', '/api/repos/repo-a/setup'],
      ['POST', '/api/repos/repo-a/setup/run'],
    ] as const) {
      const res = await app.inject({ method, url, payload: method === 'POST' ? {} : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('404s an unknown repo', async () => {
    const res = await appFor().inject({ method: 'GET', url: '/api/repos/nope/setup', headers: deckHeaders });
    expect(res.statusCode).toBe(404);
  });

  it('audit -> apply subset -> re-audit shows the applied items present; re-apply is all-ok', async () => {
    const app = appFor();
    const subset = ['chartroomignore', 'gitignore-entries', 'ship-scrutiny', 'lookout-init'];

    const before = await app.inject({ method: 'GET', url: '/api/repos/repo-a/setup', headers: deckHeaders });
    expect(before.statusCode).toBe(200);
    const beforeBody = before.json() as { repoId: string; items: SetupAuditItem[] };
    expect(beforeBody.repoId).toBe('repo-a');
    for (const id of subset) expect(itemById(beforeBody.items, id).state).toBe('missing');

    const applied = await app.inject({
      method: 'POST',
      url: '/api/repos/repo-a/setup',
      headers: deckHeaders,
      payload: { apply: subset },
    });
    expect(applied.statusCode).toBe(200);
    const results = (applied.json() as { results: { id: string; ok: boolean }[] }).results;
    expect(results.map((r) => r.id)).toEqual(subset);
    expect(results.every((r) => r.ok)).toBe(true);

    const after = await app.inject({ method: 'GET', url: '/api/repos/repo-a/setup', headers: deckHeaders });
    const afterBody = after.json() as { items: SetupAuditItem[] };
    for (const id of subset) expect(itemById(afterBody.items, id).state).toBe('present');

    const again = await app.inject({
      method: 'POST',
      url: '/api/repos/repo-a/setup',
      headers: deckHeaders,
      payload: { apply: subset },
    });
    expect((again.json() as { results: { ok: boolean }[] }).results.every((r) => r.ok)).toBe(true);
  });

  it('400s a human id, an unknown id, and a malformed body', async () => {
    const app = appFor();
    for (const payload of [{ apply: ['plugin-install'] }, { apply: ['nope'] }, { apply: 'chartroomignore' }, {}]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/repo-a/setup',
        headers: deckHeaders,
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(typeof (res.json() as { error: string }).error).toBe('string');
    }
  });
});

describe('POST /api/repos/:repoId/setup/run', () => {
  it('spawns the server-generated command through the injected SpawnLike (win32 + wt shape)', async () => {
    const calls: SpawnCall[] = [];
    const res = await appFor(calls).inject({
      method: 'POST',
      url: '/api/repos/repo-a/setup/run',
      headers: deckHeaders,
      payload: { itemId: 'plugin-install' },
    });
    expect(res.statusCode).toBe(200);
    // FE contract alignment: bare { ok: true } success body.
    expect(res.json()).toEqual({ ok: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe('wt.exe');
    // -d <repo>: scope-sensitive claude commands must run inside the target repo
    expect(calls[0].args).toEqual([
      '-w',
      'new',
      '-d',
      repoRoot,
      'cmd',
      '/k',
      'claude',
      'plugin',
      'install',
      'ship-crew',
      '--scope',
      'project',
    ]);
    expect(calls[0].options.detached).toBe(true);
    // env hygiene: the daemon's own Claude session markers never leak into the child
    expect(calls[0].options.env.CLAUDECODE).toBeUndefined();
    expect(calls[0].options.env.PATH).toBe('x');
  });

  it('marketplace-add carries the suite root, not any client-supplied string', async () => {
    const calls: SpawnCall[] = [];
    const res = await appFor(calls).inject({
      method: 'POST',
      url: '/api/repos/repo-a/setup/run',
      headers: deckHeaders,
      // command-shaped extras in the body are ignored -- the item table is the only source
      payload: { itemId: 'plugin-marketplace-add', command: 'rm -rf /' },
    });
    expect(res.statusCode).toBe(200);
    expect(calls[0].args).toContain(SUITE_ROOT);
    expect(calls[0].args.join(' ')).not.toContain('rm -rf');
  });

  it('400s unknown ids, AUTO ids, and a missing itemId -- nothing is spawned', async () => {
    const calls: SpawnCall[] = [];
    const app = appFor(calls);
    for (const payload of [{ itemId: 'nope' }, { itemId: 'chartroom-init' }, {}]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/repos/repo-a/setup/run',
        headers: deckHeaders,
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it('a synchronous spawn failure -> readable 500', async () => {
    const app = buildServer([runtimeFor('repo-a', repoRoot, rebuild(repoRoot))], {
      uiDistDir: join(repoRoot, 'no-such-ui-dist'),
      repoSetup: {
        suiteRoot: SUITE_ROOT,
        spawner: () => {
          throw new Error('spawn wt ENOENT');
        },
        platform: 'win32',
        hasWindowsTerminal: () => true,
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/repos/repo-a/setup/run',
      headers: deckHeaders,
      payload: { itemId: 'plugin-install' },
    });
    expect(res.statusCode).toBe(500);
    expect((res.json() as { error: string }).error).toContain('spawn wt ENOENT');
  });
});
