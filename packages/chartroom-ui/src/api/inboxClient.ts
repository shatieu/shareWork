// Typed fetch wrappers for the wave2-E inbox/session/askhuman routes (ship-inbox, ship-log,
// ship-console). Split from client.ts per the wave's file lanes; same conventions: response
// shapes are duplicated locally (never cross-package imports), mutations carry the x-ship-deck
// CSRF header, `{error}` bodies come back readable.

import type { ShipAgentQuestion } from './client.js';

/** Same literal as client.ts's DECK_CLIENT_HEADER (kept private there). */
const DECK_CLIENT_HEADER = 'x-ship-deck';

async function errorFrom(response: Response, fallback: string): Promise<Error> {
  let message = fallback;
  const text = await response.text().catch(() => '');
  if (text) {
    try {
      const body = JSON.parse(text) as { error?: string };
      if (typeof body.error === 'string' && body.error) message = body.error;
      else message = text;
    } catch {
      message = text;
    }
  }
  return new Error(message);
}

async function deckGet<T>(url: string, fallback: string): Promise<T> {
  const response = await fetch(url, { headers: { [DECK_CLIENT_HEADER]: '1' } });
  if (!response.ok) throw await errorFrom(response, fallback);
  return (await response.json()) as T;
}

async function deckPost<T>(url: string, payload: unknown, fallback: string): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [DECK_CLIENT_HEADER]: '1' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw await errorFrom(response, fallback);
  return (await response.json()) as T;
}

/* ── respond / send (ship-inbox, defects D1/D4) ── */

/** Honest transport label: replies land on the session's TRANSCRIPT (picked up on resume /
 * a headless sibling turn), they are NOT injected into the running session mid-task. */
export interface SessionDeliveryInfo {
  delivered: boolean;
  detail?: string;
  transport: 'transcript-resume';
}

export interface ShipQuestionResponse extends ShipAgentQuestion {
  responseText: string | null;
  respondedAt: string | null;
  responseDelivered: boolean | null;
  delivery: SessionDeliveryInfo;
}

/** `POST /api/ship-inbox/questions/:id/respond` -- stores the reply on the queue row AND
 * attempts transcript delivery; a failed delivery still stores (the response reports both). */
export function respondShipQuestion(id: string, text: string): Promise<ShipQuestionResponse> {
  return deckPost<ShipQuestionResponse>(
    `/api/ship-inbox/questions/${encodeURIComponent(id)}/respond`,
    { text },
    'chartroom-ui: question respond failed',
  );
}

export interface SendToSessionResponse {
  sessionId: string;
  delivered: true;
  transport: 'transcript-resume';
}

/** `POST /api/ship-inbox/sessions/:sessionId/send` -- free text to any tracked session, by exact
 * session id. 502 with a readable reason when the fleet can't be reached. */
export function sendTextToSession(sessionId: string, text: string): Promise<SendToSessionResponse> {
  return deckPost<SendToSessionResponse>(
    `/api/ship-inbox/sessions/${encodeURIComponent(sessionId)}/send`,
    { text },
    'chartroom-ui: session send failed',
  );
}

/* ── sessions overview + watch flag (ship-console / ship-log) ── */

export interface InboxConsoleSession {
  sessionId: string;
  name: string;
  repo: string | null;
  cwd: string | null;
  kind: string | null;
  state: string;
  startedAt: number | null;
  watched: boolean;
}

export interface InboxConsoleOverview {
  available: boolean;
  /** Watched sessions only (the server filters). */
  sessions: InboxConsoleSession[];
  /** Unwatched sessions, addressable for rewatch. */
  hidden: InboxConsoleSession[];
  counts: { total: number; busy: number; idle: number; blocked: number; done: number };
  pending: { permissionsPending: number; questionsOpen: number } | null;
  rollup: { date: string; digest_md: string } | null;
  generatedAt: string;
}

/** `GET /api/ship-console/overview` -- typed here with the wave2-E watched/hidden fields. */
export async function fetchSessionsOverview(): Promise<InboxConsoleOverview> {
  const response = await fetch('/api/ship-console/overview');
  if (!response.ok) {
    throw await errorFrom(response, `chartroom-ui: console overview failed with status ${response.status}`);
  }
  return (await response.json()) as InboxConsoleOverview;
}

export interface SessionWatchResponse {
  sessionId: string;
  watched: boolean;
}

/** `POST /api/ship-log/sessions/:sessionId/watch` `{watched}` -- the persisted unwatch/rewatch
 * flag (ship-log owns the suite's only session store). */
export function setSessionWatched(sessionId: string, watched: boolean): Promise<SessionWatchResponse> {
  return deckPost<SessionWatchResponse>(
    `/api/ship-log/sessions/${encodeURIComponent(sessionId)}/watch`,
    { watched },
    'chartroom-ui: session watch update failed',
  );
}

/* ── ask-human bridge (ship-inbox askhuman routes) ── */

export interface AskHumanSessionSummary {
  sessionId: string;
  questionCount: number;
  answered: boolean;
}

/** One spec question as authored by the asking agent (ask-human SCHEMA.md vocabulary). */
export interface AskHumanSpecQuestion {
  id: string;
  type: string;
  prompt: string;
  context?: string;
  choices?: { value: string; label: string; context?: string }[];
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  placeholder?: string;
  allowOther?: boolean;
  suggested?: unknown;
  allowAttachment?: boolean;
}

/** `GET /api/ship-inbox/askhuman?cwd=` -- the repo's ask-human sessions (deck-header GET). */
export function fetchAskHumanSessions(cwd: string): Promise<{ cwd: string; sessions: AskHumanSessionSummary[] }> {
  return deckGet(
    `/api/ship-inbox/askhuman?cwd=${encodeURIComponent(cwd)}`,
    'chartroom-ui: ask-human session list failed',
  );
}

/** `GET /api/ship-inbox/askhuman/spec?cwd=&session=` -- one session's parsed spec.json. */
export function fetchAskHumanSpec(
  cwd: string,
  session: string,
): Promise<{ cwd: string; sessionId: string; questions: AskHumanSpecQuestion[] }> {
  return deckGet(
    `/api/ship-inbox/askhuman/spec?cwd=${encodeURIComponent(cwd)}&session=${encodeURIComponent(session)}`,
    'chartroom-ui: ask-human spec fetch failed',
  );
}

export type AskHumanAnswerValue = string | string[] | number;

export interface AskHumanAnswerPayload {
  id: string;
  type: string;
  value: AskHumanAnswerValue;
}

/** `POST /api/ship-inbox/askhuman/answers` -- writes answers.json byte-compatible with the
 * ask-human skill's own server, so the asking session's readback works unchanged. */
export function submitAskHumanAnswers(
  cwd: string,
  session: string,
  answers: AskHumanAnswerPayload[],
): Promise<{ ok: true; path: string }> {
  return deckPost(
    '/api/ship-inbox/askhuman/answers',
    { cwd, session, answers },
    'chartroom-ui: ask-human answers submit failed',
  );
}

/** Hash route for the Deck's ask-questions page (App.tsx parses the same shape). */
export function askHumanHash(cwd: string, session: string): string {
  return `#/askhuman/${encodeURIComponent(cwd)}/${encodeURIComponent(session)}`;
}
