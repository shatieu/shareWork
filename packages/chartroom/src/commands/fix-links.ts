import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { discoverDocFiles, findGitRoot, toRepoRelative } from '../repo.js';
import { buildFreshIndex } from '../indexer.js';
import { writeIndex } from '../index-schema.js';
import { computeLinkFixes } from '../fix-links.js';

interface ReportedChange {
  file: string;
  targetId: string;
  oldHref: string;
  newHref: string;
}

/**
 * `chartroom fix-links [--write] [--dry-run] [files...]` (plan §8.4, corrected per
 * DECISIONS-NEEDED.md: bare invocation defaults to report-only; `--write` is required to mutate).
 * Exit codes: 0 ran successfully (whether or not anything needed fixing), 1 fatal error.
 */
export function registerFixLinksCommand(program: Command): void {
  program
    .command('fix-links [files...]')
    .description('Report (default) or apply (--write) stale outbound link repairs.')
    .option('--write', 'apply the fixes to files on disk (default is report-only)')
    .option('--dry-run', 'explicit synonym for the default report-only behavior (kept for discoverability)')
    .action((files: string[], opts: { write?: boolean; dryRun?: boolean }) => {
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

        const targetPaths =
          files.length > 0 ? files.map((f) => toRepoRelative(repoRoot, f)) : discoverDocFiles(repoRoot);

        const allChanges: ReportedChange[] = [];
        for (const relPath of targetPaths) {
          const abs = join(repoRoot, relPath);
          if (!existsSync(abs)) continue;
          const raw = readFileSync(abs, 'utf8');
          const result = computeLinkFixes(relPath, raw, index);
          if (!result.changed) continue;

          for (const change of result.changes) {
            allChanges.push({ file: relPath, ...change });
          }
          if (opts.write) {
            writeFileSync(abs, result.newText, 'utf8');
          }
        }

        if (allChanges.length === 0) {
          console.log('chartroom: no stale links found.');
        } else {
          const verb = opts.write ? 'fixed' : 'found (dry-run; pass --write to apply)';
          console.log(`chartroom: ${allChanges.length} stale link(s) ${verb}:`);
          for (const change of allChanges) {
            console.log(`  ${change.file}: ${change.oldHref} -> ${change.newHref} (id: ${change.targetId})`);
          }
        }
        process.exitCode = 0;
      } catch (err) {
        console.error(`chartroom: fatal error: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });
}
