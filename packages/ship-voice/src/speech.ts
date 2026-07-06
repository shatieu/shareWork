/**
 * Summarize-for-speech layer (VoiceBridge_Spec §4) -- pure functions that turn fleet/ship state
 * into utterances built for ears. Rules implemented here, each unit-tested:
 *   - names, not ids (speakable names from the session's own name or its repo folder);
 *   - numbers rounded ("about fifty", never "47");
 *   - lists capped at 3 with "and two more";
 *   - long content clipped at sentence boundaries (the Haiku speech summarizer, when live,
 *     replaces the clip -- this module stays deterministic).
 *
 * Payload minimization (§3, locked decision): everything rendered here speaks summaries and
 * command metadata only -- NEVER file contents, file paths, or diffs. Renderers receive counts
 * and summary strings; they are never handed file lists to enumerate.
 */

import type { FleetSession } from './fleet.js';

/* ── numbers ── */

const SMALL_WORDS = [
  'no', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
];

/** Exact spoken form for small counts ("three"), digits for the rest. */
export function numberWord(n: number): string {
  if (n >= 0 && n < SMALL_WORDS.length) return SMALL_WORDS[n];
  return String(n);
}

/** §4 "numbers rounded": small counts exact, larger ones rounded to a friendly magnitude. */
export function approxCount(n: number): string {
  if (n < 0) return String(n);
  if (n < SMALL_WORDS.length) return SMALL_WORDS[n];
  if (n <= 20) return String(n);
  const rounded = n <= 100 ? Math.round(n / 10) * 10 : Math.round(n / 50) * 50;
  return rounded === n ? String(n) : `about ${rounded}`;
}

/* ── lists ── */

/** §4 "lists capped at 3": returns the head plus how many were left unsaid. */
export function capList<T>(items: T[], max = 3): { shown: T[]; more: number } {
  if (items.length <= max) return { shown: items, more: 0 };
  return { shown: items.slice(0, max), more: items.length - max };
}

export function andMore(more: number, noun = 'more'): string {
  return more > 0 ? ` And ${numberWord(more)} ${noun}.` : '';
}

/* ── text shaping ── */

/** Strip markdown decorations so a digest reads aloud cleanly: headings, emphasis, bullets,
 * links (keep the text), inline code markers (keep the content -- command names are §3-allowed
 * metadata). Collapses whitespace to single spaces. */
export function stripForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // fenced blocks are never speakable
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Deterministic long-content fallback (§4): clip at a sentence boundary near maxChars. The
 * live Haiku speech summarizer replaces this when available; the spoken result must never
 * depend on it. */
export function sentenceClip(text: string, maxChars = 220): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;
  const window = clean.slice(0, maxChars);
  const lastStop = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '));
  if (lastStop > maxChars * 0.4) return window.slice(0, lastStop + 1);
  const lastSpace = window.lastIndexOf(' ');
  return `${window.slice(0, lastSpace > 0 ? lastSpace : maxChars).trimEnd()}…`;
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function endSentence(s: string): string {
  const t = s.trim();
  return /[.!?…]$/.test(t) ? t : `${t}.`;
}

/* ── names ── */

/** §4 "names not ids": a session's speakable name is its own human name when the supervisor
 * gave it one, else the repo folder it runs in. Never a uuid. */
export function speakableSessionName(session: Pick<FleetSession, 'name' | 'cwd'>): string {
  const name = session.name?.trim();
  if (name) {
    const words = name.split(/\s+/);
    return words.length > 8 ? `${words.slice(0, 8).join(' ')}…` : name;
  }
  const cwd = session.cwd?.trim();
  if (cwd) {
    const base = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    if (base) return `the ${base} session`;
  }
  return 'an unnamed session';
}

/** One spoken clause for what a session is doing right now (verified `claude agents --json`
 * fields, 2026-07-06: `state` blocked|done, `status` busy|idle). */
export function sessionActivity(session: Pick<FleetSession, 'state' | 'status'>): string {
  if (session.state === 'blocked') return 'is blocked waiting on an approval';
  if (session.state === 'done') return 'has finished';
  if (session.status === 'busy') return 'is working';
  if (session.status === 'idle') return 'is idle';
  return 'is running';
}

/* ── renderers ── */

export interface FleetStatusInput {
  sessions: FleetSession[] | null;
  pending?: { permissionsPending: number; questionsOpen: number };
  /** Already-shortened digest line for today (rollup clip or Haiku speech summary). */
  todayLine?: string;
}

