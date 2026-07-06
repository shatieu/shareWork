#!/usr/bin/env node
import { homedir } from 'node:os';
import { Command } from 'commander';
import { openSkillAnalyticsDb, skillAnalyticsDbPath } from './db.js';
import { collectTranscripts } from './collect.js';
import { defaultClaudeProjectsDir } from './transcripts.js';
import { listInstalledSkills } from './installed.js';
import { buildSummary, findDeadSkills, knownProjectDirs, type ReportRow, type Summary } from './report.js';

interface GlobalOpts {
  homeDir: string;
  claudeDir: string;
}

function resolveGlobals(cmd: Command): GlobalOpts {
  const opts = cmd.optsWithGlobals<{ homeDir?: string; claudeDir?: string }>();
  const homeDir = opts.homeDir ?? homedir();
  return {
    homeDir,
    claudeDir: opts.claudeDir ?? defaultClaudeProjectsDir(homeDir),
  };
}

/* ── ccusage-style plain table (no dependency): padded columns, totals row ── */

function pad(value: string, width: number, right = false): string {
  return right ? value.padStart(width) : value.padEnd(width);
}

function renderTable(headers: string[], rows: string[][], rightAligned: boolean[]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) =>
    '│ ' + cells.map((c, i) => pad(c, widths[i], rightAligned[i])).join(' │ ') + ' │';
  const rule = (l: string, m: string, r: string) =>
    l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r;
  return [
    rule('┌', '┬', '┐'),
    line(headers),
    rule('├', '┼', '┤'),
    ...rows.map(line),
    rule('└', '┴', '┘'),
  ].join('\n');
}

function fmtCount(n: number): string {
  return n.toLocaleString('en-US');
}

function reportTable(rows: ReportRow[], title: string): string {
  if (rows.length === 0) return `${title}: no invocations recorded.`;
  const table = renderTable(
    ['Name', 'Total', 'Proactive', 'Explicit', 'Ratio', 'Input Tok', 'Output Tok', 'Cache Read', 'Last Seen'],
    rows.map((r) => [
      r.name,
      fmtCount(r.total),
      fmtCount(r.proactive),
      fmtCount(r.explicit),
      r.proactiveRatio === null ? '—' : `${Math.round(r.proactiveRatio * 100)}%`,
      fmtCount(r.inputTokens),
      fmtCount(r.outputTokens),
      fmtCount(r.cacheReadTokens),
      r.lastSeen ? r.lastSeen.slice(0, 10) : '—',
    ]),
    [false, true, true, true, true, true, true, true, false],
  );
  return `${title}\n${table}`;
}

function printSummary(summary: Summary): void {
  console.log(reportTable(summary.skills, 'Skills & slash commands'));
  console.log('');
  console.log(reportTable(summary.agents, 'Agents (by subagent_type)'));
  console.log('');
  if (summary.deadSkills.length > 0) {
    console.log(`Dead skills (installed, silent ≥ ${summary.options.deadDays} days): ${summary.deadSkills.length}`);
    for (const dead of summary.deadSkills) {
      const silence = dead.lastSeen === null ? 'never fired' : `${dead.daysSilent}d silent (last ${dead.lastSeen.slice(0, 10)})`;
      console.log(`  - ${dead.name} [${dead.scope}] ${silence}`);
    }
  } else {
    console.log('Dead skills: none 🎉');
  }
  console.log('');
  console.log(
    `Total: ${fmtCount(summary.totals.invocations)} invocations across ` +
      `${summary.totals.skills} skills/commands and ${summary.totals.agents} agent types.`,
  );
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('skill-analytics')
    .description(
      '"ccusage for skills": which skills/agents/slash-commands fire, what they cost, which are dead weight. ' +
        'Local-only — parses your own Claude Code transcripts, stores identifiers + token counts, never uploads.',
    )
    .option('--home-dir <path>', 'home directory override (store lives at <home>/.ship/skill-analytics.db)')
    .option('--claude-dir <path>', 'transcript root override (default: <home>/.claude/projects)');

  program
    .command('collect')
    .description('Incrementally parse transcripts into the local store (cursor per file; zero config).')
    .action(function (this: Command) {
      const { homeDir, claudeDir } = resolveGlobals(this);
      const db = openSkillAnalyticsDb(homeDir);
      try {
        const result = collectTranscripts(db, claudeDir);
        console.log(
          `skill-analytics: ${result.filesSeen} transcript(s) seen, ${result.filesParsed} parsed, ` +
            `${result.linesParsed} new line(s), ${result.newInvocations} new invocation(s).`,
        );
        console.log(`store: ${skillAnalyticsDbPath(homeDir)}`);
      } finally {
        db.close();
      }
    });

  program
    .command('report')
    .description('Trigger counts, proactive/explicit ratio, attributed tokens, dead skills.')
    .option('--json', 'JSON output instead of the table')
    .option('--project <name>', 'restrict to one project (basename of the session cwd)')
    .option('--days <n>', 'only invocations from the last N days', (v) => Number.parseInt(v, 10))
    .option('--dead-days <n>', 'dead-skill silence threshold in days (default 30)', (v) => Number.parseInt(v, 10))
    .option('--no-collect', 'skip the incremental collect pass before reporting')
    .action(function (this: Command, opts: { json?: boolean; project?: string; days?: number; deadDays?: number; collect: boolean }) {
      const { homeDir, claudeDir } = resolveGlobals(this);
      const db = openSkillAnalyticsDb(homeDir);
      try {
        if (opts.collect) collectTranscripts(db, claudeDir);
        const installed = listInstalledSkills({ homeDir, projectDirs: knownProjectDirs(db) });
        const summary = buildSummary(db, installed, {
          project: opts.project,
          days: opts.days,
          deadDays: opts.deadDays,
        });
        if (opts.json) {
          console.log(JSON.stringify(summary, null, 2));
        } else {
          printSummary(summary);
        }
      } finally {
        db.close();
      }
    });

  program
    .command('dead')
    .description('Installed skills that have been silent for N days (default 30).')
    .option('--days <n>', 'silence threshold in days', (v) => Number.parseInt(v, 10), 30)
    .option('--json', 'JSON output')
    .option('--no-collect', 'skip the incremental collect pass first')
    .action(function (this: Command, opts: { days: number; json?: boolean; collect: boolean }) {
      const { homeDir, claudeDir } = resolveGlobals(this);
      const db = openSkillAnalyticsDb(homeDir);
      try {
        if (opts.collect) collectTranscripts(db, claudeDir);
        const installed = listInstalledSkills({ homeDir, projectDirs: knownProjectDirs(db) });
        const dead = findDeadSkills(db, installed, { days: opts.days });
        if (opts.json) {
          console.log(JSON.stringify(dead, null, 2));
        } else if (dead.length === 0) {
          console.log('Dead skills: none 🎉');
        } else {
          for (const skill of dead) {
            const silence = skill.lastSeen === null ? 'never fired' : `${skill.daysSilent}d silent`;
            console.log(`${skill.name} [${skill.scope}] ${silence} (${skill.origin})`);
          }
        }
      } finally {
        db.close();
      }
    });

  return program;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('cli.js') || process.argv[1].endsWith('skill-analytics'));
if (invokedDirectly) {
  buildProgram().parse();
}
