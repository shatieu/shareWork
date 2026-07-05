import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { computeDocKey, findOwningRepo, openFile } from '../src/commands/open.js';
import { listRepos, registerRepo, type RegisteredRepo } from '../src/daemon/registry.js';
import { writeDaemonInfo } from '../src/daemon/daemon-info.js';
import { emptyIndex, writeIndex } from '../src/index-schema.js';

let fakeHome: string;
let repoRoot: string;

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), 'chartroom-open-test-home-'));
  repoRoot = mkdtempSync(join(tmpdir(), 'chartroom-open-test-repo-'));
  mkdirSync(join(repoRoot, '.git'), { recursive: true }); // findGitRoot marker
});

afterEach(() => {
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(repoRoot, { recursive: true, force: true });
});

/** fetch fake for a daemon serving `repoIds`; records register POSTs and can grow live. */
function fakeDaemon(repoIds: string[], opts: { failRegister?: boolean } = {}) {
  const served = new Set(repoIds);
  const registerCalls: string[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/api/repos') && (!init || !init.method || init.method === 'GET')) {
      return new Response(JSON.stringify([...served].map((id) => ({ id }))), { status: 200 });
    }
    if (url.endsWith('/api/repos/register') && init?.method === 'POST') {
      if (opts.failRegister) {
        return new Response(JSON.stringify({ error: 'nope' }), { status: 501 });
      }
      const { path } = JSON.parse(String(init.body)) as { path: string };
      registerCalls.push(path);
      // The real registrar registers by git root and serves it immediately.
      const entry = registerRepo(path, fakeHome);
      served.add(entry.id);
      return new Response(JSON.stringify({ id: entry.id, name: entry.id, absPath: path, alreadyRegistered: false }), {
        status: 200,
      });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { fetchFn, registerCalls, served };
}

describe('findOwningRepo', () => {
  const repo = (id: string, absPath: string): RegisteredRepo => ({ id, absPath, addedAt: '' });

  it('longest registered absPath prefix wins; path boundaries respected', () => {
    const outer = repo('outer', join(fakeHome, 'work'));
    const inner = repo('inner', join(fakeHome, 'work', 'nested'));
    const sibling = repo('sibling', join(fakeHome, 'work-other'));
    const repos = [outer, inner, sibling];

    expect(findOwningRepo(repos, join(fakeHome, 'work', 'a.md'))?.id).toBe('outer');
    expect(findOwningRepo(repos, join(fakeHome, 'work', 'nested', 'deep', 'b.md'))?.id).toBe('inner');
    // 'work-other' must not be swallowed by the 'work' prefix (boundary-aware containment).
    expect(findOwningRepo(repos, join(fakeHome, 'work-other', 'c.md'))?.id).toBe('sibling');
    expect(findOwningRepo(repos, join(fakeHome, 'elsewhere', 'd.md'))).toBeUndefined();
  });
});

describe('computeDocKey', () => {
  it('returns the frontmatter id when the index maps the path to an identified doc', () => {
    const index = emptyIndex();
    index.docs['my-doc'] = { path: 'docs/a.md', title: 'A', headings: [], outbound: [] };
    writeIndex(repoRoot, index);
    expect(computeDocKey(repoRoot, 'docs/a.md')).toBe('my-doc');
  });

  it('falls back to the path for id-less docs and for repos with no index yet', () => {
    expect(computeDocKey(repoRoot, 'docs/b.md')).toBe('docs/b.md'); // no .docs/index.json at all
    const index = emptyIndex();
    index.docs['my-doc'] = { path: 'docs/a.md', title: 'A', headings: [], outbound: [] };
    writeIndex(repoRoot, index);
    expect(computeDocKey(repoRoot, 'docs/b.md')).toBe('docs/b.md'); // indexed, but not this path
  });
});

describe('openFile decision tree (all seams injected)', () => {
  it('never-registered repo, no daemon: registers, spawns, polls, prints the path-keyed URL', async () => {
    writeFileSync(join(repoRoot, 'note.md'), '# Note\n');
    const daemon = fakeDaemon([]);
    const printed: string[] = [];
    let spawned = 0;

    const code = await openFile(join(repoRoot, 'note.md'), true, {
      homeDir: fakeHome,
      fetchFn: daemon.fetchFn,
      spawnDaemon: () => {
        spawned += 1;
        // Simulate the daemon booting: it reads the registry (which openFile just wrote) and
        // publishes daemon.json.
        for (const r of listRepos(fakeHome)) daemon.served.add(r.id);
        writeDaemonInfo({ port: 4317, pid: 999, startedAt: '' }, fakeHome);
      },
      sleep: async () => {},
      log: (m) => printed.push(m),
      logError: (m) => printed.push(`ERR ${m}`),
    });

    expect(code).toBe(0);
    expect(spawned).toBe(1);
    const repos = listRepos(fakeHome);
    expect(repos).toHaveLength(1);
    expect(printed.at(-1)).toBe(
      `http://127.0.0.1:4317/#/repo/${encodeURIComponent(repos[0].id)}/doc/${encodeURIComponent('note.md')}`,
    );
  });

  it('healthy daemon already serving the repo: no spawn, no register POST, id-keyed URL', async () => {
    const entry = registerRepo(repoRoot, fakeHome);
    writeDaemonInfo({ port: 5000, pid: 1, startedAt: '' }, fakeHome);
    mkdirSync(join(repoRoot, 'docs'), { recursive: true });
    writeFileSync(join(repoRoot, 'docs', 'a.md'), '---\nid: my-doc\n---\n\n# A\n');
    const index = emptyIndex();
    index.docs['my-doc'] = { path: 'docs/a.md', title: 'A', headings: [], outbound: [] };
    writeIndex(repoRoot, index);

    const daemon = fakeDaemon([entry.id]);
    const printed: string[] = [];
    const code = await openFile(join(repoRoot, 'docs', 'a.md'), true, {
      homeDir: fakeHome,
      fetchFn: daemon.fetchFn,
      spawnDaemon: () => {
        throw new Error('must not spawn');
      },
      sleep: async () => {},
      log: (m) => printed.push(m),
      logError: () => {},
    });

    expect(code).toBe(0);
    expect(daemon.registerCalls).toEqual([]);
    expect(printed.at(-1)).toBe(`http://127.0.0.1:5000/#/repo/${encodeURIComponent(entry.id)}/doc/my-doc`);
  });

  it('healthy daemon that predates the repo: live-registers via POST and proceeds on that port', async () => {
    writeFileSync(join(repoRoot, 'note.md'), '# Note\n');
    writeDaemonInfo({ port: 5000, pid: 1, startedAt: '' }, fakeHome);
    const daemon = fakeDaemon(['some-other-repo']);
    const printed: string[] = [];

    const code = await openFile(join(repoRoot, 'note.md'), true, {
      homeDir: fakeHome,
      fetchFn: daemon.fetchFn,
      spawnDaemon: () => {
        throw new Error('must not spawn');
      },
      sleep: async () => {},
      log: (m) => printed.push(m),
      logError: () => {},
    });

    expect(code).toBe(0);
    expect(daemon.registerCalls).toEqual([repoRoot]);
    expect(printed.at(-1)).toContain('http://127.0.0.1:5000/#/repo/');
  });

  it('live registration refused: honest restart guidance, exit 2, never a wrong-daemon URL', async () => {
    writeFileSync(join(repoRoot, 'note.md'), '# Note\n');
    writeDaemonInfo({ port: 5000, pid: 4242, startedAt: '' }, fakeHome);
    const daemon = fakeDaemon(['some-other-repo'], { failRegister: true });
    const errors: string[] = [];

    const code = await openFile(join(repoRoot, 'note.md'), true, {
      homeDir: fakeHome,
      fetchFn: daemon.fetchFn,
      spawnDaemon: () => {
        throw new Error('must not spawn');
      },
      sleep: async () => {},
      log: () => {},
      logError: (m) => errors.push(m),
    });

    expect(code).toBe(2);
    expect(errors.join('\n')).toContain('could not live-register');
    expect(errors.join('\n')).toContain('pid 4242');
  });

  it('file outside any git repo: exit 2 with the NotAGitRepoError message', async () => {
    const loneDir = mkdtempSync(join(tmpdir(), 'chartroom-open-test-nogit-'));
    try {
      writeFileSync(join(loneDir, 'note.md'), '# Note\n');
      const errors: string[] = [];
      const code = await openFile(join(loneDir, 'note.md'), true, {
        homeDir: fakeHome,
        fetchFn: fakeDaemon([]).fetchFn,
        spawnDaemon: () => {},
        sleep: async () => {},
        log: () => {},
        logError: (m) => errors.push(m),
      });
      expect(code).toBe(2);
      expect(errors.join('\n')).toContain('not a git repository');
    } finally {
      rmSync(loneDir, { recursive: true, force: true });
    }
  });

  it('spawn that never produces a healthy daemon: exit 2 after the bounded poll', async () => {
    writeFileSync(join(repoRoot, 'note.md'), '# Note\n');
    const errors: string[] = [];
    const code = await openFile(join(repoRoot, 'note.md'), true, {
      homeDir: fakeHome,
      fetchFn: (async () => new Response('down', { status: 500 })) as typeof fetch,
      spawnDaemon: () => {},
      sleep: async () => {},
      spawnWaitTotalMs: 50,
      spawnPollIntervalMs: 1,
      log: () => {},
      logError: (m) => errors.push(m),
    });
    expect(code).toBe(2);
    expect(errors.join('\n')).toContain('could not start the daemon');
  });
});
