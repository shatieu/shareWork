/**
 * Pure per-line transcript parser (plan 11 §1). The Claude Code transcript format is
 * undocumented and version-dependent, so this parser is locked to shapes verified empirically
 * against real transcripts on this machine (2026-07-06) and is tolerant of everything else:
 * unknown line types, malformed JSON, and missing fields all degrade to "no events", never
 * to an exception.
 *
 * PRIVACY RAIL (plan 11, hard): this module extracts ONLY identifiers and numbers — tool
 * names, skill/agent/command names, token counts, timestamps, cwd, session ids. It never
 * returns prompt text, tool inputs beyond the skill/agent name, or any message content.
 */

export type InvocationKind = 'skill' | 'agent' | 'command';
export type TriggerMode = 'proactive' | 'explicit';

export interface ParsedInvocation {
  kind: InvocationKind;
  name: string;
  /** Skill/Agent tool_use = the model reached for it (proactive); a `<command-name>` user
   * line = the human typed the slash (explicit). The proactive:explicit ratio per name is
   * the spec's "do the descriptions work" metric. */
  trigger: TriggerMode;
}

export interface ParsedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
  model?: string;
}

export interface ParsedLine {
  invocations: ParsedInvocation[];
  usage?: ParsedUsage;
  /** True when this is a real (non-sidechain) user prompt with text — it closes the token
   * attribution window (see collect.ts). Sidechain "user" lines are a subagent's inner
   * conversation and deliberately do NOT close the parent invocation's window. */
  closesWindow: boolean;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  isSidechain?: boolean;
}

/** Verified user-line shape: slash commands appear as `<command-name>/x</command-name>` in the
 * user message text (alongside `<command-message>`/`<command-args>` — ignored: args may carry
 * user content, which we never extract). */
const COMMAND_NAME_RE = /<command-name>\/?([^<]*)<\/command-name>/g;

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Text of a user message's content without keeping it: we scan it for command tags and
 * whether any human-authored text exists, then drop it. String content and `text` blocks
 * count; `tool_result` blocks do not (they are machine traffic, not a prompt). */
function userText(content: unknown): { text: string; hasText: boolean } {
  if (typeof content === 'string') return { text: content, hasText: content.trim().length > 0 };
  if (Array.isArray(content)) {
    let text = '';
    for (const block of content) {
      if (block && typeof block === 'object' && (block as Record<string, unknown>).type === 'text') {
        const t = (block as Record<string, unknown>).text;
        if (typeof t === 'string') text += t;
      }
    }
    return { text, hasText: text.trim().length > 0 };
  }
  return { text: '', hasText: false };
}

/**
 * Parse one raw JSONL line. Returns undefined for lines that carry no analytics signal
 * (metadata line types like `mode`/`file-history-snapshot`/`attachment`, malformed JSON).
 */
export function parseLine(raw: string): ParsedLine | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (data === null || typeof data !== 'object') return undefined;

  const type = data.type;
  if (type !== 'assistant' && type !== 'user') return undefined;

  const base: ParsedLine = {
    invocations: [],
    closesWindow: false,
    sessionId: str(data.sessionId) ?? str(data.session_id),
    cwd: str(data.cwd),
    timestamp: str(data.timestamp),
    isSidechain: data.isSidechain === true,
  };
  const message = (data.message ?? {}) as Record<string, unknown>;

  if (type === 'assistant') {
    const content = message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (!block || typeof block !== 'object') continue;
        const b = block as Record<string, unknown>;
        if (b.type !== 'tool_use') continue;
        const toolName = str(b.name);
        const input = (b.input ?? {}) as Record<string, unknown>;
        if (toolName === 'Skill') {
          const skill = str(input.skill);
          if (skill) base.invocations.push({ kind: 'skill', name: skill, trigger: 'proactive' });
        } else if (toolName === 'Agent' || toolName === 'Task') {
          // `subagent_type` omitted = the general-purpose agent (verified: most Agent calls
          // carry only description+prompt).
          const subagent = str(input.subagent_type) ?? 'general-purpose';
          base.invocations.push({ kind: 'agent', name: subagent, trigger: 'proactive' });
        }
      }
    }
    const usage = message.usage as Record<string, unknown> | undefined;
    if (usage && typeof usage === 'object') {
      base.usage = {
        inputTokens: num(usage.input_tokens),
        outputTokens: num(usage.output_tokens),
        cacheCreateTokens: num(usage.cache_creation_input_tokens),
        cacheReadTokens: num(usage.cache_read_input_tokens),
        model: str(message.model),
      };
    }
    return base;
  }

  // type === 'user'
  const { text, hasText } = userText(message.content);
  for (const match of text.matchAll(COMMAND_NAME_RE)) {
    const name = match[1]?.trim();
    if (name) base.invocations.push({ kind: 'command', name, trigger: 'explicit' });
  }
  base.closesWindow = hasText && base.isSidechain !== true;
  return base;
}
