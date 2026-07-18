import { ChapelApiError } from './client.js';

/* ── chapel chat + confession-history endpoints (wave2-C confessor rework) ──
 * NEW chapel calls live here, NOT in client.ts (parallel-lane discipline); the original
 * brief/dossier/confess/session functions stay in client.ts and are imported from there.
 * Same conventions: every call carries the x-ship-deck header (GETs included), `{error}`
 * bodies surface as status-carrying ChapelApiError. */

const DECK_CLIENT_HEADER = 'x-ship-deck';

async function chapelError(response: Response, fallback: string): Promise<ChapelApiError> {
  let message = fallback;
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error !== '') message = body.error;
  } catch {
    // Non-JSON error body: keep the fallback.
  }
  return new ChapelApiError(message, response.status);
}

async function getChapel<T>(url: string, fallback: string): Promise<T> {
  const response = await fetch(url, { headers: { [DECK_CLIENT_HEADER]: '1' } });
  if (!response.ok) {
    throw await chapelError(response, fallback);
  }
  return (await response.json()) as T;
}

export interface ChapelChatMessage {
  role: 'captain' | 'chaplain';
  text: string;
  at: string;
}

export interface ChapelChatLogResponse {
  messages: ChapelChatMessage[];
}

/** `GET /api/chapel/chat/log` -- the persisted conversation; `[]` before the first exchange. */
export function fetchChapelChatLog(): Promise<ChapelChatLogResponse> {
  return getChapel<ChapelChatLogResponse>('/api/chapel/chat/log', 'chartroom-ui: chapel chat log fetch failed');
}

export interface ChapelChatResponse {
  reply: string;
  sessionId: string;
}

/** `POST /api/chapel/chat` `{ text }` -- one awaited chaplain turn (the hull spawns headless
 * `claude -p` on its dedicated chat session). Slow by nature; 500 with a readable `{error}`
 * on spawn failure/timeout, 400 on empty text. */
export async function chapelChat(text: string): Promise<ChapelChatResponse> {
  const response = await fetch('/api/chapel/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [DECK_CLIENT_HEADER]: '1' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw await chapelError(response, 'chartroom-ui: chaplain chat failed');
  }
  return (await response.json()) as ChapelChatResponse;
}

export interface ChapelConfessionSummary {
  /** ISO-derived archive filename sans `.md` -- the confession's id. */
  stamp: string;
  project: string | null;
  excerpt: string;
  updatedAt: string;
}

export interface ChapelConfessionsResponse {
  confessions: ChapelConfessionSummary[];
}

/** `GET /api/chapel/confessions` -- the durable archive (newest first), never the chaplain's
 * consumable inbox queue. */
export function fetchChapelConfessions(): Promise<ChapelConfessionsResponse> {
  return getChapel<ChapelConfessionsResponse>(
    '/api/chapel/confessions',
    'chartroom-ui: chapel confessions fetch failed',
  );
}

export interface ChapelConfessionDetail {
  stamp: string;
  project: string | null;
  text: string;
  updatedAt: string;
}

/** `GET /api/chapel/confessions/:stamp` -- one archived confession in full; 404 for unknown stamps. */
export function fetchChapelConfession(stamp: string): Promise<ChapelConfessionDetail> {
  return getChapel<ChapelConfessionDetail>(
    `/api/chapel/confessions/${encodeURIComponent(stamp)}`,
    `chartroom-ui: chapel confession ${stamp} fetch failed`,
  );
}

/* ── chaplain rounds (wave2-J): the machine-written daily all-projects digests ── */

export interface ChapelRoundsSummary {
  /** `YYYY-MM-DD` -- the rounds file's date and id. */
  date: string;
  updatedAt: string;
}

export interface ChapelRoundsListResponse {
  rounds: ChapelRoundsSummary[];
}

/** `GET /api/chapel/rounds` -- available rounds dates, newest first; `[]` before the first run. */
export function fetchChapelRounds(): Promise<ChapelRoundsListResponse> {
  return getChapel<ChapelRoundsListResponse>('/api/chapel/rounds', 'chartroom-ui: chapel rounds fetch failed');
}

export interface ChapelRoundsDetail {
  date: string;
  /** The digest markdown as ship-log wrote it. */
  content: string;
  updatedAt: string;
}

/** `GET /api/chapel/rounds/:date` -- one day's digest in full; 404 for unknown dates. */
export function fetchChapelRoundsDay(date: string): Promise<ChapelRoundsDetail> {
  return getChapel<ChapelRoundsDetail>(
    `/api/chapel/rounds/${encodeURIComponent(date)}`,
    `chartroom-ui: chapel rounds ${date} fetch failed`,
  );
}

export interface ChapelRoundsRunResponse {
  date: string;
  entryCount: number;
  projectCount: number;
  model: string | null;
}

/** `POST /api/chapel/rounds/run` -- build today's rounds now (the hull proxies to ship-log).
 * Slowish by nature (one haiku call); 501 with a readable `{error}` when ship-log is not
 * mounted on this hull. */
export async function runChapelRounds(): Promise<ChapelRoundsRunResponse> {
  const response = await fetch('/api/chapel/rounds/run', {
    method: 'POST',
    headers: { [DECK_CLIENT_HEADER]: '1' },
  });
  if (!response.ok) {
    throw await chapelError(response, 'chartroom-ui: chapel rounds run failed');
  }
  return (await response.json()) as ChapelRoundsRunResponse;
}
