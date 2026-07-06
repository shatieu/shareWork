import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createClaudeRollupSummarizer,
  createClaudeSummarizer,
  defaultRollupSummarizer,
  defaultSummarizer,
  fakeSummarizerSeamActive,
  fallbackRollupDigest,
  fallbackSummary,
  resolveClaudeBinary,
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

describe('fakeSummarizerSeamActive (acceptance seam, plan §6.1)', () => {
  it('is active only with SHIP_LOG_FAKE_SUMMARIZER=1 AND NODE_ENV=test', () => {
    expect(fakeSummarizerSeamActive({ SHIP_LOG_FAKE_SUMMARIZER: '1', NODE_ENV: 'test' })).toBe(true);
    expect(fakeSummarizerSeamActive({ SHIP_LOG_FAKE_SUMMARIZER: '1', NODE_ENV: 'production' })).toBe(false);
    expect(fakeSummarizerSeamActive({ SHIP_LOG_FAKE_SUMMARIZER: '1' })).toBe(false);
    expect(fakeSummarizerSeamActive({ NODE_ENV: 'test' })).toBe(false);
    expect(fakeSummarizerSeamActive({})).toBe(false);
  });

  it('defaultSummarizer/defaultRollupSummarizer return the deterministic fake under the seam (vitest sets NODE_ENV=test)', async () => {
    const prev = process.env.SHIP_LOG_FAKE_SUMMARIZER;
    process.env.SHIP_LOG_FAKE_SUMMARIZER = '1';
    try {
      const entry = await defaultSummarizer(baseInput);
      expect(entry?.model).toBe('fake-test-seam');
      expect(entry?.text).toContain('[fake-summary]');
      expect(entry?.text).toContain('fix: thing');
      const rollup = await defaultRollupSummarizer({
        date: '2026-07-06',
        entries: [{ project: 'a', branch: 'main', summary: 'did x' }],
      });
      expect(rollup?.model).toBe('fake-test-seam');
      expect(rollup?.text).toContain('[fake-rollup]');
    } finally {
      if (prev === undefined) delete process.env.SHIP_LOG_FAKE_SUMMARIZER;
      else process.env.SHIP_LOG_FAKE_SUMMARIZER = prev;
    }
  });
});

describe('resolveClaudeBinary (Windows npm-shim workaround)', () => {
  it('honors the SHIP_LOG_CLAUDE_PATH override on any platform', () => {
    expect(resolveClaudeBinary({ SHIP_LOG_CLAUDE_PATH: 'C:/custom/claude.exe' }, 'win32')).toBe(
      'C:/custom/claude.exe',
    );
    expect(resolveClaudeBinary({ SHIP_LOG_CLAUDE_PATH: '/opt/claude' }, 'linux')).toBe('/opt/claude');
  });

  it('returns plain "claude" on non-Windows platforms', () => {
    expect(resolveClaudeBinary({ PATH: '/usr/bin' }, 'linux')).toBe('claude');
    expect(resolveClaudeBinary({ PATH: '/usr/bin' }, 'darwin')).toBe('claude');
  });

  it('resolves the npm shim to the nested claude.exe on win32', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ship-log-claude-resolve-'));
    try {
      writeFileSync(join(dir, 'claude.cmd'), '@echo shim\r\n', 'utf8');
      const nested = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin');
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(nested, 'claude.exe'), 'fake-binary', 'utf8');
      expect(resolveClaudeBinary({ PATH: dir }, 'win32')).toBe(join(nested, 'claude.exe'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to plain "claude" on win32 when nothing resolves', () => {
    const empty = mkdtempSync(join(tmpdir(), 'ship-log-claude-empty-'));
    try {
      expect(resolveClaudeBinary({ PATH: empty }, 'win32')).toBe('claude');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
