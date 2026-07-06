#!/usr/bin/env node
import { homedir } from 'node:os';
import { resolve as resolvePath } from 'node:path';
import { Command } from 'commander';
import { computeEffectiveSettings } from './merge.js';
import { loadScopes } from './scopes.js';
import { simulate } from './simulator.js';

/**
 * Minimal standalone CLI (plan 07 §3): the read-only half of the product for terminals and
 * scripts. All EDITING deliberately lives behind the Deck UI's diff-preview flow (or direct
 * library use) -- a CLI write flag would bypass the "human saw the diff" rail.
 */
const program = new Command();
program
  .name('settings-manager')
  .description("Claude Code settings: effective view + permission simulator (read-only CLI; editing lives on the Captain's Deck).");

program
  .command('effective')
  .description('Print the merged effective settings with per-key/per-rule source attribution.')
  .option('--project <dir>', 'project directory for project/local scopes', process.cwd())
  .action((opts: { project: string }) => {
    const scopes = loadScopes({ projectDir: resolvePath(opts.project) });
    console.log(JSON.stringify(computeEffectiveSettings(scopes), null, 2));
  });

program
  .command('simulate')
  .description(`Verdict for a hypothetical tool call, e.g.: simulate Bash --command "rm -rf ./dist"`)
  .argument('<tool>', 'tool name (Bash, PowerShell, Read, Edit, WebFetch, mcp__server__tool, ...)')
  .option('--command <cmd>', 'command line (Bash/PowerShell rules)')
  .option('--path <path>', 'file path (Read/Edit rules)')
  .option('--url <url>', 'URL (WebFetch domain rules)')
  .option('--input <json>', 'raw tool input JSON (param rules)')
  .option('--project <dir>', 'project directory', process.cwd())
  .action((tool: string, opts: { command?: string; path?: string; url?: string; input?: string; project: string }) => {
    const projectDir = resolvePath(opts.project);
    let input: Record<string, unknown> | undefined;
    if (opts.input) {
      try {
        input = JSON.parse(opts.input) as Record<string, unknown>;
      } catch (err) {
        console.error(`settings-manager: --input is not valid JSON: ${(err as Error).message}`);
        process.exitCode = 2;
        return;
      }
    }
    const scopes = loadScopes({ projectDir });
    const verdict = simulate(
      computeEffectiveSettings(scopes),
      { tool, command: opts.command, path: opts.path, url: opts.url, input },
      { cwd: projectDir, homeDir: homedir(), projectDir },
    );
    console.log(JSON.stringify(verdict, null, 2));
    if (verdict.behavior === 'deny') process.exitCode = 1;
  });

program.parse();
