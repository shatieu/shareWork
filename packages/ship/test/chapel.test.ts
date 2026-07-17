import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StationDescriptor } from 'suite-conventions';
import { createHull, type Hull } from '../src/hull.js';
import { createChapelBackend, type ChatSpawn, type SpawnTerminalRequest } from '../src/chapel.js';

let home: string;
let chapelDir: string;
let hull: Hull | undefined;
let chapelApps: FastifyInstance[];

/** Every legitimate Deck client attaches the CSRF-proof x-ship-deck header. */
const DECK = { 'x-ship-deck': '1' };

/** Inbox filenames are ISO stamps with dashes, `.md`, optionally a `-<n>` collision counter. */
const STAMP_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-\d+)?\.md$/;

async function buildHull(extra: { repoRoot?: string; stations?: StationDescriptor[] } = {}): Promise<Hull> {
  hull = await createHull(extra.stations ?? [], {
    homeDir: home,
    uiDistDir: join(home, 'no-ui'),
    repoRoot: extra.repoRoot,
  });
  return hull;
}

/** Bare-Fastify chapel app with an injected chat spawn seam (createHull has no seam
 * passthrough on purpose -- the seam is a ChapelOptions-only test affordance). */
async function buildChapelApp(options: { chatSpawn?: ChatSpawn } = {}): Promise<FastifyInstance> {
  const app = Fastify();
  createChapelBackend({ homeDir: home, chatSpawn: options.chatSpawn }).register(app, {
    getContract: () => undefined,
    log: () => {},
  });
  await app.ready();
  chapelApps.push(app);
  return app;
}

function inboxFiles(): string[] {
  try {
    return readdirSync(join(chapelDir, 'inbox'));
  } catch {
    return [];
  }
}

function archiveFiles(): string[] {
  try {
    return readdirSync(join(chapelDir, 'archive'));
  } catch {
    return [];
  }
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ship-chapel-test-'));
  chapelDir = join(home, '.ship', 'chaplain');
  chapelApps = [];
});

afterEach(async () => {
  vi.useRealTimers();
  await hull?.app.close();
  hull = undefined;
  await Promise.all(chapelApps.map((app) => app.close()));
  rmSync(home, { recursive: true, force: true });
});

describe('GET /api/chapel/brief (deck-chapel-tab plan)', () => {
  it('missing brief -> 200 with nulls (routes are always registered), then serves content', async () => {
    const { app } = await buildHull();

    const empty = await app.inject({ method: 'GET', url: '/api/chapel/brief', headers: DECK });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ brief: null, updatedAt: null });

    mkdirSync(chapelDir, { recursive: true });
    writeFileSync(join(chapelDir, 'BRIEF.md'), '# Brief\n\nAll quiet.\n', 'utf8');
    const full = await app.inject({ method: 'GET', url: '/api/chapel/brief', headers: DECK });
    expect(full.statusCode).toBe(200);
    const body = full.json() as { brief: string; updatedAt: string };
    expect(body.brief).toBe('# Brief\n\nAll quiet.\n');
    expect(new Date(body.updatedAt).toISOString()).toBe(body.updatedAt);
  });
});

describe('GET /api/chapel/projects[/:id]', () => {
  it('no projects dir -> empty list; dossier files -> sorted ids + updatedAt', async () => {
    const { app } = await buildHull();

    const empty = await app.inject({ method: 'GET', url: '/api/chapel/projects', headers: DECK });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ projects: [] });

    mkdirSync(join(chapelDir, 'projects'), { recursive: true });
    writeFileSync(join(chapelDir, 'projects', 'sharework.md'), '# shareWork\n', 'utf8');
    writeFileSync(join(chapelDir, 'projects', '_chapel.md'), '# orphans\n', 'utf8');
    writeFileSync(join(chapelDir, 'projects', 'notes.txt'), 'not a dossier', 'utf8');

    const listed = (await app.inject({ method: 'GET', url: '/api/chapel/projects', headers: DECK })).json() as {
      projects: { id: string; updatedAt: string }[];
    };
    expect(listed.projects.map((p) => p.id)).toEqual(['_chapel', 'sharework']);
    for (const project of listed.projects) {
      expect(new Date(project.updatedAt).toISOString()).toBe(project.updatedAt);
    }
  });

  it('serves one dossier by id; unknown or traversal-shaped ids -> 404', async () => {
    const { app } = await buildHull();
    mkdirSync(join(chapelDir, 'projects'), { recursive: true });
    writeFileSync(join(chapelDir, 'projects', 'sharework.md'), '## Now\nsteady\n', 'utf8');
    // A file a traversal-shaped id would reach if :id were ever joined unchecked.
    writeFileSync(join(chapelDir, 'secret.md'), 'not yours', 'utf8');

    const ok = await app.inject({ method: 'GET', url: '/api/chapel/projects/sharework', headers: DECK });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id: 'sharework', content: '## Now\nsteady\n' });

    const missing = await app.inject({ method: 'GET', url: '/api/chapel/projects/nope', headers: DECK });
    expect(missing.statusCode).toBe(404);

    const traversal = await app.inject({
      method: 'GET',
      url: '/api/chapel/projects/..%2Fsecret',
      headers: DECK,
    });
    expect(traversal.statusCode).toBe(404);
  });
});

