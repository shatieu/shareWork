import type { SpawnSyncReturns } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type { VoiceSpawnSync } from '../src/fleet.js';
import {
  createClaudeSpeechSummarizer,
  fakeSpeechSummarizerSeamActive,
  fallbackSpeechSummary,
  speakable,
  SPEECH_SUMMARY_THRESHOLD,
} from '../src/speech-summarizer.js';

function spawnResult(overrides: Partial<SpawnSyncReturns<string>>): SpawnSyncReturns<string> {
  return { pid: 1, output: [], stdout: '', stderr: '', status: 0, signal: null, ...overrides } as SpawnSyncReturns<string>;
}

const LONG = 'A meaningful sentence about the fleet. '.repeat(30);

describe('createClaudeSpeechSummarizer', () => {
  it('parses a successful -p json result and passes haiku + budget flags', async () => {
    let seenArgs: string[] = [];
    const spawn: VoiceSpawnSync = (_cmd, args) => {
      seenArgs = args;
      return spawnResult({ stdout: JSON.stringify({ result: 'Short and speakable.' }) });
    };
    const result = await createClaudeSpeechSummarizer(spawn)({ text: LONG, context: 'test' });
    expect(result).toEqual({ text: 'Short and speakable.', model: 'haiku' });
    expect(seenArgs).toContain('--model');
    expect(seenArgs).toContain('haiku');
    expect(seenArgs).toContain('--max-budget-usd');
  });

  it('returns null on failure/timeout/is_error/empty -- callers always fall back', async () => {
    const cases: VoiceSpawnSync[] = [
      () => spawnResult({ status: 1 }),
      () => spawnResult({ error: new Error('ETIMEDOUT') }),
      () => spawnResult({ stdout: 'not json' }),
      () => spawnResult({ stdout: JSON.stringify({ is_error: true, result: 'x' }) }),
      () => spawnResult({ stdout: JSON.stringify({ result: '   ' }) }),
    ];
    for (const spawn of cases) {
      expect(await createClaudeSpeechSummarizer(spawn)({ text: LONG, context: 'test' })).toBeNull();
    }
  });
});

describe('speakable (threshold + deterministic fallback)', () => {
  it('short content passes through cleaned, without calling the summarizer', async () => {
    let called = false;
    const spoken = await speakable('**bold** short', 'ctx', async () => {
      called = true;
      return null;
    });
    expect(spoken).toBe('bold short');
    expect(called).toBe(false);
  });

  it('long content uses the summarizer when it answers', async () => {
    const spoken = await speakable(LONG, 'ctx', async () => ({ text: 'One line.', model: 'haiku' }));
    expect(spoken).toBe('One line.');
  });

  it('long content falls back to a sentence clip when the summarizer fails or throws', async () => {
    for (const summarizer of [async () => null, async () => Promise.reject(new Error('boom'))]) {
      const spoken = await speakable(LONG, 'ctx', summarizer as never);
      expect(spoken.length).toBeLessThanOrEqual(SPEECH_SUMMARY_THRESHOLD);
      expect(spoken).toContain('A meaningful sentence about the fleet.');
    }
  });

  it('fallbackSpeechSummary strips markdown before clipping', () => {
    expect(fallbackSpeechSummary('# Title\n\n- **item**')).toBe('Title item');
  });
});

describe('fake seam gate', () => {
  it('requires BOTH the flag and NODE_ENV=test', () => {
    expect(fakeSpeechSummarizerSeamActive({ SHIP_VOICE_FAKE_SUMMARIZER: '1', NODE_ENV: 'test' })).toBe(true);
    expect(fakeSpeechSummarizerSeamActive({ SHIP_VOICE_FAKE_SUMMARIZER: '1', NODE_ENV: 'production' })).toBe(false);
    expect(fakeSpeechSummarizerSeamActive({ NODE_ENV: 'test' })).toBe(false);
  });
});
