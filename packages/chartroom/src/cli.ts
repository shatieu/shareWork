#!/usr/bin/env node
import { Command } from 'commander';
import { runPreCommitHook } from './hook.js';
import { registerInitCommand } from './commands/init.js';
import { registerIndexCommand } from './commands/index.js';
import { registerResolveCommand } from './commands/resolve.js';
import { registerFixLinksCommand } from './commands/fix-links.js';
import { registerCheckCommand } from './commands/check.js';

const program = new Command();

program
  .name('chartroom')
  .description(
    'Local-first markdown doc indexer, id-based link resolver, and pre-commit link-repair hook.',
  )
  .version('0.1.0');

registerInitCommand(program);
registerIndexCommand(program);
registerResolveCommand(program);
registerFixLinksCommand(program);
registerCheckCommand(program);

// Hidden command: manually invoke the pre-commit hook logic without going through a real git
// commit. The installed `.git/hooks/pre-commit` shim (see install-hook.ts) does NOT go through
// this CLI entrypoint -- it `import()`s dist/hook.js directly, in-process, to avoid any
// PATH/npx resolution uncertainty (plan §9.4). This command exists for manual debugging only.
program
  .command('hook-pre-commit', { hidden: true })
  .description('Run the pre-commit hook logic directly (normally invoked by the installed git hook).')
  .action(() => {
    runPreCommitHook();
  });

void program.parseAsync(process.argv);
