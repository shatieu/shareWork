/**
 * Fetch layer for the skill-analytics per-session token routes (wave2-I). A dedicated module
 * (never client.ts — collision rule): shapes are duplicated locally, and every request carries
 * the x-ship-deck header because the sessions routes are deck-gated server-side (session ids +
 * transcript paths are more identifying than the aggregate summary).
 */

/** Same literal as client.ts's DECK_CLIENT_HEADER (kept private there). */
const DECK_CLIENT_HEADER = 'x-ship-deck';

export interface TokenSessionEntry {
  sessionId: string;
  /** Transcript-derived project label (last cwd segment); null when the transcript never said. */
  project: string | null;
  cwd: string | null;
  transcriptPath: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
  /** Distinct API responses counted (message-id-deduped), not transcript line count. */
  messageCount: number;
  model: string | null;
  firstTs: string | null;
  lastTs: string | null;
  /** Present only when the ship-log station is mounted to answer. */
  watched?: boolean;
}

export interface TokenSessionsResponse {
  generatedAt: string;
  sessions: TokenSessionEntry[];
}

/** Raised on HTTP 404 so callers can self-hide when the station isn't mounted. */
export class TokenApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'TokenApiError';
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { [DECK_CLIENT_HEADER]: '1' } });
  if (!response.ok) {
    throw new TokenApiError(`${url} failed: HTTP ${response.status}`, response.status);
  }
  return (await response.json()) as T;
}

/** Sessions sorted by last activity, newest first (server-side order). */
export async function fetchTokenSessions(options: { project?: string; limit?: number } = {}): Promise<TokenSessionsResponse> {
  const params = new URLSearchParams();
  if (options.project !== undefined) params.set('project', options.project);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  const qs = params.toString();
  return getJson<TokenSessionsResponse>(`/api/skill-analytics/sessions${qs ? `?${qs}` : ''}`);
}

export async function fetchTokenSession(sessionId: string): Promise<TokenSessionEntry> {
  return getJson<TokenSessionEntry>(`/api/skill-analytics/sessions/${encodeURIComponent(sessionId)}`);
}
