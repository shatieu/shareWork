#!/usr/bin/env node
import { Command } from 'commander';
import { registerServeCommand } from './commands/serve.js';

const program = new Command();

program
  .name('ship')
  .description("The Ship's hull -- one local process hosting every suite station behind the Captain's Deck.")
  .version('0.1.0');

registerServeCommand(program);

void program.parseAsync(process.argv);
