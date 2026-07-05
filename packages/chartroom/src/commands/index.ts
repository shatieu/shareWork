import type { Command } from 'commander';
import { findGitRoot } from '../repo.js';
import { buildFreshIndex } from '../indexer.js';
import { writeIndex } from '../index-schema.js';

/** `chartroom index` (plan §8.2): rebuild `.docs/index.json` from scratch. Never mutates doc files. */
export function registerIndexCommand(program: Command): void {
  program
    .command('index')
    .description('Rebuild .docs/index.json from scratch (never mutates doc files).')
    .option('--json', 'also print the full index JSON to stdout')
    .action((opts: { json?: boolean }) => {
      let repoRoot: string;
      try {
        repoRoot = findGitRoot(process.cwd());
      } catch (err) {
        console.error(`chartroom: ${(err as Error).message}`);
        process.exitCode = 1;
        return;
      }

      try {
        const { index, duplicateIds, missingIdPaths } = buildFreshIndex(repoRoot);
        writeIndex(repoRoot, index);

        const docCount = Object.keys(index.docs).length + index.unidentified.length;
        const assetCount = Object.keys(index.assets).length;
        const tombstoneCount = Object.keys(index.deleted).length;
        console.log(`chartroom: indexed ${docCount} docs, ${assetCount} assets, ${tombstoneCount} tombstones.`);
        if (duplicateIds.length > 0) {
          console.log(`chartroom: warning - ${duplicateIds.length} duplicate id(s) found (see 'chartroom check').`);
        }
        if (missingIdPaths.length > 0) {
          console.log(
            `chartroom: note - ${missingIdPaths.length} doc(s) have no id (see 'chartroom check' or 'chartroom init').`,
          );
        }
        if (opts.json) {
          console.log(JSON.stringify(index, null, 2));
        }
        process.exitCode = 0;
      } catch (err) {
        console.error(`chartroom: fatal error: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });
}
