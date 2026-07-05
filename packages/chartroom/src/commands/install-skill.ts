import { resolve as resolvePath } from 'node:path';
import type { Command } from 'commander';
import { findGitRoot } from '../repo.js';
import { installSkill } from '../install-skill.js';

/** `chartroom install-skill [target-dir]` (plan §1.3/§6/§7): copies the packaged `chart-room`
 * skill template into `[target-dir]/.claude/skills/chart-room/SKILL.md` -- defaults to the cwd's
 * git root if no `target-dir` is given, same "cwd-scoped, nearest ancestor .git" convention as
 * every other phase-1 CLI command. */
export function registerInstallSkillCommand(program: Command): void {
  program
    .command('install-skill [target-dir]')
    .description('Copy the packaged chart-room skill into a repo\'s .claude/skills/chart-room/SKILL.md.')
    .action((targetDirArg?: string) => {
      let targetDir: string;
      try {
        targetDir = targetDirArg ? resolvePath(targetDirArg) : findGitRoot(process.cwd());
      } catch (err) {
        console.error(`chartroom: ${(err as Error).message}`);
        process.exitCode = 1;
        return;
      }

      const result = installSkill(targetDir);
      switch (result.status) {
        case 'installed':
          console.log(`chartroom: installed the chart-room skill into ${targetDir}.`);
          process.exitCode = 0;
          break;
        case 'already-present':
          console.log('chartroom: chart-room skill already installed -- refreshed in place.');
          process.exitCode = 0;
          break;
        case 'refused':
          console.error(
            `chartroom: a file already exists at ${result.skillPath} that isn't the chartroom-managed skill -- ` +
              `left untouched. Remove or rename it, then re-run this command.`,
          );
          process.exitCode = 1;
          break;
      }
    });
}
