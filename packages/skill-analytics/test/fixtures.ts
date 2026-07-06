import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Fixture builders producing transcript lines in the EXACT shapes verified against real
 * `~/.claude/projects` transcripts on 2026-07-06 (plan 11 §1). Synthetic content only —
 * no real transcript data is ever committed.
 */

export interface LineOpts {
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  isSidechain?: boolean;
}

const base = (opts: LineOpts) => ({
  parentUuid: null,
  isSidechain: opts.isSidechain ?? false,
  uuid: 'u-' + Math.random().toString(36).slice(2),
  timestamp: opts.timestamp ?? '2026-07-06T10:00:00.000Z',
  sessionId: opts.sessionId ?? 'session-1',
  cwd: opts.cwd ?? 'C:\\repos\\alpha',
  userType: 'external',
  version: '2.0.0',
  gitBranch: 'main',
});

export function assistantSkillLine(skill: string, usage: Partial<UsageSpec> = {}, opts: LineOpts = {}): string {
  return JSON.stringify({
    ...base(opts),
    type: 'assistant',
    message: {
      role: 'assistant',
      model: 'claude-fable-5',
      content: [
        { type: 'text', text: 'Loading the skill.' },
        { type: 'tool_use', id: 'toolu_1', name: 'Skill', input: { skill } },
      ],
      usage: usageBlock(usage),
    },
  });
}

export function assistantAgentLine(subagentType: string | undefined, usage: Partial<UsageSpec> = {}, opts: LineOpts = {}): string {
  const input: Record<string, unknown> = { description: 'do a thing', prompt: 'go' };
  if (subagentType) input.subagent_type = subagentType;
  return JSON.stringify({
    ...base(opts),
    type: 'assistant',
    message: {
      role: 'assistant',
      model: 'claude-fable-5',
      content: [{ type: 'tool_use', id: 'toolu_2', name: 'Agent', input }],
      usage: usageBlock(usage),
    },
  });
}

export interface UsageSpec {
  input: number;
  output: number;
  cacheCreate: number;
  cacheRead: number;
}

function usageBlock(spec: Partial<UsageSpec>): Record<string, unknown> {
  return {
    input_tokens: spec.input ?? 0,
    output_tokens: spec.output ?? 0,
    cache_creation_input_tokens: spec.cacheCreate ?? 0,
    cache_read_input_tokens: spec.cacheRead ?? 0,
    service_tier: 'standard',
  };
}

export function assistantTextLine(usage: Partial<UsageSpec>, opts: LineOpts = {}): string {
  return JSON.stringify({
    ...base(opts),
    type: 'assistant',
    message: {
      role: 'assistant',
      model: 'claude-fable-5',
      content: [{ type: 'text', text: 'working…' }],
      usage: usageBlock(usage),
    },
  });
}

export function userPromptLine(text: string, opts: LineOpts = {}): string {
  return JSON.stringify({
    ...base(opts),
    type: 'user',
    message: { role: 'user', content: text },
  });
}

export function userCommandLine(command: string, opts: LineOpts = {}): string {
  const text =
    `<command-name>/${command}</command-name>\n` +
    `            <command-message>${command}</command-message>\n` +
    `            <command-args></command-args>`;
  return JSON.stringify({
    ...base(opts),
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text }] },
  });
}

export function userToolResultLine(opts: LineOpts = {}): string {
  return JSON.stringify({
    ...base(opts),
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'ok' }],
    },
  });
}

export function metadataLines(): string[] {
  return [
    JSON.stringify({ type: 'last-prompt', leafUuid: 'x', sessionId: 'session-1' }),
    JSON.stringify({ type: 'mode', mode: 'normal', sessionId: 'session-1' }),
    JSON.stringify({ type: 'file-history-snapshot', messageId: 'm', snapshot: {}, isSnapshotUpdate: false }),
    'not json at all {{{',
  ];
}

/** A temp "claude projects" root with one project dir + transcript file. */
export function makeClaudeDir(prefix = 'sa-test-'): { root: string; projectDir: string } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const projectDir = join(root, 'C--repos-alpha');
  mkdirSync(projectDir, { recursive: true });
  return { root, projectDir };
}

export function writeTranscript(projectDir: string, name: string, lines: string[]): string {
  const path = join(projectDir, name);
  writeFileSync(path, lines.join('\n') + '\n', 'utf-8');
  return path;
}

export function makeHomeDir(): string {
  return mkdtempSync(join(tmpdir(), 'sa-home-'));
}
