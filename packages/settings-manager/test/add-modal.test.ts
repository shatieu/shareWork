import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { DECK_CLIENT_HEADER, type HostContext } from 'suite-conventions';
import { getCatalog, RULE_TEMPLATES, SETTINGS_CATALOG } from '../src/catalog.js';
import { computeAddSettings, SettingsEditError } from '../src/editor.js';
import { KNOWN_TOP_LEVEL, PERMISSION_MODES, structuralSchema } from '../src/schema.js';
import { parseRule } from '../src/rules.js';
import { createSettingsManagerStation } from '../src/station.js';

/** Package 14 (plan 14): the add-modal's catalog + batched add computation + station routes. */

describe('catalog stays pinned to the validator', () => {
  it('every catalog key exists in KNOWN_TOP_LEVEL with the identical kind (defaultMode excepted)', () => {
    for (const entry of SETTINGS_CATALOG) {
      if (entry.key === 'permissions.defaultMode') continue; // the one nested entry (plan 14)
      expect(KNOWN_TOP_LEVEL[entry.key], `catalog key '${entry.key}' unknown to schema.ts`).toBeDefined();
      expect(entry.kind, `catalog kind for '${entry.key}' drifted`).toBe(KNOWN_TOP_LEVEL[entry.key]);
    }
  });

  it('excludes $schema and the raw permissions object; includes defaultMode with the documented modes', () => {
    const keys = SETTINGS_CATALOG.map((entry) => entry.key);
    expect(keys).not.toContain('$schema');
    expect(keys).not.toContain('permissions');
    const mode = SETTINGS_CATALOG.find((entry) => entry.key === 'permissions.defaultMode');
    expect(mode?.enumValues).toEqual(PERMISSION_MODES);
  });

  it('every entry has a description and a defaultValue matching its own kind (schema-checkable)', () => {
    for (const entry of SETTINGS_CATALOG) {
      expect(entry.description.length, entry.key).toBeGreaterThan(8);
      if (entry.key === 'permissions.defaultMode') continue;
      // A document made of just this default must pass the structural schema.
      const result = structuralSchema.validate({ [entry.key]: entry.defaultValue });
      expect(result.errors, `default for '${entry.key}' fails its own schema`).toEqual([]);
    }
  });

  it('every rule template parses as a plausible rule and names a default list', () => {
    for (const template of RULE_TEMPLATES) {
      expect(parseRule(template.rule), template.id).toBeDefined();
      expect(['allow', 'deny', 'ask']).toContain(template.defaultList);
    }
  });

  it('getCatalog bundles settings + templates + modes', () => {
    const catalog = getCatalog();
    expect(catalog.settings.length).toBeGreaterThan(60);
    expect(catalog.ruleTemplates.length).toBe(RULE_TEMPLATES.length);
    expect(catalog.modes).toEqual(PERMISSION_MODES);
  });
});

describe('computeAddSettings (the batched add, pure)', () => {
  const CURRENT = JSON.stringify(
    {
      model: 'opus',
      permissions: { allow: ['Read'], deny: ['WebSearch'], defaultMode: 'plan' },
      env: { KEEP: 'me' },
    },
    null,
    2,
  );

  it('adds new keys, overwrites existing ones, appends rules -- and reports which was which', () => {
    const result = computeAddSettings(CURRENT, {
      values: { cleanupPeriodDays: 20, model: 'claude-sonnet-5' },
      defaultMode: 'acceptEdits',
      permissions: { allow: ['Bash(git status)', 'Read'], ask: ['Bash(git push *)'] },
    });
    const next = JSON.parse(result.newContent);
    expect(next.cleanupPeriodDays).toBe(20);
    expect(next.model).toBe('claude-sonnet-5');
    expect(next.env).toEqual({ KEEP: 'me' });
    expect(next.permissions.allow).toEqual(['Read', 'Bash(git status)']); // 'Read' deduped
    expect(next.permissions.ask).toEqual(['Bash(git push *)']);
    expect(next.permissions.deny).toEqual(['WebSearch']);
    expect(next.permissions.defaultMode).toBe('acceptEdits');
    expect(result.addedKeys).toEqual(['cleanupPeriodDays']);
    expect(result.overwrittenKeys).toEqual(['model', 'permissions.defaultMode']);
    expect(result.addedRules).toBe(2);
  });

  it('starts a fresh document from a missing file', () => {
    const result = computeAddSettings(undefined, {
      values: { alwaysThinkingEnabled: true },
      defaultMode: 'default',
      permissions: { deny: ['Bash(rm *)'] },
    });
    const next = JSON.parse(result.newContent);
    expect(next).toEqual({
      alwaysThinkingEnabled: true,
      permissions: { deny: ['Bash(rm *)'], defaultMode: 'default' },
    });
    expect(result.addedKeys).toEqual(['alwaysThinkingEnabled', 'permissions.defaultMode']);
    expect(result.overwrittenKeys).toEqual([]);
  });

  it('refuses a raw "permissions" value', () => {
    expect(() => computeAddSettings(CURRENT, { values: { permissions: {} } })).toThrowError(
      expect.objectContaining({ code: 'invalid-content' }),
    );
  });

  it('refuses malformed current content', () => {
    expect(() => computeAddSettings('{broken', { values: { model: 'x' } })).toThrow(SettingsEditError);
  });

  it('values-only add leaves permissions untouched byte-for-byte', () => {
    const result = computeAddSettings(CURRENT, { values: { language: 'japanese' } });
    const next = JSON.parse(result.newContent);
    expect(next.permissions).toEqual(JSON.parse(CURRENT).permissions);
    expect(result.addedRules).toBe(0);
  });
});

