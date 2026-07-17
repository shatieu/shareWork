import { appendFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openSkillAnalyticsDb, type InvocationRow } from '../src/db.js';
import { collectTranscripts } from '../src/collect.js';
import { getSessionUsage, listSessionUsage } from '../src/sessions.js';
import {
  assistantAgentLine,
  assistantMultiBlockResponse,
  assistantSkillLine,
  assistantTextLine,
  makeClaudeDir,
  makeHomeDir,
  metadataLines,
  userCommandLine,
  userPromptLine,
  userToolResultLine,
  writeTranscript,
} from './fixtures.js';

let db: Database.Database;
let claude: { root: string; projectDir: string };

beforeEach(() => {
  db = openSkillAnalyticsDb(makeHomeDir());
  claude = makeClaudeDir();
});

afterEach(() => {
  db.close();
});

const allInvocations = (): InvocationRow[] =>
  db.prepare('SELECT * FROM invocations ORDER BY id').all() as InvocationRow[];

describe('collectTranscripts', () => {
  it('collects skills, agents and commands with project/session metadata', () => {
    writeTranscript(claude.projectDir, 's1.jsonl', [
      ...metadataLines(),
      userPromptLine('start', { cwd: 'C:\\repos\\alpha' }),
      assistantSkillLine('lookout', { input: 100, output: 20 }),
      userToolResultLine(),
      assistantAgentLine('wave-researcher', { input: 5, output: 5 }),
      userCommandLine('model'),
    ]);
    const result = collectTranscripts(db, claude.root);
    expect(result).toMatchObject({ filesSeen: 1, filesParsed: 1, newInvocations: 3 });

    const rows = allInvocations();
    expect(rows.map((r) => [r.kind, r.name, r.trigger_mode])).toEqual([
      ['skill', 'lookout', 'proactive'],
      ['agent', 'wave-researcher', 'proactive'],
      ['command', 'model', 'explicit'],
    ]);
    expect(rows[0]).toMatchObject({ project: 'alpha', session_id: 'session-1', date: '2026-07-06' });
  });

  it('attributes usage from the invoking message and following assistant messages until the next user prompt', () => {
    writeTranscript(claude.projectDir, 's1.jsonl', [
      assistantSkillLine('deploy', { input: 10, output: 1 }),
      userToolResultLine(), // machine traffic -- window stays open
      assistantTextLine({ input: 20, output: 2 }),
      assistantTextLine({ input: 30, output: 3 }),
      userPromptLine('thanks, next topic'), // closes the window
      assistantTextLine({ input: 999, output: 999 }), // outside any window -> dropped
    ]);
    collectTranscripts(db, claude.root);
    const [row] = allInvocations();
    expect(row).toMatchObject({ name: 'deploy', input_tokens: 60, output_tokens: 6, model: 'claude-fable-5' });
  });

  it('sidechain user prompts do not close the window (subagent work accrues to the Agent invocation)', () => {
    writeTranscript(claude.projectDir, 's1.jsonl', [
      assistantAgentLine('wave-developer', { input: 10, output: 1 }),
      userPromptLine('inner subagent prompt', { isSidechain: true }),
      assistantTextLine({ input: 40, output: 4 }, { isSidechain: true }),
      userPromptLine('real human interjects'),
      assistantTextLine({ input: 999, output: 999 }),
    ]);
    collectTranscripts(db, claude.root);
    const [row] = allInvocations();
    expect(row).toMatchObject({ name: 'wave-developer', input_tokens: 50, output_tokens: 5 });
  });

  it('is incremental: appended lines are parsed, unchanged files skipped, windows survive runs', () => {
    const path = writeTranscript(claude.projectDir, 's1.jsonl', [
      assistantSkillLine('deploy', { input: 10, output: 1 }),
    ]);
    collectTranscripts(db, claude.root);

    // Unchanged -> skipped entirely.
    const second = collectTranscripts(db, claude.root);
    expect(second.filesParsed).toBe(0);
    expect(second.newInvocations).toBe(0);

    // Append: usage accrues to the STILL-OPEN window from run 1; new skill also lands.
    appendFileSync(path, assistantTextLine({ input: 20, output: 2 }) + '\n', 'utf-8');
    appendFileSync(path, userPromptLine('done') + '\n', 'utf-8');
    appendFileSync(path, assistantSkillLine('lookout', { input: 7, output: 7 }) + '\n', 'utf-8');
    const third = collectTranscripts(db, claude.root);
    expect(third.newInvocations).toBe(1);

    const rows = allInvocations();
    expect(rows.find((r) => r.name === 'deploy')).toMatchObject({ input_tokens: 30, output_tokens: 3 });
    expect(rows.find((r) => r.name === 'lookout')).toMatchObject({ input_tokens: 7, output_tokens: 7 });
  });

  it('leaves a trailing partial line for the next run instead of parsing half a record', () => {
    const path = writeTranscript(claude.projectDir, 's1.jsonl', [assistantSkillLine('deploy')]);
    const partial = assistantSkillLine('half-written');
    appendFileSync(path, partial.slice(0, 40), 'utf-8'); // no trailing newline
    collectTranscripts(db, claude.root);
    expect(allInvocations().map((r) => r.name)).toEqual(['deploy']);

    appendFileSync(path, partial.slice(40) + '\n', 'utf-8');
    collectTranscripts(db, claude.root);
    expect(allInvocations().map((r) => r.name)).toEqual(['deploy', 'half-written']);
  });

  it('reparses from scratch when a file shrinks (replaced transcript), dropping stale rows', () => {
    const path = writeTranscript(claude.projectDir, 's1.jsonl', [
      assistantSkillLine('old-one'),
      assistantSkillLine('old-two'),
    ]);
    collectTranscripts(db, claude.root);
    expect(allInvocations()).toHaveLength(2);

    writeFileSync(path, assistantSkillLine('fresh') + '\n', 'utf-8');
    collectTranscripts(db, claude.root);
    expect(allInvocations().map((r) => r.name)).toEqual(['fresh']);
  });

  it('handles multiple project directories and a missing root', () => {
    expect(collectTranscripts(db, claude.root + '-does-not-exist')).toMatchObject({ filesSeen: 0 });
    const other = makeClaudeDir();
    writeTranscript(claude.projectDir, 'a.jsonl', [assistantSkillLine('one', {}, { cwd: 'C:\\repos\\alpha' })]);
    writeTranscript(other.projectDir, 'b.jsonl', [assistantSkillLine('two', {}, { cwd: 'C:\\repos\\beta' })]);
    collectTranscripts(db, claude.root);
    collectTranscripts(db, other.root);
    expect(allInvocations().map((r) => r.project).sort()).toEqual(['alpha', 'beta']);
  });

  it('counts one API response ONCE despite repeated usage lines (dedupe by message.id)', () => {
    // Real transcripts write one API response as multiple JSONL lines (one per content
    // block), each repeating the same message.usage. Without message-id dedupe this
    // fixture would accrue 3x the true usage.
    writeTranscript(claude.projectDir, 's1.jsonl', [
      assistantSkillLine('deploy', { input: 100, output: 10 }, { messageId: 'msg_A' }),
      ...assistantMultiBlockResponse('msg_A', { input: 100, output: 10 }, 2), // 2 more lines of the SAME response
      ...assistantMultiBlockResponse('msg_B', { input: 40, output: 4, cacheRead: 8 }, 3), // next response, 3 lines
    ]);
    collectTranscripts(db, claude.root);
    const [row] = allInvocations();
    expect(row).toMatchObject({
      name: 'deploy',
      input_tokens: 140,
      output_tokens: 14,
      cache_read_tokens: 8,
    });
  });

  it('never stores message content in the database (privacy rail)', () => {
    const secret = 'EXTREMELY-PRIVATE-USER-TEXT';
    writeTranscript(claude.projectDir, 's1.jsonl', [
      userPromptLine(secret),
      assistantSkillLine('deploy', { input: 1, output: 1 }),
    ]);
    collectTranscripts(db, claude.root);
    const everything = JSON.stringify([
      db.prepare('SELECT * FROM invocations').all(),
      db.prepare('SELECT * FROM file_cursors').all(),
      db.prepare('SELECT * FROM session_usage').all(),
    ]);
    expect(everything).not.toContain(secret);
  });
});

