import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeEffectiveSettings } from '../src/merge.js';
import { loadScopes, type ScopeFile } from '../src/scopes.js';
import { simulate } from '../src/simulator.js';

const options = { cwd: '/proj', homeDir: '/home/alice', projectDir: '/proj' };

function scopes(parts: {
  managed?: Record<string, unknown>;
  local?: Record<string, unknown>;
  project?: Record<string, unknown>;
  user?: Record<string, unknown>;
}): ScopeFile[] {
  const files: ScopeFile[] = [];
  if (parts.managed) files.push({ scope: 'managed', path: '/etc/claude-code/managed-settings.json', exists: true, settings: parts.managed });
  if (parts.local) files.push({ scope: 'local', path: '/proj/.claude/settings.local.json', exists: true, settings: parts.local });
  if (parts.project) files.push({ scope: 'project', path: '/proj/.claude/settings.json', exists: true, settings: parts.project });
  if (parts.user) files.push({ scope: 'user', path: '/home/alice/.claude/settings.json', exists: true, settings: parts.user });
  return files;
}

describe('deny → ask → allow, first match wins (docs, plan §2)', () => {
  it('a broad deny beats a narrower allow -- specificity never reorders', () => {
    const effective = computeEffectiveSettings(
      scopes({ project: { permissions: { deny: ['Bash(aws *)'], allow: ['Bash(aws s3 ls)'] } } }),
    );
    const verdict = simulate(effective, { tool: 'Bash', command: 'aws s3 ls' }, options);
    expect(verdict.behavior).toBe('deny');
    expect(verdict.decidingRule?.rule).toBe('Bash(aws *)');
    expect(verdict.decidingRule?.file).toBe('/proj/.claude/settings.json');
  });

  it('ask beats a more specific allow', () => {
    const effective = computeEffectiveSettings(
      scopes({ project: { permissions: { ask: ['Bash(git push *)'], allow: ['Bash(git push origin main)'] } } }),
    );
    const verdict = simulate(effective, { tool: 'Bash', command: 'git push origin main' }, options);
    expect(verdict.behavior).toBe('ask');
    expect(verdict.decidingRule?.rule).toBe('Bash(git push *)');
  });

  it('a user-level deny blocks a project-level allow (deny from ANY scope wins)', () => {
    const effective = computeEffectiveSettings(
      scopes({
        project: { permissions: { allow: ['WebFetch(domain:evil.com)'] } },
        user: { permissions: { deny: ['WebFetch(domain:evil.com)'] } },
      }),
    );
    const verdict = simulate(effective, { tool: 'WebFetch', url: 'https://evil.com/x' }, options);
    expect(verdict.behavior).toBe('deny');
    expect(verdict.decidingRule?.scope).toBe('user');
  });

  it('the spec question: would Bash(rm -rf ./dist) be allowed right now, and which rule decides', () => {
    const effective = computeEffectiveSettings(
      scopes({
        user: { permissions: { allow: ['Bash(rm -rf ./dist)'] } },
        project: { permissions: { deny: ['Bash(rm *)'] } },
      }),
    );
    const verdict = simulate(effective, { tool: 'Bash', command: 'rm -rf ./dist' }, options);
    expect(verdict.behavior).toBe('deny');
    expect(verdict.decidingRule).toMatchObject({
      rule: 'Bash(rm *)',
      scope: 'project',
      file: '/proj/.claude/settings.json',
    });
    expect(verdict.explanation).toContain('deny rules are evaluated first');
  });
});

describe('no-match → defaultMode governs (scalar override precedence)', () => {
  it('default mode prompts', () => {
    const effective = computeEffectiveSettings(scopes({ user: {} }));
    const verdict = simulate(effective, { tool: 'Bash', command: 'unknown-cmd' }, options);
    expect(verdict.behavior).toBe('default');
    expect(verdict.mode).toBe('default');
    expect(verdict.explanation).toContain('prompts');
  });

  it('local defaultMode overrides user defaultMode (precedence, not merge)', () => {
    const effective = computeEffectiveSettings(
      scopes({
        local: { permissions: { defaultMode: 'dontAsk' } },
        user: { permissions: { defaultMode: 'acceptEdits' } },
      }),
    );
    const verdict = simulate(effective, { tool: 'Bash', command: 'unknown-cmd' }, options);
    expect(verdict.mode).toBe('dontAsk');
    expect(verdict.modeSource?.scope).toBe('local');
    expect(verdict.explanation).toContain('auto-DENIES');
    // ...and the shadowed value is visible for the UI
    expect(effective.permissions.defaultMode?.overridden).toHaveLength(1);
  });
});

