import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Present in the packaged template's own frontmatter `description` -- used the same way
 * `install-hook.ts`/`install-agent-hook.ts` use their own marker strings, to tell "this is our own
 * (possibly older-version) file" apart from a differently-authored file already at this path. */
const SKILL_MARKER = 'name: chart-room';
const SKILL_RELATIVE_PATH = '.claude/skills/chart-room/SKILL.md';

export type InstallSkillResult =
  | { status: 'installed' }
  | { status: 'already-present' }
  | { status: 'refused'; skillPath: string };

function skillTemplatePath(): string {
  // This module compiles to dist/install-skill.js; the template ships at the package root's own
  // skill-template/ dir (declared in package.json "files"), one level up from dist/.
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return join(thisDir, '..', 'skill-template', 'chart-room', 'SKILL.md');
}

/**
 * Copies the packaged `chart-room` skill template into a target repo's own
 * `.claude/skills/chart-room/SKILL.md` (plan §1.3/§6/§7). Refuses to overwrite a differently
 * -authored file already at that path (same "refuse to clobber, print instructions" discipline as
 * `install-hook.ts`/`install-agent-hook.ts`) -- re-running against an already-installed chartroom
 * skill refreshes it in place (idempotent upgrade path).
 */
export function installSkill(targetDir: string): InstallSkillResult {
  const skillPath = join(targetDir, SKILL_RELATIVE_PATH);
  const skillDir = dirname(skillPath);

  if (existsSync(skillPath)) {
    const existing = readFileSync(skillPath, 'utf8');
    if (!existing.includes(SKILL_MARKER)) {
      return { status: 'refused', skillPath };
    }
    const template = readFileSync(skillTemplatePath(), 'utf8');
    writeFileSync(skillPath, template, 'utf8');
    return { status: 'already-present' };
  }

  if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });
  const template = readFileSync(skillTemplatePath(), 'utf8');
  writeFileSync(skillPath, template, 'utf8');
  return { status: 'installed' };
}