describe('session usage accumulation', () => {
  it('accrues deduped per-session totals including windowless usage', () => {
    writeTranscript(claude.projectDir, 's1.jsonl', [
      userPromptLine('question with no invocation'), // closes/never opens a window
      ...assistantMultiBlockResponse('msg_A', { input: 100, output: 10, cacheCreate: 5, cacheRead: 50 }, 3),
      ...assistantMultiBlockResponse('msg_B', { input: 40, output: 4 }, 2),
    ]);
    const result = collectTranscripts(db, claude.root);
    expect(result.usageMessages).toBe(2);

    const session = getSessionUsage(db, 'session-1');
    expect(session).toMatchObject({
      sessionId: 'session-1',
      project: 'alpha',
      inputTokens: 140,
      outputTokens: 14,
      cacheCreateTokens: 5,
      cacheReadTokens: 50,
      messageCount: 2,
      model: 'claude-fable-5',
    });
    expect(session!.transcriptPath.endsWith('s1.jsonl')).toBe(true);
  });

  it('keeps totals exact when the cursor resumes MID message-group across collect passes', () => {
    // Pass 1 ends with only 2 of msg_A's 4 lines on disk -> the byte cursor stops inside the
    // response group. The persisted last_usage_message_id must carry the dedupe into pass 2.
    const groupA = assistantMultiBlockResponse('msg_A', { input: 100, output: 10 }, 4);
    const path = writeTranscript(claude.projectDir, 's1.jsonl', groupA.slice(0, 2));
    const first = collectTranscripts(db, claude.root);
    expect(first.usageMessages).toBe(1);
    expect(getSessionUsage(db, 'session-1')).toMatchObject({ inputTokens: 100, messageCount: 1 });

    appendFileSync(
      path,
      [...groupA.slice(2), ...assistantMultiBlockResponse('msg_B', { input: 7, output: 7 }, 2)].join('\n') + '\n',
      'utf-8',
    );
    const second = collectTranscripts(db, claude.root);
    expect(second.usageMessages).toBe(1); // msg_A's tail deduped; only msg_B counts
    expect(getSessionUsage(db, 'session-1')).toMatchObject({
      inputTokens: 107,
      outputTokens: 17,
      messageCount: 2,
    });
  });

  it('lists sessions sorted by last activity and resets totals when a file shrinks', () => {
    writeTranscript(claude.projectDir, 'old.jsonl', [
      assistantTextLine({ input: 10, output: 1 }, { sessionId: 'older', messageId: 'm1', timestamp: '2026-07-01T00:00:00.000Z' }),
    ]);
    const newer = writeTranscript(claude.projectDir, 'new.jsonl', [
      assistantTextLine({ input: 20, output: 2 }, { sessionId: 'newer', messageId: 'm2', timestamp: '2026-07-10T00:00:00.000Z' }),
      assistantTextLine({ input: 30, output: 3 }, { sessionId: 'newer', messageId: 'm3', timestamp: '2026-07-11T00:00:00.000Z' }),
    ]);
    collectTranscripts(db, claude.root);
    expect(listSessionUsage(db).map((s) => s.sessionId)).toEqual(['newer', 'older']);
    expect(getSessionUsage(db, 'newer')).toMatchObject({
      inputTokens: 50,
      firstTs: '2026-07-10T00:00:00.000Z',
      lastTs: '2026-07-11T00:00:00.000Z',
    });

    // Replaced/truncated transcript -> that file's session totals rebuild from scratch.
    writeFileSync(
      newer,
      assistantTextLine({ input: 5, output: 5 }, { sessionId: 'newer', messageId: 'm9' }) + '\n',
      'utf-8',
    );
    collectTranscripts(db, claude.root);
    expect(getSessionUsage(db, 'newer')).toMatchObject({ inputTokens: 5, messageCount: 1 });
  });

  it('falls back to the filename stem as the session id when lines carry none', () => {
    const bare = JSON.stringify({
      type: 'assistant',
      message: { id: 'msg_X', role: 'assistant', usage: { input_tokens: 9, output_tokens: 1 } },
    });
    writeTranscript(claude.projectDir, 'stem-session.jsonl', [bare]);
    collectTranscripts(db, claude.root);
    expect(getSessionUsage(db, 'stem-session')).toMatchObject({ inputTokens: 9, messageCount: 1 });
  });
});
