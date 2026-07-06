import { describe, expect, it } from 'vitest';
import {
  createClaudeRollupSummarizer,
  createClaudeSummarizer,
  fallbackRollupDigest,
  fallbackSummary,
  type ClaudeSpawn,
} from '../src/summarize.js';

const baseInput = {
  project: 'shareWork',
  branch: 'main',
  commits: [{ hash: 'abc123', subject: 'fix: thing' }],
  files: ['a.ts'],
  transcriptTail: 'user asked to fix the thing',
};

function fakeSpawn(result: Partial<ReturnType<ClaudeSpawn>>): ClaudeSpawn {
  return () =>
    ({
      pid: 1,
      output: [],
      stdout: '',
      stderr: '',
      status: 0,
      signal: null,
      error: undefined,
      ...result,
    }) as ReturnType<ClaudeSpawn>;
}

describe('createClaudeSummarizer (injected fake claude runner)', () => {
  it('parses a successful --output-format json result', async () => {
    const spawn = fakeSpawn({ stdout: JSON.stringify({ result: 'Fixed the thing.', is_error: false }) });
    const summarizer = createClaudeSummarizer(spawn);
    const result = await summarizer(baseInput);
    expect(result).toEqual({ text: 'Fixed the thing.', model: 'haiku' });
  });

  it('returns null when the process reports a timeout via result.error', async () => {
    const spawn = fakeSpawn({ error: new Error('ETIMEDOUT'), status: null });
    const summarizer = createClaudeSummarizer(spawn);
    expect(await summarizer(baseInput)).toBeNull();
  });

  it('returns null on non-zero exit', async () => {
    const spawn = fakeSpawn({ status: 1, stdout: '' });
    const summarizer = createClaudeSummarizer(spawn);
    expect(await summarizer(baseInput)).toBeNull();
  });

  it('returns null when stdout is not valid JSON', async () => {
    const spawn = fakeSpawn({ stdout: 'not json at all' });
    const summarizer = createClaudeSummarizer(spawn);
    expect(await summarizer(baseInput)).toBeNull();
  });

  it('returns null when the CLI itself reports is_error', async () => {
    const spawn = fakeSpawn({ stdout: JSON.stringify({ is_error: true, result: '' }) });
    const summarizer = createClaudeSummarizer(spawn);
    expect(await summarizer(baseInput)).toBeNull();
  });

  it('sets the SHIP_LOG_SUMMARIZER=1 loop-guard env marker on the child', async () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    const spawn: ClaudeSpawn = (_cmd, _args, options) => {
      capturedEnv = options.env;
      return { pid: 1, output: [], stdout: JSON.stringify({ result: 'ok' }), stderr: '', status: 0, signal: null } as ReturnType<ClaudeSpawn>;
    };
    await createClaudeSummarizer(spawn)(baseInput);
    expect(capturedEnv?.SHIP_LOG_SUMMARIZER).toBe('1');
  });
});

describe('createClaudeRollupSummarizer', () => {
  it('parses a successful rollup digest', async () => {
    const spawn = fakeSpawn({ stdout: JSON.stringify({ result: '# Digest\n\nBusy day.' }) });
    const summarizer = createClaudeRollupSummarizer(spawn);
    const result = await summarizer({ date: '2026-07-06', entries: [{ project: 'a', branch: 'main', summary: 'did x' }] });
    expect(result?.text).toContain('Busy day.');
  });
});

describe('fallbackSummary', () => {
  it('joins commit subjects with a file-touched count', () => {
    expect(fallbackSummary(baseInput)).toBe('fix: thing (1 file touched).');
  });
  it('reports no changes when there are no commits or files', () => {
    expect(fallbackSummary({ ...baseInput, commits: [], files: [] })).toBe(
      'No repo changes recorded for this session.',
    );
  });
});

describe('fallbackRollupDigest', () => {
  it('lists each entry as a bullet', () => {
    const digest = fallbackRollupDigest({
      date: '2026-07-06',
      entries: [{ project: 'a', branch: 'main', summary: 'did x' }],
    });
    expect(digest).toContain('# 2026-07-06');
    expect(digest).toContain('**a** (main): did x');
  });
  it('reports no sessions for an empty day', () => {
    expect(fallbackRollupDigest({ date: '2026-07-06', entries: [] })).toBe(
      'No sessions recorded for 2026-07-06.',
    );
  });
});
