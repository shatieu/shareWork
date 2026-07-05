#!/usr/bin/env node
// Phase-5 acceptance script (plan §8.3) proving the Build Order §8 item 5 literal acceptance line's
// MECHANICAL half: "a fresh Claude Code session in a Chart-Room repo resolves a moved doc and
// answers flow end-to-end without human path-fixing." Same disposable-scratch-repo discipline as
// every prior phase's own acceptance script.
//
// ============================================================================================
// HONESTY NOTE -- read before treating a green run of this script as "the acceptance line is done".
// ============================================================================================
// This script proves every MECHANICAL piece genuinely works, end-to-end, driven by real protocol
// clients wherever the SDK offers one: the CLI commands, a real MCP `Client` over a real
// `chartroom mcp` stdio subprocess, a real `git mv`, a real simulated human answer. That is a
// materially stronger automated proof than "call an internal function and check its return value".
//
// It does NOT, and structurally CANNOT, prove the acceptance line's other half: that a fresh
// Claude Code session's own judgment actually *chooses* to call `resolve`/notice the hook's
// guidance/use the skill's instructions correctly, unprompted, when given a real task. That is a
// claim about an LLM's own behavior in a live session, not a claim about whether the underlying
// tools function correctly -- no script can prove an agent *will* behave a certain way, only that
// the tools it *would* use, if it chooses to, work correctly. This script proves the mechanical
// substrate only. A real live Claude Code session pass (against this same kind of scratch repo,
// with the skill/hook/`.mcp.json` installed) is the honest way to close the remaining gap -- see
// suite-design/overnight/DECISIONS-NEEDED.md "Package 5" for this being named explicitly, not
// papered over.
// ============================================================================================
//
// Prerequisite: the package must already be built (dist/cli.js, dist/interactive-blocks.js present).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(HERE, '..', 'dist', 'cli.js');
const INTERACTIVE_BLOCKS_MODULE_PATH = join(HERE, '..', 'dist', 'interactive-blocks.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
}

