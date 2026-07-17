import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DECK_CLIENT_HEADER, type HostContext } from 'suite-conventions';
import { listAskHumanSessions, writeAskHumanAnswers } from '../src/askhuman.js';
import { createShipInboxStation, type ShipInboxStation } from '../src/station.js';

/** wave2-E item 4: the hull-side ask-human bridge. answers.json must be BYTE-compatible with
 * the skill's own standalone server (`.claude/skills/ask-human/bin/server.mjs::handleSubmit`,
 * lines 97-111) so the skill's step-4 readback works unchanged. */

let home: string;
let repo: string;
let station: ShipInboxStation;
let app: FastifyInstance;

const HDR = { [DECK_CLIENT_HEADER]: '1' };
const ctx: HostContext = { port: undefined, getContract: () => undefined, log: () => {} };

const SPEC = [
  {
    id: 'auth-strategy',
    type: 'single-select',
    prompt: 'Which auth strategy?',
    choices: [
      { value: 'jwt-cookie', label: 'JWT in an httpOnly cookie' },
      { value: 'session', label: 'Server-side sessions' },
    ],
  },
  { id: 'notes', type: 'text', prompt: 'Anything else?' },
  {
    id: 'priorities',
    type: 'ranking',
    prompt: 'Rank these',
    choices: [
      { value: 'perf', label: 'Performance' },
      { value: 'dx', label: 'DX' },
      { value: 'cost', label: 'Cost' },
    ],
  },
  { id: 'confidence', type: 'rating', prompt: 'How confident?', min: 1, max: 10 },
];

function seedSession(sessionId: string, spec: unknown = SPEC): string {
  const dir = join(repo, '.claude', 'ask-human', 'sessions', sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'spec.json'), JSON.stringify(spec, null, 2));
  return dir;
}

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'ship-inbox-ah-home-'));
  repo = mkdtempSync(join(tmpdir(), 'ship-inbox-ah-repo-'));
  station = createShipInboxStation({ homeDir: home });
  app = Fastify({ logger: false });
  await station.registerRoutes(app, ctx);
});

