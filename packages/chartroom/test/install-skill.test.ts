import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installSkill } from '../src/install-skill.js';

let targetDir: string;

function skillPath(): string {
  return join(targetDir, '.claude', 'skills', 'chart-room', 'SKILL.md');
}

beforeEach(() => {
  targetDir = mkdtempSync(join(tmpdir(), 'chartroom-install-skill-test-'));
});

afterEach(() => {
  rmSync(targetDir, { recursive: true, force: true });
});

describe('installSkill', () => {
  it('fresh install copies the packaged template into .claude/skills/chart-room/SKILL.md', () => {
    const result = installSkill(targetDir);
    expect(result.status).toBe('installed');
    expect(existsSync(skillPath())).toBe(true);

    const content = readFileSync(skillPath(), 'utf8');
    expect(content).toContain('name: chart-room');
    expect(content).toContain('## When to use this');
    expect(content).toContain(':::ask-me');
  });

  it('re-running is idempotent and refreshes the file in place', () => {
    installSkill(targetDir);
    const result = installSkill(targetDir);
    expect(result.status).toBe('already-present');
    expect(existsSync(skillPath())).toBe(true);
  });

  it('refuses to overwrite a differently-authored file already at the skill path', () => {
    mkdirSync(join(targetDir, '.claude', 'skills', 'chart-room'), { recursive: true });
    writeFileSync(skillPath(), '---\nname: something-else\n---\n\n# Not chart-room\n', 'utf8');

    const result = installSkill(targetDir);
    expect(result.status).toBe('refused');
    if (result.status === 'refused') {
      expect(result.skillPath).toBe(skillPath());
    }
    expect(readFileSync(skillPath(), 'utf8')).toContain('Not chart-room');
  });
});
