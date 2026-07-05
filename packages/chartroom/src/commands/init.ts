import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { discoverDocFiles, findGitRoot } from '../repo.js';
import { readFrontmatter, injectId } from '../frontmatter.js';
import { generateId } from '../id.js';
import { buildFreshIndex, titleFor } from '../indexer.js';
import { writeIndex } from '../index-schema.js';
import { installHook } from '../install-hook.js';

interface InitSummary {
  assignedIds: number;
  indexedDocs: number;
  tombstones: number;
  hookStatus: 'installed' | 'already-present' | 'refused' | 'skipped';
  refusedHookPath?: string;
}

/**
 * `chartroom init` (plan §8.1): assign ids to every existing doc missing one, build the first
 * index, install the pre-commit hook. Idempotent -- re-running only touches docs still missing an
 * id; docs that already have one are left byte-for-byte alone.
 */
function runInit(repoRoot: string, installHookFlag: boolean): InitSummary {
  const files = discoverDocFiles(repoRoot);

  // Seed the existing-id set from a preliminary fresh scan so newly generated ids never collide
  // with ids already assigned to other docs.
  const preliminary = buildFreshIndex(repoRoot);
  const existingIds = new Set<string>(Object.keys(preliminary.index.docs));

  let assignedIds = 0;
  for (const relPath of files) {
    const abs = join(repoRoot, relPath);
    const raw = readFileSync(abs, 'utf8');
    const fm = readFrontmatter(raw);
    const rawId = fm.data.id;
    const hasId = typeof rawId === 'string' && rawId.trim().length > 0;
    if (hasId) continue;

    const base = titleFor(fm.data, raw, relPath);
    const newId = generateId(base, existingIds);
    existingIds.add(newId);

    const updated = injectId(raw, newId);
    writeFileSync(abs, updated, 'utf8');
    assignedIds += 1;
  }

  const { index } = buildFreshIndex(repoRoot);
  writeIndex(repoRoot, index);

  let hookStatus: InitSummary['hookStatus'] = 'skipped';
  let refusedHookPath: string | undefined;
  if (installHookFlag) {
    const hookResult = installHook(repoRoot);
    hookStatus = hookResult.status;
    if (hookResult.status === 'refused') refusedHookPath = hookResult.hookPath;
  }

  return {
    assignedIds,
    indexedDocs: Object.keys(index.docs).length + index.unidentified.length,
    tombstones: Object.keys(index.deleted).length,
    hookStatus,
    refusedHookPath,
  };
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Assign ids to every doc missing one, build the index, install the pre-commit hook.')
    .option('--no-hook', 'do not install the pre-commit hook')
    .action((opts: { hook: boolean }) => {
      let repoRoot: string;
      try {
        repoRoot = findGitRoot(process.cwd());
      } catch (err) {
        console.error(`chartroom: ${(err as Error).message}`);
        process.exitCode = 1;
        return;
      }

      try {
        const summary = runInit(repoRoot, opts.hook !== false);
        const hookNote = summary.hookStatus === 'skipped' ? '' : `, hook ${summary.hookStatus}`;
        console.log(
          `chartroom: assigned ${summary.assignedIds} id(s), indexed ${summary.indexedDocs} doc(s)${hookNote}.`,
        );
        if (summary.hookStatus === 'refused') {
          console.log(
            `chartroom: an existing pre-commit hook was found at ${summary.refusedHookPath} that isn't ` +
              `Chart-Room-managed -- it was left untouched. Chain chartroom's hook manually (see README) ` +
              `if you want both to run.`,
          );
        }
        process.exitCode = 0;
      } catch (err) {
        console.error(`chartroom: fatal error: ${(err as Error).message}`);
        process.exitCode = 1;
      }
    });
}