describe('POST /api/chapel/confess', () => {
  it('writes a stamp-named inbox file with the text verbatim', async () => {
    const { app } = await buildHull();
    const text = 'Feeling adrift on package 16.\n\n:::note\nverbatim? *yes*\n:::\n';

    const res = await app.inject({ method: 'POST', url: '/api/chapel/confess', headers: DECK, payload: { text } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ ok: true });

    const files = inboxFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(STAMP_NAME);
    expect(readFileSync(join(chapelDir, 'inbox', files[0]), 'utf8')).toBe(text);
  });

  it('sanitizes project to [a-z0-9-] in the body line and NEVER puts it in the filename (risk r1)', async () => {
    const { app } = await buildHull();

    const res = await app.inject({
      method: 'POST',
      url: '/api/chapel/confess',
      headers: DECK,
      payload: { text: 'note for the dossier', project: '../..\\Evil PROJECT_42!' },
    });
    expect(res.statusCode).toBe(201);

    const files = inboxFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(STAMP_NAME); // stamp-derived only; nothing project-shaped
    const body = readFileSync(join(chapelDir, 'inbox', files[0]), 'utf8');
    expect(body).toBe('project: evilproject42\n\nnote for the dossier');
    // Nothing escaped the inbox/archive pair: the chapel dir holds only the expected entries.
    expect(readdirSync(chapelDir).sort()).toEqual(['archive', 'inbox']);
  });

  it('ALSO writes a durable archive copy (same stamp name, same content) -- inbox stays the queue', async () => {
    const { app } = await buildHull();
    const res = await app.inject({
      method: 'POST',
      url: '/api/chapel/confess',
      headers: DECK,
      payload: { text: 'the wave ran long', project: 'sharework' },
    });
    expect(res.statusCode).toBe(201);

    const inbox = inboxFiles();
    const archive = archiveFiles();
    expect(inbox).toHaveLength(1);
    expect(archive).toEqual(inbox);
    expect(readFileSync(join(chapelDir, 'archive', archive[0]), 'utf8')).toBe(
      'project: sharework\n\nthe wave ran long',
    );
  });

  it('empty or whitespace-only text -> 400 and nothing written', async () => {
    const { app } = await buildHull();
    for (const text of ['', '   \n\t']) {
      const res = await app.inject({ method: 'POST', url: '/api/chapel/confess', headers: DECK, payload: { text } });
      expect(res.statusCode).toBe(400);
    }
    const missing = await app.inject({ method: 'POST', url: '/api/chapel/confess', headers: DECK, payload: {} });
    expect(missing.statusCode).toBe(400);
    expect(inboxFiles()).toHaveLength(0);
  });

  it('two confessions in the same millisecond get distinct stamp-derived names', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-09T10:00:00.000Z'));
    const { app } = await buildHull();

    for (const text of ['first', 'second']) {
      const res = await app.inject({ method: 'POST', url: '/api/chapel/confess', headers: DECK, payload: { text } });
      expect(res.statusCode).toBe(201);
    }

    expect(inboxFiles().sort()).toEqual(['2026-07-09T10-00-00-000Z-1.md', '2026-07-09T10-00-00-000Z.md']);
  });
});

