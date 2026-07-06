// Acceptance: Trio_Specs §A demonstrable end-to-end (plan 11).
//   fixtures (real-shaped transcripts) -> incremental collector -> CLI table+JSON -> station endpoint
// Run after `pnpm build`:  node acceptance/skill-analytics.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const results = [];
const step = (name, fn) => {
  fn();
  results.push(name);
  console.log(`PASS  ${name}`);
};

/* ── fixtures: shapes verified against real ~/.claude/projects transcripts (2026-07-06) ── */

const meta = (over = {}) => ({
  parentUuid: null,
  isSidechain: false,
  uuid: Math.random().toString(36).slice(2),
  timestamp: '2026-07-06T09:00:00.000Z',
  sessionId: 'acc-session',
  cwd: 'C:\\repos\\demo',
  version: '2.0.0',
  gitBranch: 'main',
  ...over,
});
const usage = (input, output) => ({
  input_tokens: input,
  output_tokens: output,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  service_tier: 'standard',
});
const skillLine = (skill, input, output, over = {}) =>
  JSON.stringify({
    ...meta(over),
    type: 'assistant',
    message: {
      role: 'assistant',
      model: 'claude-fable-5',
      content: [{ type: 'tool_use', id: 't1', name: 'Skill', input: { skill } }],
      usage: usage(input, output),
    },
  });
const agentLine = (subagentType) =>
  JSON.stringify({
    ...meta(),
    type: 'assistant',
    message: {
      role: 'assistant',
      model: 'claude-fable-5',
      content: [{ type: 'tool_use', id: 't2', name: 'Agent', input: { description: 'd', prompt: 'p', subagent_type: subagentType } }],
      usage: usage(5, 5),
    },
  });
const assistantText = (input, output) =>
  JSON.stringify({
    ...meta(),
    type: 'assistant',
    message: { role: 'assistant', model: 'claude-fable-5', content: [{ type: 'text', text: 'working' }], usage: usage(input, output) },
  });
const commandLine = (command) =>
  JSON.stringify({
    ...meta(),
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: `<command-name>/${command}</command-name>\n<command-message>${command}</command-message>\n<command-args></command-args>` }],
    },
  });
const userPrompt = (text) => JSON.stringify({ ...meta(), type: 'user', message: { role: 'user', content: text } });

/* ── stage the world: claude dir, home dir with one dead skill installed ── */

const home = mkdtempSync(join(tmpdir(), 'sa-acc-home-'));
const claudeRoot = mkdtempSync(join(tmpdir(), 'sa-acc-claude-'));
const projectDir = join(claudeRoot, 'C--repos-demo');
mkdirSync(projectDir, { recursive: true });

const deadSkillDir = join(home, '.claude', 'skills', 'dusty-anchor');
mkdirSync(deadSkillDir, { recursive: true });
writeFileSync(join(deadSkillDir, 'SKILL.md'), '# never fired\n');

const transcript = join(projectDir, 'acc-session.jsonl');
writeFileSync(
  transcript,
  [
    JSON.stringify({ type: 'mode', mode: 'normal', sessionId: 'acc-session' }), // metadata noise
    userPrompt('please deploy'),
    skillLine('deploy', 100, 10), //  proactive #1, window opens
    assistantText(50, 5), //           accrues -> deploy = 150/15
    userPrompt('thanks'), //           closes window
    commandLine('deploy'), //          explicit #1 (ratio becomes 1/2)
    agentLine('wave-reviewer'),
    'garbage not json {{{',
  ].join('\n') + '\n',
);

const cli = join(import.meta.dirname, '..', 'dist', 'cli.js');
const run = (...args) =>
  execFileSync(process.execPath, [cli, '--home-dir', home, '--claude-dir', claudeRoot, ...args], { encoding: 'utf-8' });

/* ── 1. collector (incremental) ── */

step('collector ingests fixture transcripts (5 invocations-bearing lines, 3 invocations)', () => {
  const out = run('collect');
  assert.match(out, /1 transcript\(s\) seen/);
  assert.match(out, /3 new invocation\(s\)/);
});

step('collector is incremental: second run parses nothing new', () => {
  assert.match(run('collect'), /0 new invocation\(s\)/);
});

step('collector picks up appended lines only', () => {
  appendFileSync(transcript, skillLine('deploy', 1, 1, { timestamp: '2026-07-06T10:00:00.000Z' }) + '\n');
  assert.match(run('collect'), /1 new invocation\(s\)/);
});

/* ── 2. CLI report: table + JSON (ccusage-style) ── */

let summary;
step('CLI --json reports counts, proactive/explicit ratio, attributed tokens, dead skill', () => {
  summary = JSON.parse(run('report', '--json'));
  const deploy = summary.skills.find((r) => r.name === 'deploy');
  assert.ok(deploy, 'deploy row exists');
  assert.equal(deploy.total, 3); // 2 proactive + 1 explicit
  assert.equal(deploy.proactive, 2);
  assert.equal(deploy.explicit, 1);
  assert.equal(deploy.inputTokens, 151); // 100 + 50 accrued + 1 appended
  assert.equal(deploy.outputTokens, 16);
  assert.deepEqual(deploy.projects, ['demo']);
  assert.equal(summary.agents[0].name, 'wave-reviewer');
  assert.ok(summary.deadSkills.some((d) => d.name === 'dusty-anchor' && d.lastSeen === null), 'dusty-anchor is dead');
  assert.ok(summary.trend.length >= 1, 'trend present');
});

step('CLI table output renders the ccusage-style report', () => {
  const table = run('report', '--no-collect');
  assert.match(table, /Skills & slash commands/);
  assert.match(table, /deploy/);
  assert.match(table, /Proactive/);
  assert.match(table, /dusty-anchor/);
});

/* ── 3. station endpoint: the JSON the console panel renders ── */

const { default: Fastify } = await import('fastify');
const { createSkillAnalyticsStation } = await import('../dist/station.js');

await (async () => {
  const station = createSkillAnalyticsStation({ homeDir: home, claudeDir: claudeRoot });
  const app = Fastify({ logger: false });
  await station.registerRoutes(app, { getContract: () => undefined, log: () => {} });
  await app.ready();

  const res = await app.inject({ method: 'GET', url: '/api/skill-analytics/summary' });
  assert.equal(res.statusCode, 200);
  const fromStation = res.json();
  const deploy = fromStation.skills.find((r) => r.name === 'deploy');
  assert.equal(deploy.total, 3);
  assert.equal(deploy.inputTokens, 151);
  assert.ok(fromStation.deadSkills.some((d) => d.name === 'dusty-anchor'));

  const denied = await app.inject({ method: 'POST', url: '/api/skill-analytics/collect' });
  assert.equal(denied.statusCode, 403);
  const allowed = await app.inject({ method: 'POST', url: '/api/skill-analytics/collect', headers: { 'x-ship-deck': '1' } });
  assert.equal(allowed.statusCode, 200);

  await app.close();
  await station.stop();
  results.push('station endpoint');
  console.log('PASS  station /api/skill-analytics/summary matches the CLI numbers; collect POST is CSRF-gated');
})();

console.log(`\nACCEPTANCE PASS: ${results.length}/6 steps — collector -> CLI -> station endpoint all agree.`);
