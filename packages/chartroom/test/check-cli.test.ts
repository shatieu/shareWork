import { describe, expect, it } from 'vitest';
import { renderCheckResult } from '../src/commands/check.js';
import { emptyIndex } from '../src/index-schema.js';
import type { CheckResult } from '../src/check.js';
import type { StalenessResult } from '../src/staleness.js';

function makeResult(overrides: Partial<CheckResult> = {}, staleness: Partial<StalenessResult> = {}): CheckResult {
  const stalenessResult: StalenessResult = {
    ttlExpired: [],
    staleAgainstSources: [],
    orphans: [],
    ...staleness,
  };
  return {
    index: emptyIndex(),
    brokenLinks: [],
    missingIds: [],
    duplicateIds: [],
    clean: true,
    staleness: stalenessResult,
    stalenessClean:
      stalenessResult.ttlExpired.length === 0 && stalenessResult.staleAgainstSources.length === 0,
    ...overrides,
  };
}

const TTL_ISSUE = { id: 'doc-a' as string | null, path: 'docs/a.md', ttlDays: 90, ageDays: 120 };
const SOURCES_ISSUE = { id: 'doc-b' as string | null, path: 'docs/b.md', newerSources: ['src/x.ts', 'src/y.ts'] };
const ORPHAN = { id: 'doc-c', path: 'docs/c.md' };

describe('renderCheckResult — exit-code matrix', () => {
  it('fully clean -> exit 0 with the clean line', () => {
    const { lines, exitCode } = renderCheckResult(makeResult());
    expect(exitCode).toBe(0);
    expect(lines).toEqual([
      'chartroom check: clean -- no broken links, missing ids, duplicate ids, or staleness issues found.',
    ]);
  });

  it('integrity dirty -> exit 1', () => {
    const result = makeResult({
      clean: false,
      missingIds: ['docs/no-id.md'],
    });
    const { exitCode } = renderCheckResult(result);
    expect(exitCode).toBe(1);
  });

  it('stale-only (ttl expired, integrity clean) -> exit 1', () => {
    const result = makeResult({}, { ttlExpired: [TTL_ISSUE] });
    const { lines, exitCode } = renderCheckResult(result);
    expect(exitCode).toBe(1);
    expect(lines).toContain('Stale docs -- ttl expired (1):');
    expect(lines).toContain('  docs/a.md: last change 120d ago exceeds ttl_days 90');
  });

  it('stale-only (sources changed, integrity clean) -> exit 1', () => {
    const result = makeResult({}, { staleAgainstSources: [SOURCES_ISSUE] });
    const { lines, exitCode } = renderCheckResult(result);
    expect(exitCode).toBe(1);
    expect(lines).toContain('Stale docs -- sources changed since doc (1):');
    expect(lines).toContain('  docs/b.md: newer sources: src/x.ts, src/y.ts');
  });

  it('orphan-only WITHOUT --fail-orphans -> exit 0, warning section printed', () => {
    const result = makeResult({}, { orphans: [ORPHAN] });
    const { lines, exitCode } = renderCheckResult(result);
    expect(exitCode).toBe(0);
    expect(lines).toContain("Orphan docs -- no inbound id-links (1) (warning):");
    expect(lines).toContain("  docs/c.md (id 'doc-c')");
  });

  it('orphan-only WITH --fail-orphans -> exit 1, no warning suffix', () => {
    const result = makeResult({}, { orphans: [ORPHAN] });
    const { lines, exitCode } = renderCheckResult(result, { failOrphans: true });
    expect(exitCode).toBe(1);
    expect(lines).toContain('Orphan docs -- no inbound id-links (1):');
  });

  it('integrity sections keep their exact v1 wording alongside staleness sections', () => {
    const result = makeResult(
      {
        clean: false,
        brokenLinks: [
          { path: 'a.md', targetId: 'gone', hrefAsWritten: './gone.md', matchType: 'not-found' },
        ],
      },
      { ttlExpired: [TTL_ISSUE] },
    );
    const { lines, exitCode } = renderCheckResult(result);
    expect(exitCode).toBe(1);
    expect(lines).toContain('Broken/tombstoned links (1):');
    expect(lines).toContain("  a.md: link to id 'gone' (./gone.md) is not found");
  });
});

describe('renderCheckResult — --json shape', () => {
  it('emits one JSON line with the staleness block and both clean flags', () => {
    const result = makeResult(
      {},
      { ttlExpired: [TTL_ISSUE], staleAgainstSources: [SOURCES_ISSUE], orphans: [ORPHAN] },
    );
    const { lines, exitCode } = renderCheckResult(result, { json: true });
    expect(exitCode).toBe(1);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.clean).toBe(true);
    expect(parsed.stalenessClean).toBe(false);
    expect(parsed.brokenLinks).toEqual([]);
    expect(parsed.missingIds).toEqual([]);
    expect(parsed.duplicateIds).toEqual([]);
    expect(parsed.staleness).toEqual({
      ttlExpired: [TTL_ISSUE],
      staleAgainstSources: [SOURCES_ISSUE],
      orphans: [ORPHAN],
    });
  });

  it('orphans alone do not flip the json exit code without --fail-orphans', () => {
    const result = makeResult({}, { orphans: [ORPHAN] });
    expect(renderCheckResult(result, { json: true }).exitCode).toBe(0);
    expect(renderCheckResult(result, { json: true, failOrphans: true }).exitCode).toBe(1);
  });
});
