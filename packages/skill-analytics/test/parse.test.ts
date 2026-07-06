import { describe, expect, it } from 'vitest';
import { parseLine } from '../src/parse.js';
import {
  assistantAgentLine,
  assistantSkillLine,
  assistantTextLine,
  metadataLines,
  userCommandLine,
  userPromptLine,
  userToolResultLine,
} from './fixtures.js';

describe('parseLine', () => {
  it('extracts a proactive skill invocation from a Skill tool_use', () => {
    const parsed = parseLine(assistantSkillLine('lookout', { input: 10, output: 5 }));
    expect(parsed).toBeDefined();
    expect(parsed!.invocations).toEqual([{ kind: 'skill', name: 'lookout', trigger: 'proactive' }]);
    expect(parsed!.usage).toMatchObject({ inputTokens: 10, outputTokens: 5, model: 'claude-fable-5' });
    expect(parsed!.closesWindow).toBe(false);
  });

  it('extracts agent invocations with subagent_type, defaulting to general-purpose', () => {
    expect(parseLine(assistantAgentLine('wave-researcher'))!.invocations).toEqual([
      { kind: 'agent', name: 'wave-researcher', trigger: 'proactive' },
    ]);
    expect(parseLine(assistantAgentLine(undefined))!.invocations).toEqual([
      { kind: 'agent', name: 'general-purpose', trigger: 'proactive' },
    ]);
  });

  it('accepts the legacy Task tool name for agents', () => {
    const raw = assistantAgentLine('helper').replace('"name":"Agent"', '"name":"Task"');
    expect(parseLine(raw)!.invocations).toEqual([
      { kind: 'agent', name: 'helper', trigger: 'proactive' },
    ]);
  });

  it('extracts explicit slash commands from <command-name> user lines', () => {
    const parsed = parseLine(userCommandLine('model'));
    expect(parsed!.invocations).toEqual([{ kind: 'command', name: 'model', trigger: 'explicit' }]);
    expect(parsed!.closesWindow).toBe(true); // a command IS a user prompt
  });

  it('treats plain user prompts as window-closers and tool_result-only lines as machine traffic', () => {
    expect(parseLine(userPromptLine('please fix the bug'))!.closesWindow).toBe(true);
    expect(parseLine(userToolResultLine())!.closesWindow).toBe(false);
  });

  it('sidechain user prompts never close the parent attribution window', () => {
    expect(parseLine(userPromptLine('inner agent prompt', { isSidechain: true }))!.closesWindow).toBe(false);
  });

  it('carries session/cwd/timestamp metadata', () => {
    const parsed = parseLine(assistantTextLine({ input: 1 }, { sessionId: 's9', cwd: 'D:\\x\\y', timestamp: '2026-07-01T00:00:00.000Z' }));
    expect(parsed).toMatchObject({ sessionId: 's9', cwd: 'D:\\x\\y', timestamp: '2026-07-01T00:00:00.000Z' });
  });

  it('returns undefined for metadata line types, malformed JSON and blank lines', () => {
    for (const line of metadataLines()) {
      expect(parseLine(line)).toBeUndefined();
    }
    expect(parseLine('')).toBeUndefined();
    expect(parseLine('   ')).toBeUndefined();
  });

  it('never leaks message content: parsed output carries identifiers and numbers only', () => {
    const secret = 'SUPER-SECRET-PROMPT-CONTENT';
    const parsed = parseLine(userPromptLine(secret))!;
    expect(JSON.stringify(parsed)).not.toContain(secret);
    const parsedSkill = parseLine(assistantSkillLine('deploy'))!;
    expect(JSON.stringify(parsedSkill)).not.toContain('Loading the skill');
  });
});
