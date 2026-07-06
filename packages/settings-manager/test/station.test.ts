import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { DECK_CLIENT_HEADER, type HostContext } from 'suite-conventions';
import { createSettingsManagerStation } from '../src/station.js';

let app: FastifyInstance;
let home: string;
let project: string;
let outsideProject: string;
let contracts: Record<string, Record<string, unknown>>;

function makeCtx(): HostContext {
  return {
    port: undefined,
    getContract<T>(station: string, name: string): T | undefined {
      return contracts[station]?.[name] as T | undefined;
    },
    log: () => undefined,
  };
}

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'settings-station-'));
  home = join(dir, 'home');
  project = join(dir, 'proj');
  outsideProject = join(dir, 'outside');
  for (const d of [home, join(project, '.claude'), join(outsideProject, '.claude')]) {
    mkdirSync(d, { recursive: true });
  }
  writeFileSync(
    join(project, '.claude', 'settings.json'),
    JSON.stringify({ permissions: { deny: ['Bash(rm *)'], allow: ['Bash(ls *)'] } }, null, 2),
    'utf8',
  );
  contracts = {
    chartroom: {
      listRepoDirs: () => [{ id: 'proj', name: 'proj', absPath: project }],
    },
  };
  app = Fastify({ logger: false });
  const station = createSettingsManagerStation({
    homeDir: home,
    managedPath: join(dir, 'managed-absent.json'),
  });
  await station.registerRoutes(app, makeCtx());
  await app.ready();
});

