import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTranscriptTail } from '../src/transcript.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ship-log-transcript-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readTranscriptTail', () => {
  it('returns empty string for a missing file', () => {
    expect(readTranscriptTail(join(dir, 'nope.jsonl'))).toBe('');
  });

  it('returns empty string for undefined/null path', () => {
    expect(readTranscriptTail(undefined)).toBe('');
    expect(readTranscriptTail(null)).toBe('');
  });

  it('extracts text from message.content array blocks', () => {
    const path = join(dir, 't.jsonl');
    const lines = [
      JSON.stringify({ message: { content: [{ type: 'text', text: 'hello there' }] } }),
      JSON.stringify({ message: { content: 'plain string content' } }),
    ];
    writeFileSync(path, lines.join('\n') + '\n');
    const tail = readTranscriptTail(path);
    expect(tail).toContain('hello there');
    expect(tail).toContain('plain string content');
  });

  it('skips malformed JSON lines without throwing', () => {
    const path = join(dir, 't2.jsonl');
    writeFileSync(path, 'not json\n' + JSON.stringify({ message: { content: 'ok line' } }) + '\n');
    const tail = readTranscriptTail(path);
    expect(tail).toContain('ok line');
  });

  it('respects maxLines (keeps only the tail)', () => {
    const path = join(dir, 't3.jsonl');
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ message: { content: `line-${i}` } }),
    );
    writeFileSync(path, lines.join('\n') + '\n');
    const tail = readTranscriptTail(path, { maxLines: 3 });
    expect(tail).not.toContain('line-0');
    expect(tail).toContain('line-9');
  });

  it('caps total size to sizeCapBytes, keeping the most recent content', () => {
    const path = join(dir, 't4.jsonl');
    const big = 'x'.repeat(1000);
    const recentMarker = 'END-marker-that-must-survive-the-cap';
    const lines = [
      JSON.stringify({ message: { content: `START-${big}` } }),
      JSON.stringify({ message: { content: recentMarker } }),
    ];
    writeFileSync(path, lines.join('\n') + '\n');
    // Cap comfortably larger than the trailing marker alone but far smaller than the total, so
    // the kept window is guaranteed to fully contain the most-recent chunk plus a truncated tail
    // of the older one.
    const tail = readTranscriptTail(path, { sizeCapBytes: 200 });
    expect(Buffer.byteLength(tail, 'utf8')).toBeLessThanOrEqual(200);
    expect(tail).toContain(recentMarker);
    expect(tail).not.toContain('START-');
  });
});
