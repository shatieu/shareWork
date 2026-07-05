import type { Command } from 'commander';
import { findGitRoot, toRepoRelative } from '../repo.js';
import { buildFreshIndex } from '../indexer.js';
import { writeIndex } from '../index-schema.js';
import { resolve, type ResolveResult } from '../resolver.js';

function summarize(result: ResolveResult): string {
  switch (result.matchType) {
    case 'id':
      return `id -> ${result.path}`;
    case 'path':
      return `path -> ${result.path}${result.id ? ` (id: ${result.id})` : ' (no id)'}`;
    case 'filename':
      return `filename -> ${result.path}${result.id ? ` (id: ${result.id})` : ' (no id)'}`;
    case 'fuzzy':
      return `fuzzy guess -> ${result.path}${result.id ? ` (id: ${result.id})` : ''} [guess: true]`;
    case 'tombstone':
      return `tombstone: '${result.id}' last known at ${result.lastPath} (deleted ${result.deletedAt})`;
    case 'not-found':
      return 'not found';
  }
}

/** `chartroom resolve <id-or-path>` (plan §6.4). Exit codes: 0 resolved (id/path/filename/fuzzy),
 * 3 tombstone, 4 not-found, 1 fatal error. */
export function registerResolveCommand(program: Command): void {
  program
    .command('resolve <query>')
    .description('Resolve an id or path against a freshly rebuilt index.')
    .option('--json', 'emit the full structured result as JSON instead of a one-line summary')
    .action((query: string, opts: { json?: boolean }) => {
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

        const result = resolve(index, toRepoRelative(repoRoot, query));
        if (opts.json) {
          console.log(JSON.stringify(result));
        } else {
          console.log(summarize(result));
        }

        switch (result.matchType) {
          case 'tombstone':
            process.exitCode = 3;
            break;
          case 'not-found':
            process.exitCode = 4;
            break;
          default:
            process.exitCode = 0;
        }
      } catch (err) {
        console.error(`chartroom: fatal error: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });
}
