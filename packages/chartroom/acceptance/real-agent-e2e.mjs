#!/usr/bin/env node
// v1.1 acceptance script (plan §4.C) -- the LAST unproven ChartRoom_Spec §9 DoD line: a REAL
// agent (headless `claude -p`), in a scratch Chart-Room-enabled repo, (A) self-recovers a moved
// doc via the installed PostToolUseFailure hook + chart-room skill without being told the new
// path, and (B) posts an `:::ask-me` question that a (script-simulated) human answers and the
// resumed agent reads back.
//
// DELIBERATELY NOT part of `test:acceptance` (FO direction): it needs a logged-in `claude`
// binary, burns real quota, and is nondeterministic (LLM judgment). Run manually:
//   node acceptance/real-agent-e2e.mjs
// Flake policy (plan §4.C): one retry of the full chain; BOTH attempts are logged honestly; the
// scratch repo is preserved on failure for post-mortem.
//
// R4 facts baked in (researcher report, verified on claude CLI 2.1.201, 2026-07-05): hooks fire
// in -p mode (never pass --bare/--safe-mode); minimal --allowedTools instead of
// skip-permissions; --output-format json carries result+session_id; --resume is cwd-scoped (both
// phases run from the scratch repo); do NOT pass --no-session-persistence; --max-turns +
// --max-budget-usd as caps.
//
// Prerequisite: `npm run build` in packages/chartroom (dist/cli.js present) + a logged-in claude.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_JS = join(HERE, '..', 'dist', 'cli.js');
const INTERACTIVE_BLOCKS_JS = join(HERE, '..', 'dist', 'interactive-blocks.js');

// A heading string that exists nowhere else -- the ONLY way the agent can report it is by
// actually reading the moved file.
const UNIQUE_HEADING = 'Alpha Cormorant Beacon 7391';
const PLANTED_ANSWER = 'Auth0 via OIDC, tenant "ship-crew"';

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function chartroom(cwd, args) {
  const out = spawnSync(process.execPath, [CLI_JS, ...args], { cwd, encoding: 'utf8', timeout: 60_000 });
  assert(out.status === 0, `chartroom ${args.join(' ')} exited ${out.status}: ${out.stderr}`);
  return out.stdout;
}

/** Env for the claude child: CHARTROOM_BIN points the installed hook at the locally built CLI
 * (no npx/PATH uncertainty); CLAUDE_* nesting markers scrubbed for determinism (R4 (vii): not
 * strictly required on 2.1.201, but cheap insurance). */
function claudeEnv() {
  const env = { ...process.env, CHARTROOM_BIN: `${process.execPath} ${CLI_JS}` };
  for (const key of Object.keys(env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) delete env[key];
  }
  return env;
}

function runClaude(cwd, prompt, args, label) {
  console.log(`\n--- claude ${label} ---`);
  // The prompt goes in via STDIN (the documented headless pattern), never as a positional arg:
  // on Windows `claude` is a .cmd shim (needs `shell: true`), and shell mode concatenates args
  // UNQUOTED -- a prompt containing spaces/quotes would be shredded (observed empirically on the
  // first run of this script). Remaining args are all quote-free single tokens.
  const out = spawnSync('claude', args, {
    cwd,
    encoding: 'utf8',
    env: claudeEnv(),
    input: prompt,
    timeout: 300_000,
    shell: process.platform === 'win32', // claude is a .cmd shim on Windows
  });
  console.log(`exit=${out.status}`);
  console.log(`stdout: ${out.stdout}`);
  if (out.stderr?.trim()) console.log(`stderr: ${out.stderr}`);
  assert(out.status === 0, `claude ${label} exited ${out.status}`);
  const payload = JSON.parse(out.stdout);
  assert(payload.type === 'result' && !payload.is_error, `claude ${label} returned an error payload`);
  return payload;
}