describe('GET /api/chapel/confessions[/:stamp] (archive history)', () => {
  it('lists archive entries newest-first with parsed project + single-line excerpt', async () => {
    const { app } = await buildHull();
    mkdirSync(join(chapelDir, 'archive'), { recursive: true });
    writeFileSync(
      join(chapelDir, 'archive', '2026-07-01T10-00-00-000Z.md'),
      'project: sharework\n\nfirst sin',
      'utf8',
    );
    writeFileSync(join(chapelDir, 'archive', '2026-07-02T10-00-00-000Z.md'), 'plain worry\nsecond line', 'utf8');
    writeFileSync(join(chapelDir, 'archive', 'notes.txt'), 'not a confession', 'utf8');

    const res = await app.inject({ method: 'GET', url: '/api/chapel/confessions', headers: DECK });
    expect(res.statusCode).toBe(200);
    const { confessions } = res.json() as {
      confessions: { stamp: string; project: string | null; excerpt: string; updatedAt: string }[];
    };
    expect(confessions.map((c) => c.stamp)).toEqual(['2026-07-02T10-00-00-000Z', '2026-07-01T10-00-00-000Z']);
    expect(confessions[0]).toMatchObject({ project: null, excerpt: 'plain worry second line' });
    expect(confessions[1]).toMatchObject({ project: 'sharework', excerpt: 'first sin' });
    for (const confession of confessions) {
      expect(new Date(confession.updatedAt).toISOString()).toBe(confession.updatedAt);
    }
  });

  it('no archive dir yet -> empty list (a normal pre-first-confession state)', async () => {
    const { app } = await buildHull();
    const res = await app.inject({ method: 'GET', url: '/api/chapel/confessions', headers: DECK });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ confessions: [] });
  });

  it('serves one confession in full; unknown or traversal-shaped stamps -> 404', async () => {
    const { app } = await buildHull();
    mkdirSync(join(chapelDir, 'archive'), { recursive: true });
    writeFileSync(
      join(chapelDir, 'archive', '2026-07-01T10-00-00-000Z.md'),
      'project: sharework\n\nfirst sin\n\nsecond paragraph',
      'utf8',
    );
    // A file a traversal-shaped stamp would reach if :stamp were ever joined unchecked.
    writeFileSync(join(chapelDir, 'secret.md'), 'not yours', 'utf8');

    const ok = await app.inject({
      method: 'GET',
      url: '/api/chapel/confessions/2026-07-01T10-00-00-000Z',
      headers: DECK,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({
      stamp: '2026-07-01T10-00-00-000Z',
      project: 'sharework',
      text: 'first sin\n\nsecond paragraph',
    });

    const missing = await app.inject({
      method: 'GET',
      url: '/api/chapel/confessions/2026-01-01T00-00-00-000Z',
      headers: DECK,
    });
    expect(missing.statusCode).toBe(404);

    const traversal = await app.inject({ method: 'GET', url: '/api/chapel/confessions/..%2Fsecret', headers: DECK });
    expect(traversal.statusCode).toBe(404);
  });

  it('a confession dropped via POST /api/chapel/confess appears in the listing', async () => {
    const { app } = await buildHull();
    await app.inject({
      method: 'POST',
      url: '/api/chapel/confess',
      headers: DECK,
      payload: { text: 'listing round-trip', project: 'sharework' },
    });
    const { confessions } = (await app.inject({ method: 'GET', url: '/api/chapel/confessions', headers: DECK })).json() as {
      confessions: { stamp: string; project: string | null; excerpt: string }[];
    };
    expect(confessions).toHaveLength(1);
    expect(confessions[0]).toMatchObject({ project: 'sharework', excerpt: 'listing round-trip' });
  });
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A well-behaved chat spawn: records every call, echoes the session id it was handed (via
 * `--session-id` or `--resume`) the way `claude --output-format json` reports `session_id`. */
function recordingSpawn(reply = 'Peace, Captain.') {
  const calls: { binary: string; args: string[]; timeoutMs: number }[] = [];
  const spawn: ChatSpawn = async (binary, args, opts) => {
    calls.push({ binary, args, timeoutMs: opts.timeoutMs });
    const idFlag = args.indexOf('--session-id');
    const resumeFlag = args.indexOf('--resume');
    const sessionId = idFlag >= 0 ? args[idFlag + 1] : args[resumeFlag + 1];
    return { stdout: `${JSON.stringify({ result: reply, session_id: sessionId })}\n`, stderr: '', code: 0 };
  };
  return { calls, spawn };
}

describe('POST /api/chapel/chat (dedicated chat session, spawn seam)', () => {
  it('first message mints a session id: FIXED argv shape, hostile body fields cannot steer it', async () => {
    const { calls, spawn } = recordingSpawn();
    const app = await buildChapelApp({ chatSpawn: spawn });

    const res = await app.inject({
      method: 'POST',
      url: '/api/chapel/chat',
      headers: DECK,
      payload: {
        text: 'bless the wave',
        argv: ['rm', '-rf', '/'],
        cwd: 'C:\\evil',
        sessionId: '../../evil',
        agent: 'evil:agent',
      },
    });
    expect(res.statusCode).toBe(200);

    expect(calls).toHaveLength(1);
    const { args } = calls[0];
    expect(args.slice(0, 4)).toEqual(['-p', 'bless the wave', '--agent', 'ship-crew:chaplain']);
    expect(args[4]).toBe('--session-id');
    expect(args[5]).toMatch(UUID); // minted server-side, never the body's `sessionId`
    expect(args.slice(6)).toEqual(['--output-format', 'json']);

    const body = res.json() as { reply: string; sessionId: string };
    expect(body.reply).toBe('Peace, Captain.');
    expect(body.sessionId).toBe(args[5]);
    // The dedicated chat session id is persisted for the next send.
    const stored = JSON.parse(readFileSync(join(chapelDir, 'chat-session.json'), 'utf8')) as { sessionId: string };
    expect(stored.sessionId).toBe(args[5]);
  });

  it('later messages --resume the stored session id instead of minting one', async () => {
    mkdirSync(chapelDir, { recursive: true });
    writeFileSync(join(chapelDir, 'chat-session.json'), JSON.stringify({ sessionId: 'stored-chat-session' }), 'utf8');
    const { calls, spawn } = recordingSpawn('Still with you.');
    const app = await buildChapelApp({ chatSpawn: spawn });

    const res = await app.inject({ method: 'POST', url: '/api/chapel/chat', headers: DECK, payload: { text: 'again' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ reply: 'Still with you.', sessionId: 'stored-chat-session' });

    const { args } = calls[0];
    expect(args).toEqual([
      '-p',
      'again',
      '--agent',
      'ship-crew:chaplain',
      '--resume',
      'stored-chat-session',
      '--output-format',
      'json',
    ]);
  });

  it('persists the conversation to chat-log.jsonl and serves it from GET /api/chapel/chat/log', async () => {
    const { spawn } = recordingSpawn('Courage.');
    const app = await buildChapelApp({ chatSpawn: spawn });

    await app.inject({ method: 'POST', url: '/api/chapel/chat', headers: DECK, payload: { text: 'am I on course?' } });
    const res = await app.inject({ method: 'GET', url: '/api/chapel/chat/log', headers: DECK });
    expect(res.statusCode).toBe(200);
    const { messages } = res.json() as { messages: { role: string; text: string; at: string }[] };
    expect(messages.map((m) => [m.role, m.text])).toEqual([
      ['captain', 'am I on course?'],
      ['chaplain', 'Courage.'],
    ]);
    for (const message of messages) {
      expect(new Date(message.at).toISOString()).toBe(message.at);
    }

    // Reload survival: a FRESH backend over the same home serves the same history.
    const reloaded = await buildChapelApp({ chatSpawn: spawn });
    const again = await reloaded.inject({ method: 'GET', url: '/api/chapel/chat/log', headers: DECK });
    expect((again.json() as { messages: unknown[] }).messages).toHaveLength(2);
  });

  it('empty log is 200 { messages: [] }, and a torn line loses only itself', async () => {
    const app = await buildChapelApp();
    const empty = await app.inject({ method: 'GET', url: '/api/chapel/chat/log', headers: DECK });
    expect(empty.json()).toEqual({ messages: [] });

    mkdirSync(chapelDir, { recursive: true });
    writeFileSync(
      join(chapelDir, 'chat-log.jsonl'),
      `${JSON.stringify({ role: 'captain', text: 'kept', at: '2026-07-17T00:00:00.000Z' })}\n{torn`,
      'utf8',
    );
    const partial = await app.inject({ method: 'GET', url: '/api/chapel/chat/log', headers: DECK });
    expect((partial.json() as { messages: { text: string }[] }).messages.map((m) => m.text)).toEqual(['kept']);
  });

  it('a rejecting spawn -> readable 500, nothing logged, and the NEXT send still works', async () => {
    let fail = true;
    const { calls, spawn } = recordingSpawn();
    const flaky: ChatSpawn = async (binary, args, opts) => {
      if (fail) {
        fail = false;
        throw new Error('spawn claude ENOENT');
      }
      return spawn(binary, args, opts);
    };
    const app = await buildChapelApp({ chatSpawn: flaky });

    const failed = await app.inject({ method: 'POST', url: '/api/chapel/chat', headers: DECK, payload: { text: 'hello?' } });
    expect(failed.statusCode).toBe(500);
    expect((failed.json() as { error: string }).error).toContain('spawn claude ENOENT');
    const log = await app.inject({ method: 'GET', url: '/api/chapel/chat/log', headers: DECK });
    expect(log.json()).toEqual({ messages: [] });

    const retry = await app.inject({ method: 'POST', url: '/api/chapel/chat', headers: DECK, payload: { text: 'retry' } });
    expect(retry.statusCode).toBe(200); // the serializer chain survived the failure
    expect(calls).toHaveLength(1);
  });

  it('a non-zero exit -> 500 carrying the exit code and a stderr excerpt', async () => {
    const app = await buildChapelApp({
      chatSpawn: async () => ({ stdout: '', stderr: 'invalid api key\n', code: 1 }),
    });
    const res = await app.inject({ method: 'POST', url: '/api/chapel/chat', headers: DECK, payload: { text: 'hm' } });
    expect(res.statusCode).toBe(500);
    const { error } = res.json() as { error: string };
    expect(error).toContain('code 1');
    expect(error).toContain('invalid api key');
  });

  it('non-JSON stdout is served verbatim (older CLI fallback)', async () => {
    const app = await buildChapelApp({
      chatSpawn: async () => ({ stdout: 'plain words\n', stderr: '', code: 0 }),
    });
    const res = await app.inject({ method: 'POST', url: '/api/chapel/chat', headers: DECK, payload: { text: 'hm' } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { reply: string }).reply).toBe('plain words');
  });

  it('empty or missing text -> 400 and the spawn is never invoked', async () => {
    const { calls, spawn } = recordingSpawn();
    const app = await buildChapelApp({ chatSpawn: spawn });
    for (const payload of [{ text: '' }, { text: '   \n' }, {}]) {
      const res = await app.inject({ method: 'POST', url: '/api/chapel/chat', headers: DECK, payload });
      expect(res.statusCode).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });
});

describe('POST /api/chapel/session (spawn seam, risk r2)', () => {
  it('501 with a readable message when no chartroom spawnTerminal contract is mounted', async () => {
    const { app } = await buildHull();
    const res = await app.inject({ method: 'POST', url: '/api/chapel/session', headers: DECK });
    expect(res.statusCode).toBe(501);
    expect((res.json() as { error: string }).error).toContain('chartroom');
  });

  it('spawns via getContract with the FIXED chaplain argv in the hull repoRoot -- body cannot steer it', async () => {
    const calls: SpawnTerminalRequest[] = [];
    const station: StationDescriptor = {
      name: 'chartroom',
      registerRoutes() {},
      contracts: { spawnTerminal: (request: SpawnTerminalRequest) => calls.push(request) },
    };
    const repoRoot = join(home, 'repo');
    const { app } = await buildHull({ repoRoot, stations: [station] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/chapel/session',
      headers: DECK,
      payload: { argv: ['rm', '-rf', '/'], cwd: 'C:\\evil' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    expect(calls).toHaveLength(1);
    expect(calls[0].argv).toEqual(['claude', '--agent', 'ship-crew:chaplain']);
    expect(calls[0].cwd).toBe(repoRoot);
  });

  it('a throwing spawn contract -> readable 500', async () => {
    const station: StationDescriptor = {
      name: 'chartroom',
      registerRoutes() {},
      contracts: {
        spawnTerminal: () => {
          throw new Error('spawn wt ENOENT');
        },
      },
    };
    const { app } = await buildHull({ stations: [station] });
    const res = await app.inject({ method: 'POST', url: '/api/chapel/session', headers: DECK });
    expect(res.statusCode).toBe(500);
    expect((res.json() as { error: string }).error).toContain('spawn wt ENOENT');
  });
});

describe('x-ship-deck guard on every chapel route', () => {
  it('403 without the header, and no side effects', async () => {
    const { app } = await buildHull();
    const routes: { method: 'GET' | 'POST'; url: string }[] = [
      { method: 'GET', url: '/api/chapel/brief' },
      { method: 'GET', url: '/api/chapel/projects' },
      { method: 'GET', url: '/api/chapel/projects/sharework' },
      { method: 'GET', url: '/api/chapel/confessions' },
      { method: 'GET', url: '/api/chapel/confessions/2026-07-01T10-00-00-000Z' },
      { method: 'GET', url: '/api/chapel/chat/log' },
      { method: 'POST', url: '/api/chapel/chat' },
      { method: 'POST', url: '/api/chapel/confess' },
      { method: 'POST', url: '/api/chapel/session' },
    ];
    for (const route of routes) {
      const res = await app.inject({
        ...route,
        ...(route.method === 'POST' ? { payload: { text: 'sneaky' } } : {}),
      });
      expect(res.statusCode, route.url).toBe(403);
      expect((res.json() as { error: string }).error).toContain('x-ship-deck');
    }
    expect(inboxFiles()).toHaveLength(0);
  });
});
