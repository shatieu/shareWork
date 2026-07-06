import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Summary } from '../src/report.js';
import { assistantSkillLine, makeClaudeDir, makeHomeDir, userCommandLine, writeTranscript } from './fixtures.js';

const cliPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');

/** CLI smoke tests run against the built bin (`pnpm build` precedes `pnpm test` under turbo's
 * task graph; locally run `pnpm build` first). Skipped gracefully when dist is absent so a
 * bare `vitest` run without a build doesn't hard-fail the suite. */
const hasDist = existsSync(cliPath);
const run = (args: string[], env: Record<string, string>): string =>
  execFileSync(process.execPath, [cliPath, ...args], { encoding: 'utf-8', env: { ...process.env, ...env } });

describe.skipIf(!hasDist)('skill-analytics CLI', () => {
  let home: string;
  let claude: { root: string; projectDir: string };

  beforeAll(() => {
    home = makeHomeDir();
    claude = makeClaudeDir();
    writeTranscript(claude.projectDir, 's1.jsonl', [
      assistantSkillLine('lookout', { input: 100, output: 10 }),
      userCommandLine('lookout'),
      assistantSkillLine('deploy', { input: 5, output: 5 }),
    ]);
  });

  it('collect reports file and invocation counts', () => {
    const out = run(['--home-dir', home, '--claude-dir', claude.root, 'collect'], {});
    expect(out).toContain('1 transcript(s) seen');
    expect(out).toContain('3 new invocation(s)');
  });

  it('report --json emits the summary payload', () => {
    const out = run(['--home-dir', home, '--claude-dir', claude.root, 'report', '--json'], {});
    const summary = JSON.parse(out) as Summary;
    expect(summary.totals.invocations).toBe(3);
    expect(summary.skills.find((r) => r.name === 'lookout')).toMatchObject({ proactive: 1, explicit: 1 });
  });

  it('report renders the ccusage-style table', () => {
    const out = run(['--home-dir', home, '--claude-dir', claude.root, 'report'], {});
    expect(out).toContain('Skills & slash commands');
    expect(out).toContain('lookout');
    expect(out).toContain('Proactive');
  });

  it('dead --json lists nothing for a home with no installed skills', () => {
    const out = run(['--home-dir', home, '--claude-dir', claude.root, 'dead', '--json'], {});
    expect(JSON.parse(out)).toEqual([]);
  });
});
