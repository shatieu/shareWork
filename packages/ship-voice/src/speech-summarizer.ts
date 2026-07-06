import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolveClaudeBinary, type VoiceSpawnSync } from './fleet.js';
import { sentenceClip, stripForSpeech } from './speech.js';

/**
 * "Long content summarized by Haiku before TTS" (VoiceBridge_Spec §4) -- the same
 * injected-interface / deterministic-fallback discipline as ship-log's summarize.ts: production
 * wires `claude -p --model haiku`, any failure returns `null`, and the caller always falls back
 * to the deterministic sentence clip. Nothing spoken ever depends on network or spend.
 */

export interface SpeechSummarizeInput {
  /** The long content to compress for ears. */
  text: string;
  /** One line of context, e.g. "today's fleet changelog digest". */
  context: string;
}

export interface SpeechSummaryResult {
  text: string;
  model: string;
}

export type SpeechSummarizer = (input: SpeechSummarizeInput) => Promise<SpeechSummaryResult | null>;

const MODEL = 'haiku';
const TIMEOUT_MS = 30_000;
/** Content at or under this length is already speakable -- no summarizer call. */
export const SPEECH_SUMMARY_THRESHOLD = 350;
const MAX_INPUT_CHARS = 4000;

let cachedBinary: string | undefined;
function claudeBinary(): string {
  cachedBinary ??= resolveClaudeBinary();
  return cachedBinary;
}

function buildPrompt(input: SpeechSummarizeInput): string {
  return [
    'Rewrite the following for text-to-speech: one or two short plain sentences, natural to',
    'read aloud, no markdown, no lists, no preamble. Round numbers. Never mention file paths',
    'or code contents.',
    `Context: ${input.context}`,
    'Content:',
    input.text.slice(0, MAX_INPUT_CHARS),
  ].join('\n');
}

/** Factory form (test seam): inject a fake spawn to exercise success/failure handling. Neutral
 * tmpdir cwd + capped budget, mirroring ship-log's runClaude. */
export function createClaudeSpeechSummarizer(spawn: VoiceSpawnSync = spawnSync): SpeechSummarizer {
  return async (input) => {
    const result = spawn(
      claudeBinary(),
      ['-p', buildPrompt(input), '--model', MODEL, '--max-turns', '1', '--max-budget-usd', '0.05', '--output-format', 'json'],
      {
        // Neutral cwd + the SHIP_LOG_SUMMARIZER marker (ship-log's §8.1 loop guard: the crew
        // plugin's emit hook exits 0 immediately when it sees it) -- this internal utility call
        // must never register in the changelog as a "session".
        cwd: tmpdir(),
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        env: { ...process.env, SHIP_LOG_SUMMARIZER: '1' },
      },
    );
    if (result.error || result.status !== 0 || !result.stdout) return null;
    try {
      const parsed = JSON.parse(result.stdout) as { result?: string; is_error?: boolean };
      if (parsed.is_error || typeof parsed.result !== 'string' || !parsed.result.trim()) return null;
      return { text: parsed.result.trim(), model: MODEL };
    } catch {
      return null;
    }
  };
}

/** Deterministic fallback (§4): markdown stripped + sentence-boundary clip. */
export function fallbackSpeechSummary(text: string): string {
  return sentenceClip(stripForSpeech(text));
}

/** Test seam, same rule as ship-log: BOTH `SHIP_VOICE_FAKE_SUMMARIZER=1` and `NODE_ENV=test`,
 * checked at call time -- a production hull can never silently serve fake speech summaries. */
export function fakeSpeechSummarizerSeamActive(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SHIP_VOICE_FAKE_SUMMARIZER === '1' && env.NODE_ENV === 'test';
}

const claudeSpeechSummarizer = createClaudeSpeechSummarizer();

export const defaultSpeechSummarizer: SpeechSummarizer = async (input) => {
  if (fakeSpeechSummarizerSeamActive()) {
    return { text: `[fake-speech] ${fallbackSpeechSummary(input.text)}`, model: 'fake-test-seam' };
  }
  return claudeSpeechSummarizer(input);
};

/** The one call sites use: short content passes through cleaned; long content goes to the
 * summarizer with the deterministic clip as the always-there fallback. */
export async function speakable(
  text: string,
  context: string,
  summarizer: SpeechSummarizer,
): Promise<string> {
  const clean = stripForSpeech(text);
  if (clean.length <= SPEECH_SUMMARY_THRESHOLD) return clean;
  try {
    const summarized = await summarizer({ text, context });
    if (summarized?.text.trim()) return summarized.text.trim();
  } catch {
    /* fall through to deterministic clip */
  }
  return fallbackSpeechSummary(text);
}
