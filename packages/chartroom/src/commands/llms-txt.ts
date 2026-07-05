import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { findGitRoot } from '../repo.js';
import { buildFreshIndex } from '../indexer.js';
import { writeIndex } from '../index-schema.js';
import { buildLlmsTxt } from '../llms-txt.js';

/** `chartroom llms-txt [--out <path>]` (plan §1.5/§7): rebuilds the index fresh (the project's
 * standing "always-fresh" rule, same as every other CLI command), then emits `llms.txt` to stdout
 * or, if `--out` is given, to that repo-relative path. */
export function registerLlmsTxtCommand(program: Command): void {
  program
    .command('llms-txt')
    .description("Emit an llms.txt index of this repo's Chart-Room-managed docs.")
    .option('--out <path>', 'write to this repo-relative path instead of stdout')
    .action((opts: { out?: string }) => {
      let repoRoot: string;
      try {
        repoRoot = findGitRoot(process.cwd());
      } catch (err) {
        console.error(`chartroom: ${(err as Error).message}`);
        process.exitCode = 1;
        return;
      }

      try {
        const { index } = buildFreshIndex(repoRoot);
        writeIndex(repoRoot, index);
        const content = buildLlmsTxt(repoRoot, index);

        if (opts.out) {
          writeFileSync(join(repoRoot, opts.out), content, 'utf8');
          console.log(`chartroom: wrote ${opts.out}`);
        } else {
          console.log(content);
        }
        process.exitCode = 0;
      } catch (err) {
        console.error(`chartroom: fatal error: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });
}