async function attempt(attemptNo) {
  const scratch = mkdtempSync(join(tmpdir(), `chartroom-real-agent-e2e-${attemptNo}-`));
  console.log(`\n=== attempt ${attemptNo}: scratch repo ${scratch} ===`);

  // 1. Chart-Room-enabled scratch repo: id-carrying docs with id-links, index, skill, hook.
  git(scratch, ['init', '-q']);
  git(scratch, ['config', 'user.email', 'acceptance@chartroom.test']);
  git(scratch, ['config', 'user.name', 'Chart Room Acceptance']);
  mkdirSync(join(scratch, 'docs'), { recursive: true });
  writeFileSync(
    join(scratch, 'docs', 'alpha.md'),
    `---\nid: alpha-doc\n---\n\n# ${UNIQUE_HEADING}\n\nAuthoritative alpha notes.\n`,
    'utf8',
  );
  writeFileSync(
    join(scratch, 'docs', 'beta.md'),
    `---\nid: beta-doc\n---\n\n# Beta\n\nSee [Alpha](alpha.md "id:alpha-doc").\n`,
    'utf8',
  );
  writeFileSync(
    join(scratch, 'CLAUDE.md'),
    `# Scratch repo\n\n## Chart Room\n\nThis repo's markdown docs are managed by Chart Room ` +
      `(.docs/index.json). When a doc Read fails, resolve by id instead of asking a human.\n`,
    'utf8',
  );
  chartroom(scratch, ['index']);
  chartroom(scratch, ['install-skill']);
  chartroom(scratch, ['install-agent-hook']);
  assert(existsSync(join(scratch, '.claude', 'skills', 'chart-room', 'SKILL.md')), 'skill installed');
  const settings = JSON.parse(readFileSync(join(scratch, '.claude', 'settings.json'), 'utf8'));
  assert(settings.hooks?.PostToolUseFailure?.length > 0, 'PostToolUseFailure hook installed (R4: validate the JSON)');
  git(scratch, ['add', '.']);
  git(scratch, ['commit', '-q', '-m', 'chart-room enabled scratch repo']);

  // 2. Move the doc; keep the index CURRENT (the agent's Read of the STALE path is what must
  //    self-correct via the hook -- we never tell it the new path).
  mkdirSync(join(scratch, 'guides'), { recursive: true });
  git(scratch, ['mv', 'docs/alpha.md', 'guides/alpha.md']);
  chartroom(scratch, ['index']);
  git(scratch, ['add', '-A']);
  git(scratch, ['commit', '-q', '-m', 'move alpha']);

  // 3. Phase A -- moved-doc resolution through the real hook.
  const phaseA = runClaude(
    scratch,
    'Read the file docs/alpha.md and report its exact first heading text. If the read fails, ' +
      'follow whatever guidance you receive to locate the moved file yourself. Do not ask me anything.',
    [
      '-p',
      '--output-format',
      'json',
      '--allowedTools',
      'Read',
      '--max-turns',
      '8',
      '--max-budget-usd',
      '1',
      '--model',
      'haiku',
    ],
    'phase A (moved-doc resolution)',
  );
  assert(
    phaseA.result.includes(UNIQUE_HEADING),
    `phase A: agent reported the heading that exists ONLY in the moved file (got: ${phaseA.result})`,
  );
  const sessionId = phaseA.session_id;
  assert(typeof sessionId === 'string' && sessionId.length > 0, 'phase A: session_id captured');
  console.log(`phase A PASSED: stale-path Read self-corrected to guides/alpha.md (session ${sessionId})`);

  // 4. Phase B -- agent posts an :::ask-me question.
  runClaude(
    scratch,
    'Using the chart-room skill\'s ask-me syntax, append to guides/alpha.md an :::ask-me block ' +
      '(type "text", a stable id attribute) asking the human: "Which auth provider should we use?". ' +
      'Do not answer it yourself. Reply done when written.',
    [
      '-p',
      '--resume',
      sessionId,
      '--output-format',
      'json',
      '--allowedTools',
      'Read,Write,Edit',
      '--max-turns',
      '8',
      '--max-budget-usd',
      '1',
      '--model',
      'haiku',
    ],
    'phase B1 (post ask-me question)',
  );

  const blocks = await import(pathToFileURL(INTERACTIVE_BLOCKS_JS).href);
  const alphaPath = join(scratch, 'guides', 'alpha.md');
  let raw = readFileSync(alphaPath, 'utf8');
  const { askMe } = blocks.extractInteractiveBlocks(raw);
  assert(askMe.length === 1, `phase B1: exactly one ask-me question posted (found ${askMe.length})`);
  assert(!askMe[0].answered, 'phase B1: question is unanswered');
  console.log(`phase B1 PASSED: agent posted :::ask-me (id '${askMe[0].directiveId}')`);

  // 5. Simulate the human answering (same splice the daemon's PATCH route performs).
  const answerLine = blocks.formatAnswerLine(askMe[0], PLANTED_ANSWER, '2026-07-05', 'Captain');
  const spliced = blocks.applyAskMeAnswer(raw, askMe[0].directiveId, answerLine);
  assert(spliced, 'phase B2: answer spliced');
  writeFileSync(alphaPath, spliced.newText, 'utf8');

  // 6. Phase B -- resumed agent reads the answer back.
  const phaseB = runClaude(
    scratch,
    'The human has now answered your ask-me question in guides/alpha.md. Read the file and state ' +
      'the exact answer text they gave, verbatim.',
    [
      '-p',
      '--resume',
      sessionId,
      '--output-format',
      'json',
      '--allowedTools',
      'Read',
      '--max-turns',
      '6',
      '--max-budget-usd',
      '1',
      '--model',
      'haiku',
    ],
    'phase B2 (read answer back)',
  );
  assert(
    phaseB.result.includes('Auth0'),
    `phase B2: agent stated the planted answer (got: ${phaseB.result})`,
  );
  console.log('phase B2 PASSED: answer flowed doc -> agent end-to-end');

  rmSync(scratch, { recursive: true, force: true });
  return true;
}

async function main() {
  assert(existsSync(CLI_JS), `build first: ${CLI_JS} missing`);
  try {
    execFileSync('claude', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
  } catch {
    throw new Error('the `claude` CLI is required (logged in) -- this script is manual-run only');
  }

  try {
    await attempt(1);
  } catch (err) {
    console.error(`\nattempt 1 FAILED: ${err.message}`);
    console.error('retrying once (flake policy: both attempts logged; scratch dir preserved on failure)...');
    await attempt(2);
  }
  console.log('\nALL ASSERTIONS PASSED (real-agent moved-doc resolution + ask-me round-trip)');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exitCode = 1;
});
