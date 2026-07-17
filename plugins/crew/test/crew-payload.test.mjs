import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Structural checks for the Crew plugin's phase-4 payload (plan 08 §7): the full role set,
 * the orchestration skill, and the hooks registration all exist and are internally consistent
 * -- the "fresh project + plugin" half of the Ship_Spec §9.4 acceptance line at file level.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CREW_DIR = resolve(HERE, '..');

const ROLES = [
  'first-officer',
  'navigator',
  'shipwright',
  'inspector',
  'devils-advocate',
  'quartermaster',
];

// Companion-session charters: launched as a session's MAIN agent, never dispatched with a
// report contract (the chaplain converses with the Captain; wave2-C chapel chat resumes it).
const COMPANION_AGENTS = ['chaplain'];
const ALL_AGENTS = [...ROLES, ...COMPANION_AGENTS];

function frontmatterOf(markdown, file) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  expect(match, `${file} must start with YAML frontmatter`).toBeTruthy();
  return match[1];
}

describe('crew plugin phase-4 payload', () => {
  it('agents/ contains ONLY the known charters -- every agents/*.md becomes a dispatchable agent type (a README there turns into a bogus "README" agent, observed live in package-8 acceptance)', async () => {
    const { readdirSync } = await import('node:fs');
    const files = readdirSync(join(CREW_DIR, 'agents')).filter((f) => f.endsWith('.md'));
    expect(files.sort()).toEqual(ALL_AGENTS.map((r) => `${r}.md`).sort());
  });

  it('ships the full Ship_Spec §7 role set (plus companions) with name+description frontmatter', () => {
    for (const role of ALL_AGENTS) {
      const path = join(CREW_DIR, 'agents', `${role}.md`);
      expect(existsSync(path), `missing agents/${role}.md`).toBe(true);
      const fm = frontmatterOf(readFileSync(path, 'utf8'), `agents/${role}.md`);
      expect(fm).toContain(`name: ${role}`);
      expect(fm).toMatch(/description: .+/);
    }
  });

  it('every role charter carries the ≤30-line report contract', () => {
    for (const role of ROLES) {
      const body = readFileSync(join(CREW_DIR, 'agents', `${role}.md`), 'utf8');
      expect(body, `agents/${role}.md must state a report contract`).toMatch(/[Rr]eport contract/);
    }
  });

  it('quartermaster names its ledger and changelog MCP tools and the registration fallback', () => {
    const body = readFileSync(join(CREW_DIR, 'agents', 'quartermaster.md'), 'utf8');
    for (const tool of ['ledger_list', 'ledger_get', 'log_entries', 'log_rollup', 'log_sessions']) {
      expect(body).toContain(tool);
    }
    expect(body).toContain('claude mcp add ship-ledger -- ship-ledger mcp');
    expect(body).toContain('claude mcp add ship-log');
  });

  it('inspector owns the paranoid PASS marker and forbids writing it on FAIL', () => {
    const body = readFileSync(join(CREW_DIR, 'agents', 'inspector.md'), 'utf8');
    expect(body).toContain('.ship-crew/inspector-pass.json');
    expect(body).toContain('Never write it for a FAIL');
  });

  it('the crew skill documents all four built-in presets, the plan gate, and the hot-load fallback', () => {
    const skill = readFileSync(join(CREW_DIR, 'skills', 'crew', 'SKILL.md'), 'utf8');
    for (const preset of ['solo', 'standard', 'rigorous', 'paranoid']) {
      expect(skill).toContain(`\`${preset}\``);
    }
    expect(skill).toContain('complete role definition'); // charter hot-load fallback lesson
    expect(skill).toContain('git show'); // shared-worktree lesson
    expect(skill).toContain('explicit approval'); // plan gate
  });

  it('plugin manifest is phase-4: version >= 0.2.0 and roles in the description', () => {
    const manifest = JSON.parse(
      readFileSync(join(CREW_DIR, '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    expect(manifest.name).toBe('ship-crew');
    expect(manifest.version).not.toBe('0.1.0');
    expect(manifest.description).toContain('quartermaster');
  });

  it('hooks.json wires scrutiny.mjs at SessionStart and stop-gate.mjs at Stop without dropping capture', () => {
    const hooks = JSON.parse(readFileSync(join(CREW_DIR, 'hooks', 'hooks.json'), 'utf8')).hooks;
    const scriptsFor = (event) =>
      hooks[event].flatMap((entry) => entry.hooks.map((h) => h.args[0].split('/').pop()));
    expect(scriptsFor('SessionStart').sort()).toEqual(['emit.mjs', 'scrutiny.mjs']);
    expect(scriptsFor('Stop').sort()).toEqual(['emit.mjs', 'stop-gate.mjs']);
  });
});
