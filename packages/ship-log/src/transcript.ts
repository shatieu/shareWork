import { existsSync, readFileSync } from 'node:fs';

const DEFAULT_TAIL_LINES = 80;
const DEFAULT_SIZE_CAP_BYTES = 16 * 1024;

/**
 * Defensive transcript-tail reader (plan §3.8: "only a defensive tail-reader -- skill analytics
 * owns deep transcript work"). Reads the last `maxLines` JSONL lines of a Claude Code transcript,
 * extracts plain-text content from user/assistant turns only, and caps total size -- never
 * throws: a missing file, unreadable path, or malformed JSON lines all degrade to an empty/
 * partial string rather than blocking capture.
 */
export function readTranscriptTail(
  transcriptPath: string | null | undefined,
  opts: { maxLines?: number; sizeCapBytes?: number } = {},
): string {
  if (!transcriptPath || !existsSync(transcriptPath)) return '';
  const maxLines = opts.maxLines ?? DEFAULT_TAIL_LINES;
  const sizeCap = opts.sizeCapBytes ?? DEFAULT_SIZE_CAP_BYTES;

  let raw: string;
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return '';
  }

  const allLines = raw.split('\n').filter((l) => l.trim().length > 0);
  const tail = allLines.slice(-maxLines);

  const chunks: string[] = [];
  for (const line of tail) {
    let text: string | undefined;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      text = extractText(parsed);
    } catch {
      continue; // malformed line -- skip, never throw
    }
    if (text) chunks.push(text);
  }

  let joined = chunks.join('\n');
  if (Buffer.byteLength(joined, 'utf8') > sizeCap) {
    // Keep the tail end (most recent) of the size-capped window.
    const buf = Buffer.from(joined, 'utf8');
    joined = buf.subarray(buf.length - sizeCap).toString('utf8');
  }
  return joined;
}

/** Best-effort text extraction across the loosely-documented transcript JSONL shapes: a
 * top-level `message.content` array of `{type:'text', text}` blocks, a plain string `content`,
 * or a top-level `text` field. Anything else contributes nothing rather than throwing. */
function extractText(entry: Record<string, unknown>): string | undefined {
  const message = entry.message as Record<string, unknown> | undefined;
  const content = message?.content ?? entry.content;

  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === 'object' && typeof (block as any).text === 'string') {
        parts.push((block as any).text as string);
      }
    }
    if (parts.length) return parts.join('\n');
  }

  if (typeof entry.text === 'string') return entry.text;

  return undefined;
}
