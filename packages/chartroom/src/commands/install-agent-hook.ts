import type { Command } from 'commander';
import { findGitRoot } from '../repo.js';
import { installAgentHook } from '../install-agent-hook.js';

/** `chartroom install-agent-hook` (plan §1.4/§4/§7): writes/merges this repo's `.claude/
 * settings.json` `PostToolUseFailure` entry plus the hook script file. See
 * `install-agent-hook.ts`'s own header comment for why this targets `PostToolUseFailure`, not the
 * plan's originally-assumed `PostToolUse` event -- a corrected finding from this Developer stage's
 * mandatory hook-detection spike (Claude Code's own docs, fetched live, confirm `PostToolUse` only
 * fires on tool *success*). */
export function registerInstallAgentHookCommand(program: Command): void {
  program
    .command('install-agent-hook')
    .description('Install the PostToolUseFailure hook that nudges a failed Read towards chartroom resolve.')
    .action(() => {
      let repoRoot: string;
      try {
        repoRoot = findGitRoot(process.cwd());
      } catch (err) {
        console.error(`chartroom: ${(err as Error).message}`);
        process.exitCode = 1;
        return;
      }

      const result = installAgentHook(repoRoot);
      switch (result.status) {
        case 'installed':
          console.log('chartroom: installed the PostToolUseFailure agent hook (.claude/hooks, .claude/settings.json).');
          process.exitCode = 0;
          break;
        case 'already-present':
          console.log('chartroom: agent hook already installed -- refreshed the script in place.');
          process.exitCode = 0;
          break;
        case 'refused':
          console.error(
            `chartroom: a file already exists at ${result.scriptPath} that isn't chartroom-managed -- left ` +
              `untouched. Remove or rename it, then re-run this command.`,
          );
          process.exitCode = 1;
          break;
      }
    });
}
