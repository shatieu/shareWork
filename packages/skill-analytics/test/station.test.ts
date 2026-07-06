import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DECK_CLIENT_HEADER, type HostContext } from 'suite-conventions';
import { createSkillAnalyticsStation, type SkillAnalyticsStation } from '../src/station.js';
import type { Summary } from '../src/report.js';
import {
  assistantSkillLine,
  makeClaudeDir,
  makeHomeDir,
  userCommandLine,
  writeTranscript,
} from './fixtures.js';

let app: FastifyInstance;
let station: SkillAnalyticsStation;
let home: string;
let claude: { root: string; projectDir: string };

const fakeCtx: HostContext = {
  port: undefined,
  getContract: () => undefined,
  log: () => {},
};

async function boot() {
  station = createSkillAnalyticsStation({ homeDir: home, claudeDir: claude.root });
  app = Fastify({ logger: false });
  await station.registerRoutes(app, fakeCtx);
  await app.ready();
}

beforeEach(() => {
  home = makeHomeDir();
  claude = makeClaudeDir();
});

afterEach(async () => {
  await app?.close();
  await station?.stop?.();
});

describe('skill-analytics station', () => {
  it('has no Deck tab (console package owns tab routing) and offers the getSummary contract', async () => {
    await boot();
    expect(station.tab).toBeUndefined();
    expect(station.name).toBe('skill-analytics');
    const getSummary = station.contracts?.getSummary as (() => Summary) | undefined;
    expect(typeof getSummary).toBe('function');
    expect(getSummary!()).toMatchObject({ totals: { invocations: 0 } });
  });

  it('POST /collect requires the deck header and then ingests transcripts', async () => {
    writeTranscript(claude.projectDir, 's1.jsonl', [
      assistantSkillLine('lookout', { input: 10, output: 5 }),
      userCommandLine('model'),
    ]);
    await boot();

    const denied = await app.inject({ method: 'POST', url: '/api/skill-analytics/collect' });
    expect(denied.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/skill-analytics/collect',
      headers: { [DECK_CLIENT_HEADER]: '1' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ filesSeen: 1, newInvocations: 2 });
  });

  it('GET /summary serves the dashboard payload the console renders', async () => {
    writeTranscript(claude.projectDir, 's1.jsonl', [
      assistantSkillLine('lookout', { input: 10, output: 5 }),
      assistantSkillLine('lookout', { input: 1, output: 1 }),
      userCommandLine('lookout'),
    ]);
    await boot();
    station.collect();

    const res = await app.inject({ method: 'GET', url: '/api/skill-analytics/summary' });
    expect(res.statusCode).toBe(200);
    const summary = res.json() as Summary;
    expect(summary.totals.invocations).toBe(3);
    const row = summary.skills.find((r) => r.name === 'lookout')!;
    expect(row).toMatchObject({ total: 3, proactive: 2, explicit: 1 });
    expect(summary.trend.length).toBeGreaterThan(0);
  });

  it('GET /summary honours project and days filters via querystring', async () => {
    writeTranscript(claude.projectDir, 's1.jsonl', [
      assistantSkillLine('a', {}, { cwd: 'C:\\repos\\alpha', timestamp: '2026-01-01T00:00:00.000Z' }),
      assistantSkillLine('b', {}, { cwd: 'C:\\repos\\beta' }),
    ]);
    await boot();
    station.collect();

    const res = await app.inject({ method: 'GET', url: '/api/skill-analytics/summary?project=beta' });
    expect((res.json() as Summary).skills.map((r) => r.name)).toEqual(['b']);
  });

  it('GET /dead and /health respond', async () => {
    await boot();
    const dead = await app.inject({ method: 'GET', url: '/api/skill-analytics/dead?days=30' });
    expect(dead.statusCode).toBe(200);
    expect(Array.isArray(dead.json())).toBe(true);

    const health = await app.inject({ method: 'GET', url: '/api/skill-analytics/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ ok: true, claudeDir: claude.root });
  });
});