function runCli(cwd, args) {
  return execFileSync(process.execPath, [CLI_PATH, ...args], { cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
}

function writeDoc(scratchDir, relPath, content) {
  const abs = join(scratchDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function parseToolResult(result) {
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') {
    throw new Error(`unexpected tool result shape: ${JSON.stringify(result)}`);
  }
  return JSON.parse(first.text);
}

async function main() {
  for (const p of [CLI_PATH, INTERACTIVE_BLOCKS_MODULE_PATH]) {
    if (!existsSync(p)) {
      throw new Error(
        `built module not found (expected ${p}) -- run "npx tsc -p packages/chartroom/tsconfig.json" ` +
          `(or "npm run build" from packages/chartroom/) before running this acceptance script.`,
      );
    }
  }
  const { applyAskMeAnswer, formatAnswerLine, extractInteractiveBlocks } = await import(
    pathToFileURL(INTERACTIVE_BLOCKS_MODULE_PATH).href
  );

  const scratchDir = mkdtempSync(join(tmpdir(), 'chartroom-agent-surface-acceptance-'));
  let mcpClient;
  try {
    // --- Step 1: scaffold a scratch git repo with docs, one carrying a pending :::ask-me block. ---
    git(scratchDir, ['init', '-q']);
    git(scratchDir, ['config', 'user.email', 'acceptance@chartroom.test']);
    git(scratchDir, ['config', 'user.name', 'Chart Room Acceptance']);
    git(scratchDir, ['config', 'core.autocrlf', 'false']);

    writeDoc(
      scratchDir,
      'docs/decision.md',
      [
        '# Auth strategy',
        '',
        ':::ask-me{id="q-01" type="yesno"}',
        'Should we use OAuth?',
        ':::',
        '',
      ].join('\n'),
    );
    writeDoc(scratchDir, 'docs/other.md', '# Another doc\n\nSome content.\n');
    git(scratchDir, ['add', '-A']);
    git(scratchDir, ['commit', '-q', '-m', 'initial docs']);

    // --- Step 2: `chartroom init` (assigns ids), `install-agent-hook`, `install-skill` -- assert
    //     all three artifacts exist on disk with the expected content/idempotency markers. ---
    runCli(scratchDir, ['init']);
    const decisionRaw = readFileSync(join(scratchDir, 'docs/decision.md'), 'utf8');
    const idMatch = /^id: (\S+)$/m.exec(decisionRaw);
    assert(idMatch, 'expected `chartroom init` to inject an id into docs/decision.md');
    const decisionId = idMatch[1];

    runCli(scratchDir, ['install-agent-hook']);
    const hookScriptPath = join(scratchDir, '.claude', 'hooks', 'chartroom-post-tool-use.mjs');
    assert(existsSync(hookScriptPath), 'expected the agent hook script to be installed');
    assert(
      readFileSync(hookScriptPath, 'utf8').includes('chartroom:managed-post-tool-use-hook'),
      'expected the installed hook script to carry the chartroom marker',
    );
    const settings = JSON.parse(readFileSync(join(scratchDir, '.claude', 'settings.json'), 'utf8'));
    assert(
      settings.hooks?.PostToolUseFailure?.some((e) => e.matcher === 'Read'),
      'expected settings.json to carry a PostToolUseFailure/Read entry',
    );

    runCli(scratchDir, ['install-skill']);
    const skillPath = join(scratchDir, '.claude', 'skills', 'chart-room', 'SKILL.md');
    assert(existsSync(skillPath), 'expected the chart-room skill to be installed');
    assert(readFileSync(skillPath, 'utf8').includes('name: chart-room'), 'expected the installed skill to carry its own frontmatter marker');

    // Idempotency: re-running install-agent-hook/install-skill must not duplicate/corrupt anything.
    runCli(scratchDir, ['install-agent-hook']);
    runCli(scratchDir, ['install-skill']);
    const settingsAfterSecondRun = JSON.parse(readFileSync(join(scratchDir, '.claude', 'settings.json'), 'utf8'));
    assert(
      settingsAfterSecondRun.hooks.PostToolUseFailure.length === 1,
      'expected re-running install-agent-hook to stay idempotent (no duplicate entries)',
    );

    // --- Step 3: real `git mv`, staged. ---
    mkdirSync(join(scratchDir, 'docs', 'moved'), { recursive: true });
    git(scratchDir, ['mv', 'docs/decision.md', 'docs/moved/decision.md']);

    // --- Step 4: connect a real MCP Client to a `chartroom mcp` stdio subprocess spawned against
    //     this scratch repo -> call resolve(<old-id>) -> assert the corrected new path. ---
    const transport = new StdioClientTransport({ command: process.execPath, args: [CLI_PATH, 'mcp'], cwd: scratchDir });
    mcpClient = new Client({ name: 'chartroom-acceptance-client', version: '0.0.0' });
    await mcpClient.connect(transport);

    const { tools } = await mcpClient.listTools();
    assert(
      ['resolve', 'read_doc', 'search', 'list_unanswered_questions', 'answer_status'].every((name) =>
        tools.some((t) => t.name === name),
      ),
      `expected all five MCP tools to be listed, got: ${tools.map((t) => t.name).join(', ')}`,
    );

    const resolveResult = parseToolResult(await mcpClient.callTool({ name: 'resolve', arguments: { query: decisionId } }));
    assert(resolveResult.matchType === 'id', `expected matchType 'id', got '${resolveResult.matchType}'`);
    assert(
      resolveResult.path === 'docs/moved/decision.md',
      `expected the corrected path 'docs/moved/decision.md', got '${resolveResult.path}'`,
    );

    // --- Step 5: simulate a human's browser answer directly against the doc's raw text (same
    //     technique phase 4's own acceptance script uses), then call answer_status over the same
    //     MCP connection -> assert answered: true with the correct answer text. ---
    const movedPath = join(scratchDir, 'docs/moved/decision.md');
    const rawBeforeAnswer = readFileSync(movedPath, 'utf8');
    const { askMe } = extractInteractiveBlocks(rawBeforeAnswer);
    const question = askMe.find((q) => q.directiveId === 'q-01');
    assert(question, 'expected the moved doc to still carry its :::ask-me question after the git mv');

    const answerLine = formatAnswerLine(question, 'yes', '2026-07-05', 'Acceptance Script');
    const applied = applyAskMeAnswer(rawBeforeAnswer, 'q-01', answerLine);
    assert(applied, 'expected applyAskMeAnswer to find and splice the q-01 block');
    writeFileSync(movedPath, applied.newText, 'utf8');

    const answerStatusResult = parseToolResult(await mcpClient.callTool({ name: 'answer_status', arguments: { question_id: 'q-01' } }));
    assert(answerStatusResult.matchType === 'found', `expected matchType 'found', got '${answerStatusResult.matchType}'`);
    assert(answerStatusResult.answered === true, 'expected answered: true after the simulated human answer');
    assert(
      answerStatusResult.answerText.includes('Yes'),
      `expected the answer text to include 'Yes', got '${answerStatusResult.answerText}'`,
    );

    await mcpClient.close();
    mcpClient = undefined;

    // --- Step 6: `chartroom llms-txt` -> assert the emitted file lists all (non-deleted) docs,
    //     including the moved one at its corrected path. ---
    runCli(scratchDir, ['llms-txt', '--out', 'llms.txt']);
    const llmsTxt = readFileSync(join(scratchDir, 'llms.txt'), 'utf8');
    assert(llmsTxt.includes('docs/moved/decision.md'), 'expected llms.txt to list the moved doc at its corrected path');
    assert(!llmsTxt.includes('docs/decision.md)'), 'expected llms.txt to no longer list the doc at its stale pre-move path');
    assert(llmsTxt.includes('docs/other.md'), 'expected llms.txt to list the untouched second doc too');

    console.log('chartroom acceptance: agent-surface-e2e -- ALL ASSERTIONS PASSED (mechanical substrate only -- see this script\'s own header comment)');
  } finally {
    if (mcpClient) {
      await mcpClient.close().catch(() => undefined);
    }
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(String(err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
