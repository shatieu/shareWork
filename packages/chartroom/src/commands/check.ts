import type { Command } from 'commander';
import { findGitRoot } from '../repo.js';
import { runCheck } from '../check.js';

/** `chartroom check` (plan §8.5): read-only integrity gate. Exit codes: 0 clean, 1 issues found,
 * 2 fatal (not a repo, fs error). */
export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .description('Read-only integrity check: broken/tombstoned links, missing ids, duplicate ids.')
    .option('--json', 'emit the full structured result as JSON instead of a human-readable list')
    .action((opts: { json?: boolean }) => {
      let repoRoot: string;
      try {
        repoRoot = findGitRoot(process.cwd());
      } catch (err) {
        console.error(`chartroom: ${(err as Error).message}`);
        process.exitCode = 2;
        return;
      }

      try {
        const result = runCheck(repoRoot);

        if (opts.json) {
          console.log(
            JSON.stringify({
              clean: result.clean,
              brokenLinks: result.brokenLinks,
              missingIds: result.missingIds,
              duplicateIds: result.duplicateIds,
            }),
          );
        } else if (result.clean) {
          console.log('chartroom check: clean -- no broken links, missing ids, or duplicate ids found.');
        } else {
          if (result.brokenLinks.length > 0) {
            console.log(`Broken/tombstoned links (${result.brokenLinks.length}):`);
            for (const issue of result.brokenLinks) {
              const detail =
                issue.matchType === 'tombstone'
                  ? `tombstoned (last at ${issue.lastPath})`
                  : 'not found';
              console.log(`  ${issue.path}: link to id '${issue.targetId}' (${issue.hrefAsWritten}) is ${detail}`);
            }
          }
          if (result.missingIds.length > 0) {
            console.log(`Docs missing an id (${result.missingIds.length}):`);
            for (const path of result.missingIds) {
              console.log(`  ${path}`);
            }
          }
          if (result.duplicateIds.length > 0) {
            console.log(`Duplicate ids (${result.duplicateIds.length}):`);
            for (const dup of result.duplicateIds) {
              console.log(`  '${dup.id}': ${dup.paths.join(', ')}`);
            }
          }
        }

        process.exitCode = result.clean ? 0 : 1;
      } catch (err) {
        console.error(`chartroom: fatal error: ${(err as Error).message}`);
        process.exitCode = 2;
      }
    });
}