describe('compound commands (docs: every subcommand must pass independently)', () => {
  const effective = computeEffectiveSettings(
    scopes({
      project: {
        permissions: {
          allow: ['Bash(git status)', 'Bash(npm test *)'],
          deny: ['Bash(git push *)'],
        },
      },
    }),
  );

  it('allowed only when every subcommand is allowed', () => {
    const verdict = simulate(effective, { tool: 'Bash', command: 'git status && npm test' }, options);
    expect(verdict.behavior).toBe('allow');
    expect(verdict.supportingRules?.map((rule) => rule.rule)).toEqual(['Bash(git status)', 'Bash(npm test *)']);
  });

  it('one denied subcommand denies the whole compound', () => {
    const verdict = simulate(effective, { tool: 'Bash', command: 'git status && git push origin main' }, options);
    expect(verdict.behavior).toBe('deny');
    expect(verdict.decidingRule?.subcommand).toBe('git push origin main');
  });

  it('a rule like Bash(safe *) does not cover safe && other (docs tip)', () => {
    const eff = computeEffectiveSettings(scopes({ project: { permissions: { allow: ['Bash(git *)'] } } }));
    const verdict = simulate(eff, { tool: 'Bash', command: 'git status && rm -rf /' }, options);
    expect(verdict.behavior).toBe('default');
    expect(verdict.notes.join(' ')).toContain('at least one subcommand');
  });
});

describe('honest limits', () => {
  it('unevaluated rules are surfaced, never dropped', () => {
    const effective = computeEffectiveSettings(
      scopes({ project: { permissions: { deny: ['Read([ab].env)'] } } }),
    );
    const verdict = simulate(effective, { tool: 'Read', path: '/proj/a.env' }, options);
    expect(verdict.behavior).toBe('default');
    expect(verdict.unevaluated).toHaveLength(1);
    expect(verdict.unevaluated[0].reason).toMatch(/not modeled/);
  });

  it('malformed scopes are excluded AND flagged as a caveat', () => {
    const files: ScopeFile[] = [
      { scope: 'project', path: '/proj/.claude/settings.json', exists: true, raw: '{oops', error: 'not valid JSON: x' },
      { scope: 'user', path: '/home/alice/.claude/settings.json', exists: true, settings: { permissions: { allow: ['Bash(ls *)'] } } },
    ];
    const effective = computeEffectiveSettings(files);
    const verdict = simulate(effective, { tool: 'Bash', command: 'ls -la' }, options);
    expect(verdict.behavior).toBe('allow');
    expect(verdict.caveats.join(' ')).toContain('project scope EXCLUDED');
  });

  it('always states that CLI-args scope and hooks are not simulated', () => {
    const verdict = simulate(computeEffectiveSettings([]), { tool: 'Bash', command: 'ls' }, options);
    expect(verdict.caveats.join(' ')).toMatch(/CLI-argument scope/);
    expect(verdict.caveats.join(' ')).toMatch(/hooks/);
  });

  it('/-anchored path rules resolve against the rule source (project root vs ~/.claude)', () => {
    const effective = computeEffectiveSettings(
      scopes({
        user: { permissions: { deny: ['Read(/secrets/**)'] } },
      }),
    );
    // In USER settings, /secrets/** anchors at /home/alice/.claude/secrets -- NOT the project.
    const inProject = simulate(effective, { tool: 'Read', path: '/proj/secrets/x' }, options);
    expect(inProject.behavior).toBe('default');
    const inUserClaude = simulate(effective, { tool: 'Read', path: '/home/alice/.claude/secrets/x' }, options);
    expect(inUserClaude.behavior).toBe('deny');
  });
});

describe('THE READ-ONLY PROOF (FO-named risk: the simulator must be provably read-only)', () => {
  it('source scan: no write-capable fs API appears in simulator/merge/rules sources', () => {
    const sources = ['simulator.ts', 'merge.ts', 'rules.ts'];
    const banned = /\b(writeFileSync|writeFile|appendFile|appendFileSync|renameSync|rename\(|unlink|rmSync|rmdir|mkdirSync|mkdir\(|copyFileSync|copyFile|createWriteStream|truncate|chmod|chown|symlink|link\(|open\(|opendir)\b/;
    for (const source of sources) {
      const text = readFileSync(join(__dirname, '..', 'src', source), 'utf8');
      expect(text, `${source} must not import or call write APIs`).not.toMatch(banned);
    }
    // simulator/merge/rules must not import node:fs at all -- they operate on pre-loaded data.
    for (const source of sources) {
      const text = readFileSync(join(__dirname, '..', 'src', source), 'utf8');
      expect(text, `${source} must not touch the filesystem`).not.toMatch(/from 'node:fs'|require\(['"]fs/);
    }
  });

  it('behavioral proof: loadScopes + simulate leave every byte and mtime untouched', () => {
    const dir = mkdtempSync(join(tmpdir(), 'settings-sim-'));
    const claudeDir = join(dir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), '{"permissions":{"deny":["Bash(rm *)"]}}', 'utf8');
    writeFileSync(join(claudeDir, 'settings.local.json'), '{not json', 'utf8');

    const snapshot = () =>
      readdirSync(claudeDir).map((name) => {
        const full = join(claudeDir, name);
        return { name, bytes: readFileSync(full, 'utf8'), mtime: statSync(full).mtimeMs, size: statSync(full).size };
      });

    const before = snapshot();
    const loaded = loadScopes({ projectDir: dir, homeDir: dir, managedPath: join(dir, 'managed-absent.json') });
    const verdict = simulate(computeEffectiveSettings(loaded), { tool: 'Bash', command: 'rm -rf ./dist' }, {
      cwd: dir,
      homeDir: dir,
      projectDir: dir,
    });
    expect(verdict.behavior).toBe('deny');
    expect(snapshot()).toEqual(before);
  });
});