/** The acceptance-line renderer (§9.1): one paragraph that reads aloud naturally. */
export function renderFleetStatus(input: FleetStatusInput): string {
  if (input.sessions === null) {
    return 'I can’t see the fleet right now — the session list didn’t come back. Try again in a moment.';
  }
  const active = input.sessions.filter((s) => s.state !== 'done');
  const finished = input.sessions.length - active.length;

  const parts: string[] = [];
  if (active.length === 0) {
    parts.push('No sessions are running right now.');
  } else {
    parts.push(
      `${capitalize(numberWord(active.length))} session${active.length === 1 ? ' is' : 's are'} running.`,
    );
    const { shown, more } = capList(active);
    for (const s of shown) {
      parts.push(`${capitalize(speakableSessionName(s))} ${sessionActivity(s)}.`);
    }
    if (more > 0) parts.push(`And ${numberWord(more)} more.`);
  }
  if (finished > 0) {
    parts.push(`${capitalize(numberWord(finished))} session${finished === 1 ? ' has' : 's have'} finished.`);
  }
  if (input.pending) {
    const p = input.pending.permissionsPending;
    const q = input.pending.questionsOpen;
    if (p > 0) {
      parts.push(`${capitalize(numberWord(p))} permission request${p === 1 ? ' is' : 's are'} waiting for you.`);
    }
    if (q > 0) {
      parts.push(`${capitalize(numberWord(q))} question${q === 1 ? '' : 's'} from the crew ${q === 1 ? 'is' : 'are'} open.`);
    }
    if (p === 0 && q === 0) parts.push('Nothing is waiting on you.');
  }
  if (input.todayLine) {
    parts.push(endSentence(`Earlier today: ${input.todayLine}`));
  }
  return parts.join(' ');
}

export interface SessionStatusInput {
  session: FleetSession;
  /** Latest ship-log summary for this session, if one exists. Already §3-minimized upstream. */
  latestSummary?: string;
  /** How many files that session's last entry touched -- spoken as a rounded count, never paths. */
  filesTouched?: number;
}

export function renderSessionStatus(input: SessionStatusInput): string {
  const name = capitalize(speakableSessionName(input.session));
  const parts = [`${name} ${sessionActivity(input.session)}.`];
  if (input.latestSummary) {
    parts.push(endSentence(`Last log: ${sentenceClip(stripForSpeech(input.latestSummary))}`));
  }
  if (input.filesTouched !== undefined && input.filesTouched > 0) {
    parts.push(`${capitalize(approxCount(input.filesTouched))} file${input.filesTouched === 1 ? '' : 's'} touched.`);
  }
  return parts.join(' ');
}

export function renderAmbiguousSession(query: string, candidates: FleetSession[]): string {
  const { shown, more } = capList(candidates);
  const names = shown.map((s) => speakableSessionName(s)).join('; ');
  return `I found ${numberWord(candidates.length)} sessions like “${query}”: ${names}.${andMore(more)} Which one?`;
}

export function renderNoSuchSession(query: string): string {
  return `I don’t see a session matching “${query}” right now.`;
}

export interface WhatsNewEntry {
  project: string | null;
  summary: string;
}

/** whats_new spoken form: prefer the day's rollup digest (already one narrative); fall back to
 * up-to-3 per-project one-liners from raw entries. */
export function renderWhatsNew(digestLine: string | undefined, entries: WhatsNewEntry[]): string {
  if (digestLine) return endSentence(`Since this morning: ${digestLine}`);
  if (entries.length === 0) return 'Nothing new in the log today yet.';
  const { shown, more } = capList(entries);
  const lines = shown.map((e) =>
    endSentence(`${capitalize(e.project ?? 'an unnamed project')}: ${sentenceClip(stripForSpeech(e.summary), 140)}`),
  );
  return `${capitalize(numberWord(entries.length))} session${entries.length === 1 ? '' : 's'} logged today. ${lines.join(' ')}${andMore(more, 'more sessions')}`;
}

export interface LedgerSpokenItem {
  title: string;
  status: string;
  project: string | null;
}

export function renderLedgerStatus(items: LedgerSpokenItem[], query?: string): string {
  const scope = query ? ` matching “${query}”` : '';
  if (items.length === 0) return `The ledger has nothing${scope || ' open'} right now.`;
  const { shown, more } = capList(items);
  const lines = shown.map((i) =>
    `${sentenceClip(i.title, 80)}${i.project ? ` on ${i.project}` : ''} — ${i.status}.`,
  );
  return `${capitalize(numberWord(items.length))} ledger item${items.length === 1 ? '' : 's'}${scope}. ${lines.join(' ')}${andMore(more, 'more items')}`;
}

export function renderLedgerAdded(title: string): string {
  return `Logged in the ledger: ${sentenceClip(title, 100)}.`;
}

/** §6 read-back, spoken before any approval executes: command metadata only. */
export function renderReadBack(
  sessionName: string,
  commandClip: string,
  destructive: { destructive: boolean; verb?: string },
): string {
  const base = `${capitalize(sessionName)} wants to run ${commandClip} — approve?`;
  if (destructive.destructive && destructive.verb) {
    return `${base} This looks destructive. Say “confirm ${destructive.verb}” to approve.`;
  }
  return base;
}
