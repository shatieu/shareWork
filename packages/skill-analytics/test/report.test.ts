import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openSkillAnalyticsDb } from '../src/db.js';
import { collectTranscripts } from '../src/collect.js';
import { listInstalledSkills } from '../src/installed.js';
import { buildSummary, buildTrend, findDeadSkills, knownProjectDirs } from '../src/report.js';
import {
  assistantAgentLine,
  assistantSkillLine,
  makeClaudeDir,
  makeHomeDir,
  userCommandLine,
  userPromptLine,
  writeTranscript,
} from './fixtures.js';

const NOW = () => new Date('2026-07-06T12:00:00.000Z');

let db: Database.Database;
let home: string;
let claude: { root: string; projectDir: string };

beforeEach(() => {
  home = makeHomeDir();
  db = openSkillAnalyticsDb(home);
  claude = makeClaudeDir();
});

afterEach(() => {
  db.close();
});

function installSkill(root: string, name: string): void {
  const dir = join(root, '.claude', 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '# fixture skill\n', 'utf-8');
}

describe('report aggregations', () => {
  it('merges proactive Skill calls and explicit /commands by name with the ratio', () => {
    writeTranscript(claude.projectDir, 's1.jsonl', [
      assistantSkillLine('lookout', { input: 10, output: 1 }),
      userPromptLine('x'),
      assistantSkillLine('lookout', { input: 20, output: 2 }),
      userCommandLine('lookout'),
      userCommandLine('model'),
      assistantAgentLine('wave-reviewer'),
    ]);
    collectTranscripts(db, claude.root);
    const summary = buildSummary(db, [], { now: NOW });

    const lookout = summary.skills.find((r) => r.name === 'lookout')!;
    expect(lookout).toMatchObject({ total: 3, proactive: 2, explicit: 1 });
    expect(lookout.proactiveRatio).toBeCloseTo(2 / 3);
    expect(lookout.inputTokens).toBe(30);

    expect(summary.skills.find((r) => r.name === 'model')).toMatchObject({ total: 1, proactive: 0, explicit: 1 });
    expect(summary.agents).toEqual([
      expect.objectContaining({ name: 'wave-reviewer', category: 'agent', total: 1 }),
    ]);
    expect(summary.totals.invocations).toBe(5);
  });

  it('filters per project and per days window', () => {
    writeTranscript(claude.projectDir, 's1.jsonl', [
      assistantSkillLine('old-skill', {}, { cwd: 'C:\\repos\\alpha', timestamp: '2026-05-01T00:00:00.000Z' }),
      assistantSkillLine('new-skill', {}, { cwd: 'C:\\repos\\beta', timestamp: '2026-07-05T00:00:00.000Z' }),
    ]);
    collectTranscripts(db, claude.root);

    const alphaOnly = buildSummary(db, [], { project: 'alpha', now: NOW });
    expect(alphaOnly.skills.map((r) => r.name)).toEqual(['old-skill']);

    const recent = buildSummary(db, [], { days: 7, now: NOW });
    expect(recent.skills.map((r) => r.name)).toEqual(['new-skill']);
  });

  it('builds a per-day trend', () => {
    writeTranscript(claude.projectDir, 's1.jsonl', [
      assistantSkillLine('a', {}, { timestamp: '2026-07-01T08:00:00.000Z' }),
      assistantSkillLine('b', {}, { timestamp: '2026-07-01T09:00:00.000Z' }),
      assistantSkillLine('c', {}, { timestamp: '2026-07-03T09:00:00.000Z' }),
    ]);
    collectTranscripts(db, claude.root);
    expect(buildTrend(db, { now: NOW })).toEqual([
      { date: '2026-07-01', count: 2 },
      { date: '2026-07-03', count: 1 },
    ]);
  });
});

describe('dead-skill detection', () => {
  it('flags installed skills that never fired or have been silent >= N days', () => {
    installSkill(home, 'never-used');
    installSkill(home, 'stale-skill');
    installSkill(home, 'active-skill');
    writeTranscript(claude.projectDir, 's1.jsonl', [
      assistantSkillLine('stale-skill', {}, { timestamp: '2026-05-01T00:00:00.000Z' }),
      assistantSkillLine('active-skill', {}, { timestamp: '2026-07-05T00:00:00.000Z' }),
    ]);
    collectTranscripts(db, claude.root);

    const installed = listInstalledSkills({ homeDir: home });
    const dead = findDeadSkills(db, installed, { days: 30, now: NOW });
    expect(dead.map((d) => d.name).sort()).toEqual(['never-used', 'stale-skill']);
    expect(dead.find((d) => d.name === 'never-used')).toMatchObject({ lastSeen: null, daysSilent: null });
    expect(dead.find((d) => d.name === 'stale-skill')!.daysSilent).toBeGreaterThanOrEqual(30);
  });

  it('an explicit /command invocation keeps a skill alive too', () => {
    installSkill(home, 'cmd-only');
    writeTranscript(claude.projectDir, 's1.jsonl', [
      userCommandLine('cmd-only', { timestamp: '2026-07-06T00:00:00.000Z' }),
    ]);
    collectTranscripts(db, claude.root);
    const dead = findDeadSkills(db, listInstalledSkills({ homeDir: home }), { days: 30, now: NOW });
    expect(dead).toEqual([]);
  });
});

describe('installed census', () => {
  it('finds user, project and plugin-cache skills with plugin aliases', () => {
    installSkill(home, 'user-skill');
    const projectDir = join(home, 'someproject');
    installSkill(projectDir, 'proj-skill');
    const pluginSkillDir = join(home, '.claude', 'plugins', 'cache', 'mkt', 'myplugin', '1.0.0', 'skills', 'nested');
    mkdirSync(pluginSkillDir, { recursive: true });
    writeFileSync(join(pluginSkillDir, 'SKILL.md'), '# plugin skill\n', 'utf-8');

    const installed = listInstalledSkills({ homeDir: home, projectDirs: [projectDir] });
    expect(installed.map((s) => `${s.scope}:${s.name}`).sort()).toEqual([
      'plugin:myplugin:nested',
      'project:proj-skill',
      'user:user-skill',
    ]);
    expect(installed.find((s) => s.scope === 'plugin')!.aliases).toEqual(['myplugin:nested', 'nested']);
  });

  it('knownProjectDirs surfaces distinct transcript cwds for the project scan', () => {
    writeTranscript(claude.projectDir, 's1.jsonl', [
      assistantSkillLine('a', {}, { cwd: 'C:\\repos\\alpha' }),
      userPromptLine('x', { cwd: 'C:\\repos\\alpha' }),
      assistantSkillLine('b', {}, { cwd: 'C:\\repos\\beta' }),
    ]);
    collectTranscripts(db, claude.root);
    expect(knownProjectDirs(db)).toEqual(['C:\\repos\\alpha', 'C:\\repos\\beta']);
  });
});