describe('read-only routes', () => {
  it('GET /scopes lists the four file scopes + registered projects', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/settings-manager/scopes?project=${encodeURIComponent(project)}` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.scopes.map((s: { scope: string }) => s.scope)).toEqual(['managed', 'local', 'project', 'user']);
    expect(body.scopes.find((s: { scope: string }) => s.scope === 'managed').writable).toBe(false);
    expect(body.projects).toHaveLength(1);
  });

  it('GET /effective merges with attribution', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/settings-manager/effective?project=${encodeURIComponent(project)}` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.permissions.deny[0]).toMatchObject({ rule: 'Bash(rm *)', scope: 'project' });
  });

  it('POST /simulate answers the spec question with the deciding rule + file', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings-manager/simulate',
      payload: { project, tool: 'Bash', command: 'rm -rf ./dist' },
    });
    expect(response.statusCode).toBe(200);
    const verdict = response.json();
    expect(verdict.behavior).toBe('deny');
    expect(verdict.decidingRule.rule).toBe('Bash(rm *)');
    expect(verdict.decidingRule.file).toContain('settings.json');
  });

  it('an unregistered project is 403 on reads too', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/settings-manager/scopes?project=${encodeURIComponent(outsideProject)}`,
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('editor routes: the rails over HTTP', () => {
  const NEXT = `${JSON.stringify({ permissions: { deny: ['Bash(rm *)'], allow: ['Bash(ls *)', 'Bash(git status)'] } }, null, 2)}\n`;

  async function previewProject(newContent: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings-manager/preview',
      payload: { scope: 'project', project, newContent },
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it('preview → apply happy path (header required, backup taken)', async () => {
    const preview = await previewProject(NEXT);
    expect(preview.unifiedDiff).toContain('+');

    const noHeader = await app.inject({
      method: 'POST',
      url: '/api/settings-manager/apply',
      payload: { scope: 'project', project, newContent: NEXT, baseHash: preview.baseHash },
    });
    expect(noHeader.statusCode).toBe(403);

    const applied = await app.inject({
      method: 'POST',
      url: '/api/settings-manager/apply',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: { scope: 'project', project, newContent: NEXT, baseHash: preview.baseHash },
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().changed).toBe(true);
    expect(applied.json().backupPath).toContain('settings-backups');
    expect(readFileSync(join(project, '.claude', 'settings.json'), 'utf8')).toBe(NEXT);
  });

  it('base drift = 409 with typed code, file untouched', async () => {
    const preview = await previewProject(NEXT);
    const drifted = '{"permissions":{"allow":["WebFetch"]}}\n';
    writeFileSync(join(project, '.claude', 'settings.json'), drifted, 'utf8');
    const applied = await app.inject({
      method: 'POST',
      url: '/api/settings-manager/apply',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: { scope: 'project', project, newContent: NEXT, baseHash: preview.baseHash },
    });
    expect(applied.statusCode).toBe(409);
    expect(applied.json().code).toBe('base-drift');
    expect(readFileSync(join(project, '.claude', 'settings.json'), 'utf8')).toBe(drifted);
  });

  it('malformed target = 409 typed refusal, byte-identical', async () => {
    const malformed = '{broken';
    writeFileSync(join(project, '.claude', 'settings.json'), malformed, 'utf8');
    const preview = await previewProject(NEXT);
    expect(preview.baseMalformed).toBe(true);
    const applied = await app.inject({
      method: 'POST',
      url: '/api/settings-manager/apply',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: { scope: 'project', project, newContent: NEXT, baseHash: preview.baseHash },
    });
    expect(applied.statusCode).toBe(409);
    expect(applied.json().code).toBe('malformed-target');
    expect(readFileSync(join(project, '.claude', 'settings.json'), 'utf8')).toBe(malformed);
  });

  it('schema violations are 400 and never reach the disk', async () => {
    const bad = '{"permissions": {"allow": "not-an-array"}}';
    const preview = await previewProject(bad);
    expect(preview.validation.ok).toBe(false);
    const before = readFileSync(join(project, '.claude', 'settings.json'), 'utf8');
    const applied = await app.inject({
      method: 'POST',
      url: '/api/settings-manager/apply',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: { scope: 'project', project, newContent: bad, baseHash: preview.baseHash },
    });
    expect(applied.statusCode).toBe(400);
    expect(applied.json().code).toBe('schema-violation');
    expect(readFileSync(join(project, '.claude', 'settings.json'), 'utf8')).toBe(before);
  });

  it('writes to an unregistered project dir are 403; managed scope is not writable at all', async () => {
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/settings-manager/apply',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: { scope: 'local', project: outsideProject, newContent: '{}', baseHash: 'a'.repeat(64) },
    });
    expect(forbidden.statusCode).toBe(403);

    const managed = await app.inject({
      method: 'POST',
      url: '/api/settings-manager/apply',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: { scope: 'managed', project, newContent: '{}', baseHash: 'a'.repeat(64) },
    });
    expect(managed.statusCode).toBe(400); // zod rejects: managed is not a writable scope
  });

  it('user scope needs no project and writes under the injected home', async () => {
    const content = '{"model": "claude-sonnet-5"}\n';
    const preview = await app.inject({
      method: 'POST',
      url: '/api/settings-manager/preview',
      payload: { scope: 'user', newContent: content },
    });
    const applied = await app.inject({
      method: 'POST',
      url: '/api/settings-manager/apply',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: { scope: 'user', newContent: content, baseHash: preview.json().baseHash },
    });
    expect(applied.statusCode).toBe(200);
    expect(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).toBe(content);
  });

  it('GET /file + backups round-trip', async () => {
    const preview = await previewProject(NEXT);
    await app.inject({
      method: 'POST',
      url: '/api/settings-manager/apply',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: { scope: 'project', project, newContent: NEXT, baseHash: preview.baseHash },
    });
    const backups = (await app.inject({ method: 'GET', url: '/api/settings-manager/backups' })).json();
    expect(backups).toHaveLength(1);
    const one = await app.inject({
      method: 'GET',
      url: `/api/settings-manager/backup?id=${encodeURIComponent(backups[0].id)}`,
    });
    expect(one.statusCode).toBe(200);
    expect(one.json().content).toContain('Bash(rm *)');

    const file = await app.inject({
      method: 'GET',
      url: `/api/settings-manager/file?scope=project&project=${encodeURIComponent(project)}`,
    });
    expect(file.json().content).toBe(NEXT);
    expect(file.json().baseHash).toHaveLength(64);
  });
});

describe('template packs + ship integration', () => {
  it('GET /templates serves the curated packs', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/settings-manager/templates' });
    expect(response.json().map((p: { id: string }) => p.id)).toContain('crew-defaults');
  });

  it('POST /templates/preview computes an additive diff for a scope', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings-manager/templates/preview',
      payload: { id: 'read-only-audit', scope: 'local', project },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.addedRules).toBeGreaterThan(0);
    expect(body.preview.unifiedDiff).toContain('+');
    expect(JSON.parse(body.newContent).permissions.deny).toContain('Edit');
  });

  it('always-allowed reflects the ship-inbox contract, empty when unavailable', async () => {
    const before = (await app.inject({ method: 'GET', url: '/api/settings-manager/always-allowed' })).json();
    expect(before).toEqual({ entries: [], available: false });

    contracts['ship-inbox'] = {
      alwaysAllowedRules: () => [
        { rule: 'WebFetch(domain:example.com)', cwd: project, project: 'proj', decidedAt: '2026-07-06T10:00:00Z', backupPath: null },
      ],
    };
    const after = (await app.inject({ method: 'GET', url: '/api/settings-manager/always-allowed' })).json();
    expect(after.available).toBe(true);
    expect(after.entries[0].rule).toBe('WebFetch(domain:example.com)');
  });

  it('revoke/preview removes exactly the one rule from settings.local.json', async () => {
    writeFileSync(
      join(project, '.claude', 'settings.local.json'),
      `${JSON.stringify({ permissions: { allow: ['WebFetch(domain:example.com)', 'Bash(git status)'] } }, null, 2)}\n`,
      'utf8',
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings-manager/revoke/preview',
      payload: { project, rule: 'WebFetch(domain:example.com)' },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(JSON.parse(body.newContent).permissions.allow).toEqual(['Bash(git status)']);
    expect(body.preview.unifiedDiff).toContain('-');

    const missing = await app.inject({
      method: 'POST',
      url: '/api/settings-manager/revoke/preview',
      payload: { project, rule: 'NotThere' },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().code).toBe('rule-not-found');
  });

  it('health reports schema source + counts', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/settings-manager/health' });
    expect(response.json().ok).toBe(true);
    expect(response.json().templates).toBe(4);
  });
});
