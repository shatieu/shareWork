import type { Command } from 'commander';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { findGitRoot } from '../repo.js';
import { buildMcpServer } from '../mcp/server.js';
import { createStdioRepoContext } from '../mcp/repo-context.js';

/**
 * `chartroom mcp` (plan §1.1/§2/§7): runs the Chart Room MCP server over stdio, scoped to the
 * cwd's git root -- exactly like every other phase-1 CLI command's "cwd-scoped, nearest ancestor
 * .git" convention (no `repoId` parameter; single repo per process). This is the long-running,
 * foreground process a client (Claude Code's own `.mcp.json`/`claude mcp add`, or any other MCP
 * client) launches as a subprocess -- it never calls `process.exit()` itself; it stays alive until
 * the client closes stdin, at which point `StdioServerTransport` closes and the process exits
 * naturally when the event loop drains.
 */
export function registerMcpCommand(program: Command): void {
  program
    .command('mcp')
    .description("Run the Chart Room MCP server over stdio, scoped to the cwd's git repo.")
    .action(async () => {
      let repoRoot: string;
      try {
        repoRoot = findGitRoot(process.cwd());
      } catch (err) {
        console.error(`chartroom: ${(err as Error).message}`);
        process.exitCode = 1;
        return;
      }

      const server = buildMcpServer(() => createStdioRepoContext(repoRoot));
      const transport = new StdioServerTransport();
      await server.connect(transport);
    });
}
