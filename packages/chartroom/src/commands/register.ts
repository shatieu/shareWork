import { resolve } from 'node:path';
import type { Command } from 'commander';
import { findGitRoot } from '../repo.js';
import { registerRepo } from '../daemon/registry.js';

/**
 * `chartroom register [path]` (plan §5): resolves `path`'s (default: cwd's) git root via phase-1's
 * `findGitRoot` (reused verbatim), then registers it with the local daemon's flat registry file.
 * Idempotent -- safe to re-run against an already-registered repo.
 */
export function registerRegisterCommand(program: Command): void {
  program
    .command('register [path]')
    .description('Register a repo (by git root) so `chartroom serve` can browse it.')
    .action((pathArg?: string) => {
      let repoRoot: string;
      try {
        repoRoot = findGitRoot(pathArg ? resolve(pathArg) : process.cwd());
      } catch (err) {
        console.error(`chartroom: ${(err as Error).message}`);
        process.exitCode = 2;
        return;
      }

      try {
        const entry = registerRepo(repoRoot);
        console.log(`chartroom: registered '${entry.id}' -> ${entry.absPath}`);
        process.exitCode = 0;
      } catch (err) {
        console.error(`chartroom: fatal error: ${(err as Error).message}`);
        process.exitCode = 2;
      }
    });
}
