import type { Command } from 'commander';
import { findGitRoot } from '../repo.js';
import { runCheck, type CheckResult } from '../check.js';

export interface CheckCommandOptions {
  json?: boolean;
  failOrphans?: boolean;
}

export interface RenderedCheck {
  lines: string[];
  exitCode: 0 | 1;
}

/**
 * Pure output/exit-code computation for `chartroom check`, extracted from the commander action
 * so the exit-code matrix and `--json` shape are unit-testable without spawning a process.
 * Exit 1 when integrity is dirty OR any doc is ttl-expired / stale against its `sources:`;
 * orphans are warn-only unless `--fail-orphans` (design call per plan §4.A: ttl/sources are
 * explicit per-doc opt-ins = intent; orphanhood is a heuristic that would instantly fail most
 * real repos).
 */
export function renderCheckResult(result: CheckResult, opts: CheckCommandOptions = {}): RenderedCheck {
  const { staleness } = result;
  const orphanFailure = Boolean(opts.failOrphans) && staleness.orphans.length > 0;
  const exitCode: 0 | 1 = !result.clean || !result.stalenessClean || orphanFailure ? 1 : 0;

  if (opts.json) {
    const line = JSON.stringify({
      clean: result.clean,
      stalenessClean: result.stalenessClean,
      brokenLinks: result.brokenLinks,
      missingIds: result.missingIds,
      duplicateIds: result.duplicateIds,
      staleness: result.staleness,
    });
    return { lines: [line], exitCode };
  }

  if (result.clean && result.stalenessClean && staleness.orphans.length === 0) {
    return {
      lines: ['chartroom check: clean -- no broken links, missing ids, duplicate ids, or staleness issues found.'],
      exitCode,
    };
  }

  const lines: string[] = [];
  if (result.brokenLinks.length > 0) {
    lines.push(`Broken/tombstoned links (${result.brokenLinks.length}):`);
    for (const issue of result.brokenLinks) {
      const detail = issue.matchType === 'tombstone' ? `tombstoned (last at ${issue.lastPath})` : 'not found';
      lines.push(`  ${issue.path}: link to id '${issue.targetId}' (${issue.hrefAsWritten}) is ${detail}`);
    }
  }
  if (result.missingIds.length > 0) {
    lines.push(`Docs missing an id (${result.missingIds.length}):`);
    for (const path of result.missingIds) {
      lines.push(`  ${path}`);
    }
  }
  if (result.duplicateIds.length > 0) {
    lines.push(`Duplicate ids (${result.duplicateIds.length}):`);
    for (const dup of result.duplicateIds) {
      lines.push(`  '${dup.id}': ${dup.paths.join(', ')}`);
    }
  }
  if (staleness.ttlExpired.length > 0) {
    lines.push(`Stale docs -- ttl expired (${staleness.ttlExpired.length}):`);
    for (const issue of staleness.ttlExpired) {
      lines.push(`  ${issue.path}: last change ${issue.ageDays}d ago exceeds ttl_days ${issue.ttlDays}`);
    }
  }
  if (staleness.staleAgainstSources.length > 0) {
    lines.push(`Stale docs -- sources changed since doc (${staleness.staleAgainstSources.length}):`);
    for (const issue of staleness.staleAgainstSources) {
      lines.push(`  ${issue.path}: newer sources: ${issue.newerSources.join(', ')}`);
    }
  }
  if (staleness.orphans.length > 0) {
    const suffix = opts.failOrphans ? '' : ' (warning)';
    lines.push(`Orphan docs -- no inbound id-links (${staleness.orphans.length})${suffix}:`);
    for (const orphan of staleness.orphans) {
      lines.push(`  ${orphan.path} (id '${orphan.id}')`);
    }
  }
  return { lines, exitCode };
}

/** `chartroom check` (plan §8.5 + v1.1 staleness): read-only integrity + staleness gate.
 * Exit codes: 0 clean, 1 issues found, 2 fatal (not a repo, fs error). */
export function registerCheckCommand(program: Command): void {
  program
    .command('check')
    .description(
      'Read-only integrity + staleness check: broken/tombstoned links, missing ids, duplicate ids, ' +
        'ttl-expired docs, docs stale against their sources:, orphan docs.',
    )
    .option('--json', 'emit the full structured result as JSON instead of a human-readable list')
    .option('--fail-orphans', 'exit 1 when orphan docs (no inbound id-links) exist (default: warn only)')
    .action((opts: CheckCommandOptions) => {
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
        const rendered = renderCheckResult(result, opts);
        for (const line of rendered.lines) {
          console.log(line);
        }
        process.exitCode = rendered.exitCode;
      } catch (err) {
        console.error(`chartroom: fatal error: ${(err as Error).message}`);
        process.exitCode = 2;
      }
    });
}
