import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/**
 * Deck-side bridge to the repo-local ask-human skill (wave2-E item 4). The skill's own flow
 * (`.claude/skills/ask-human/SKILL.md`) has the agent write
 * `<cwd>/.claude/ask-human/sessions/<id>/spec.json` and later read `answers.json` back from the
 * same directory -- these helpers let the hull list/read those specs and write `answers.json`
 * BYTE-COMPATIBLE with the skill's own standalone server (`bin/server.mjs::handleSubmit`), so
 * the skill's step-4 readback works unchanged whichever page answered.
 *
 * Nothing here touches the ship-inbox database: ask-human sessions live (gitignored) in the
 * asking repo, and the filesystem is their source of truth.
 */

/** Ask-human session ids are agent-chosen kebab-case names (SKILL.md step 1). Rejecting path
 * separators and leading dots keeps every read/write inside the sessions directory. */
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isValidAskHumanSessionId(sessionId: string): boolean {
  return SESSION_ID_RE.test(sessionId) && !sessionId.includes('..');
}

export function askHumanSessionsDir(cwd: string): string {
  return join(cwd, '.claude', 'ask-human', 'sessions');
}

export interface AskHumanSessionSummary {
  sessionId: string;
  questionCount: number;
  /** true = answers.json already exists (the skill may not have read it yet, but the form is
   * done); pending sessions are the ones a Deck page should offer to answer. */
  answered: boolean;
}

/** Spec questions are served as-parsed (the skill's schema, SCHEMA.md); only the envelope every
 * renderer needs is typed. */
export interface AskHumanSpecQuestion {
  id: string;
  type: string;
  prompt: string;
  [key: string]: unknown;
}

function parseSpecFile(specPath: string): AskHumanSpecQuestion[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(specPath, 'utf8'));
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  const seen = new Set<string>();
  for (const question of parsed) {
    if (question === null || typeof question !== 'object') return undefined;
    const q = question as Record<string, unknown>;
    if (typeof q.id !== 'string' || !q.id || seen.has(q.id)) return undefined;
    seen.add(q.id);
    if (typeof q.prompt !== 'string' || typeof q.type !== 'string') return undefined;
  }
  return parsed as AskHumanSpecQuestion[];
}

/** Sessions under `<cwd>/.claude/ask-human/sessions/`, unparsable/invalid specs skipped --
 * a broken spec is the skill's business (its server refuses to start on one), never a 500 here. */
export function listAskHumanSessions(cwd: string): AskHumanSessionSummary[] {
  const dir = askHumanSessionsDir(cwd);
  if (!existsSync(dir)) return [];
  const summaries: AskHumanSessionSummary[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isValidAskHumanSessionId(entry.name)) continue;
    const sessionDir = join(dir, entry.name);
    const spec = existsSync(join(sessionDir, 'spec.json'))
      ? parseSpecFile(join(sessionDir, 'spec.json'))
      : undefined;
    if (!spec) continue;
    summaries.push({
      sessionId: entry.name,
      questionCount: spec.length,
      answered: existsSync(join(sessionDir, 'answers.json')),
    });
  }
  summaries.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  return summaries;
}

/** One session's parsed spec, or undefined when missing/invalid. */
export function readAskHumanSpec(cwd: string, sessionId: string): AskHumanSpecQuestion[] | undefined {
  if (!isValidAskHumanSessionId(sessionId)) return undefined;
  const specPath = join(askHumanSessionsDir(cwd), sessionId, 'spec.json');
  if (!existsSync(specPath)) return undefined;
  return parseSpecFile(specPath);
}

export interface AskHumanAnswerInput {
  id: string;
  type: string;
  value: string | number | string[];
  /** Pasted/uploaded files as data URLs -- decoded to real files exactly like the skill's own
   * server. The Deck page currently sends none (attachment paste is descoped there), but the
   * write path stays fully compatible. */
  attachments?: { filename?: string; dataUrl?: string }[];
}

/** Mirrors `bin/server.mjs::sanitizeFilename` byte-for-byte. */
function sanitizeFilename(name: unknown): string {
  const base = basename(String(name || 'file')).replace(/[^a-zA-Z0-9._-]/g, '_');
  return base || 'file';
}

/**
 * Writes `answers.json` (and any attachments) byte-compatible with the skill's standalone server
 * (`bin/server.mjs::handleSubmit`, lines 97-111): same `{id, type, value, attachments}` key
 * order, attachments decoded to `attachments/<id>__<idx>__<sanitized>` with forward-slash
 * relative paths, `JSON.stringify(finalAnswers, null, 2)` with no trailing newline. Re-submission
 * overwrites, matching the server's own behavior.
 */
export function writeAskHumanAnswers(
  cwd: string,
  sessionId: string,
  answers: AskHumanAnswerInput[],
): { path: string } {
  if (!isValidAskHumanSessionId(sessionId)) {
    throw new Error(`invalid ask-human session id "${sessionId}"`);
  }
  const sessionDir = join(askHumanSessionsDir(cwd), sessionId);
  if (!existsSync(join(sessionDir, 'spec.json'))) {
    throw new Error(`no ask-human spec at ${join(sessionDir, 'spec.json')}`);
  }
  const attachmentsDir = join(sessionDir, 'attachments');
  const finalAnswers = answers.map((answer) => {
    const attachmentPaths: string[] = [];
    (answer.attachments ?? []).forEach((attachment, idx) => {
      const match = /^data:([^;]+);base64,(.+)$/s.exec(attachment.dataUrl ?? '');
      if (!match) return;
      mkdirSync(attachmentsDir, { recursive: true });
      const safeName = `${answer.id}__${idx}__${sanitizeFilename(attachment.filename)}`;
      writeFileSync(join(attachmentsDir, safeName), Buffer.from(match[2], 'base64'));
      attachmentPaths.push(`attachments/${safeName}`);
    });
    return { id: answer.id, type: answer.type, value: answer.value, attachments: attachmentPaths };
  });
  const answersPath = join(sessionDir, 'answers.json');
  writeFileSync(answersPath, JSON.stringify(finalAnswers, null, 2));
  return { path: answersPath };
}