describe('station: /catalog + /add/preview + existing /apply', () => {
  let app: FastifyInstance;
  let home: string;
  let project: string;

  const ctx: HostContext = {
    port: undefined,
    getContract: <T,>(station: string, name: string): T | undefined =>
      station === 'chartroom' && name === 'listRepoDirs'
        ? (((): { id: string; name: string; absPath: string }[] => [{ id: 'p', name: 'p', absPath: project }]) as T)
        : undefined,
    log: () => undefined,
  };

  beforeEach(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'settings-add-'));
    home = join(dir, 'home');
    project = join(dir, 'proj');
    mkdirSync(home, { recursive: true });
    mkdirSync(join(project, '.claude'), { recursive: true });
    writeFileSync(
      join(project, '.claude', 'settings.json'),
      `${JSON.stringify({ permissions: { deny: ['Bash(rm *)'] } }, null, 2)}\n`,
      'utf8',
    );
    app = Fastify({ logger: false });
    const station = createSettingsManagerStation({ homeDir: home, managedPath: join(dir, 'absent.json') });
    await station.registerRoutes(app, ctx);
    await app.ready();
  });

  it('GET /catalog serves the searchable catalog', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/settings-manager/catalog' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.settings.find((e: { key: string }) => e.key === 'cleanupPeriodDays')).toMatchObject({
      kind: 'number',
      defaultValue: 30,
    });
    expect(body.ruleTemplates.map((t: { id: string }) => t.id)).toContain('webfetch-domain');
  });

  it('add/preview → apply: one batched write through the existing rails', async () => {
    const previewRes = await app.inject({
      method: 'POST',
      url: '/api/settings-manager/add/preview',
      payload: {
        scope: 'project',
        project,
        additions: {
          values: { cleanupPeriodDays: 20 },
          defaultMode: 'acceptEdits',
          permissions: { allow: ['Bash(git status)'] },
        },
      },
    });
    expect(previewRes.statusCode).toBe(200);
    const body = previewRes.json();
    expect(body.addedKeys).toEqual(['cleanupPeriodDays', 'permissions.defaultMode']);
    expect(body.preview.validation.ok).toBe(true);
    expect(body.preview.unifiedDiff).toContain('+');

    const applied = await app.inject({
      method: 'POST',
      url: '/api/settings-manager/apply',
      headers: { [DECK_CLIENT_HEADER]: '1' },
      payload: { scope: 'project', project, newContent: body.newContent, baseHash: body.preview.baseHash },
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().backupPath).toContain('settings-backups');
    const onDisk = JSON.parse(readFileSync(join(project, '.claude', 'settings.json'), 'utf8'));
    expect(onDisk.cleanupPeriodDays).toBe(20);
    expect(onDisk.permissions.deny).toEqual(['Bash(rm *)']); // original preserved
    expect(onDisk.permissions.allow).toEqual(['Bash(git status)']);
    expect(onDisk.permissions.defaultMode).toBe('acceptEdits');
  });

  it('add/preview refuses a malformed target with a typed 409', async () => {
    writeFileSync(join(project, '.claude', 'settings.json'), '{broken', 'utf8');
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings-manager/add/preview',
      payload: { scope: 'project', project, additions: { values: { model: 'x' } } },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('malformed-target');
  });

  it('add/preview enforces the write-target guard (unregistered project -> 403)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings-manager/add/preview',
      payload: { scope: 'local', project: join(tmpdir(), 'nope'), additions: { values: { model: 'x' } } },
    });
    expect(response.statusCode).toBe(403);
  });

  it('a bad value shape surfaces as blocking validation in the preview (schema rail intact)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/settings-manager/add/preview',
      payload: { scope: 'project', project, additions: { values: { cleanupPeriodDays: 'twenty' } } },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.preview.validation.ok).toBe(false);
    expect(body.preview.validation.errors[0].path).toBe('cleanupPeriodDays');
  });
});