afterEach(async () => {
  await app.close();
  await station.stop?.();
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

describe('GET /api/ship-inbox/askhuman (session list)', () => {
  it('lists sessions with pending/answered state; invalid specs are skipped, never a 500', async () => {
    seedSession('auth-strategy');
    const answeredDir = seedSession('done-one');
    writeFileSync(join(answeredDir, 'answers.json'), '[]');
    const brokenDir = join(repo, '.claude', 'ask-human', 'sessions', 'broken');
    mkdirSync(brokenDir, { recursive: true });
    writeFileSync(join(brokenDir, 'spec.json'), '{not json');

    const res = await app.inject({
      method: 'GET',
      url: `/api/ship-inbox/askhuman?cwd=${encodeURIComponent(repo)}`,
      headers: HDR,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().sessions).toEqual([
      { sessionId: 'auth-strategy', questionCount: 4, answered: false },
      { sessionId: 'done-one', questionCount: 4, answered: true },
    ]);
  });

  it('requires the deck header (the cwd comes from the query string)', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/ship-inbox/askhuman?cwd=${encodeURIComponent(repo)}` });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/ship-inbox/askhuman/spec', () => {
  it('serves the parsed spec; 404 for a missing session; 400 for a traversal-shaped id', async () => {
    seedSession('auth-strategy');
    const ok = await app.inject({
      method: 'GET',
      url: `/api/ship-inbox/askhuman/spec?cwd=${encodeURIComponent(repo)}&session=auth-strategy`,
      headers: HDR,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ sessionId: 'auth-strategy' });
    expect(ok.json().questions).toEqual(SPEC);

    const missing = await app.inject({
      method: 'GET',
      url: `/api/ship-inbox/askhuman/spec?cwd=${encodeURIComponent(repo)}&session=nope`,
      headers: HDR,
    });
    expect(missing.statusCode).toBe(404);

    const traversal = await app.inject({
      method: 'GET',
      url: `/api/ship-inbox/askhuman/spec?cwd=${encodeURIComponent(repo)}&session=${encodeURIComponent('../../etc')}`,
      headers: HDR,
    });
    expect(traversal.statusCode).toBe(400);
  });
});

describe('POST /api/ship-inbox/askhuman/answers -- byte compatibility', () => {
  it('writes answers.json byte-identical to the skill server format (golden), attachments decoded', async () => {
    const dir = seedSession('auth-strategy');
    const res = await app.inject({
      method: 'POST',
      url: '/api/ship-inbox/askhuman/answers',
      headers: HDR,
      payload: {
        cwd: repo,
        session: 'auth-strategy',
        answers: [
          {
            id: 'auth-strategy',
            type: 'single-select',
            value: 'jwt-cookie',
            attachments: [{ filename: 'shot one.png', dataUrl: 'data:image/png;base64,aGk=' }],
          },
          { id: 'notes', type: 'text', value: 'ship it' },
          { id: 'priorities', type: 'ranking', value: ['perf', 'dx', 'cost'] },
          { id: 'confidence', type: 'rating', value: 8 },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, path: join(dir, 'answers.json') });

    // Golden bytes: exactly what bin/server.mjs::handleSubmit writes --
    // JSON.stringify(finalAnswers, null, 2), {id,type,value,attachments} key order, sanitized
    // attachment filename (space -> _), forward-slash relative path, no trailing newline.
    const expected = `[
  {
    "id": "auth-strategy",
    "type": "single-select",
    "value": "jwt-cookie",
    "attachments": [
      "attachments/auth-strategy__0__shot_one.png"
    ]
  },
  {
    "id": "notes",
    "type": "text",
    "value": "ship it",
    "attachments": []
  },
  {
    "id": "priorities",
    "type": "ranking",
    "value": [
      "perf",
      "dx",
      "cost"
    ],
    "attachments": []
  },
  {
    "id": "confidence",
    "type": "rating",
    "value": 8,
    "attachments": []
  }
]`;
    expect(readFileSync(join(dir, 'answers.json'), 'utf8')).toBe(expected);
    // The data URL was decoded to real bytes, exactly like the skill server.
    expect(readFileSync(join(dir, 'attachments', 'auth-strategy__0__shot_one.png'), 'utf8')).toBe('hi');
    // The session now reads as answered.
    expect(listAskHumanSessions(repo)).toEqual([{ sessionId: 'auth-strategy', questionCount: 4, answered: true }]);
  });

  it('404 when no spec exists; 400 on a malformed body', async () => {
    const noSpec = await app.inject({
      method: 'POST',
      url: '/api/ship-inbox/askhuman/answers',
      headers: HDR,
      payload: { cwd: repo, session: 'ghost', answers: [{ id: 'a', type: 'text', value: 'x' }] },
    });
    expect(noSpec.statusCode).toBe(404);

    seedSession('auth-strategy');
    const badBody = await app.inject({
      method: 'POST',
      url: '/api/ship-inbox/askhuman/answers',
      headers: HDR,
      payload: { cwd: repo, session: 'auth-strategy', answers: [{ id: 'a', type: 'text', value: { nested: true } }] },
    });
    expect(badBody.statusCode).toBe(400);
  });

  it('writeAskHumanAnswers refuses a traversal-shaped session id', () => {
    expect(() => writeAskHumanAnswers(repo, '../evil', [{ id: 'a', type: 'text', value: 'x' }])).toThrow(/invalid/);
  });
});

describe('GET /api/ship-inbox/items askHumanPending', () => {
  it('open questions carry the pending ask-human session ids found under their cwd', async () => {
    seedSession('auth-strategy');
    const answered = seedSession('done-one');
    writeFileSync(join(answered, 'answers.json'), '[]');

    const consumer = station.contracts?.hookEventConsumer as {
      consume(envelope: Record<string, unknown>): void;
    };
    consumer.consume({
      hook_event_name: 'Notification',
      session_id: 'sess-q1',
      cwd: repo,
      payload: { notification_type: 'agent_needs_input', message: 'Answer my form please' },
    });

    const res = await app.inject({ method: 'GET', url: '/api/ship-inbox/items' });
    expect(res.statusCode).toBe(200);
    const [question] = res.json().questions;
    expect(question).toMatchObject({
      message: 'Answer my form please',
      askHumanPending: ['auth-strategy'],
    });
  });
});
