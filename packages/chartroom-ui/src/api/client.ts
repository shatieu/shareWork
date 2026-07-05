// Typed fetch wrapper for the daemon's /api/* endpoints (plan §3). Types here mirror
// packages/chartroom's own daemon response shapes (index-schema.ts's DocEntry, check.ts's
// BrokenLinkIssue, daemon/backlinks.ts's BacklinkEntry) -- duplicated locally rather than
// cross-package-imported, same reasoning as the TOC pre-pass (plan §1.6/§2): this UI package
// never depends on the `chartroom` CLI package's internals.

export interface RepoSummary {
  id: string;
  name: string;
  absPath: string;
  /** total indexed docs in this repo (id-less docs included). */
  docCount: number;
  /** unresolved id-links across the repo -- drives the red alert badge in the repo tree. */
  brokenLinkCount: number;
  /** unanswered ask-me + unchecked actions items -- the amber half of the alert badge. */
  needsYouCount: number;
}

export interface DocSummary {
  id: string | null;
  path: string;
  title: string;
}

/** Doc route-key convention shared with the daemon: a doc is addressed by its stable id when it
 * has one, else by its repo-relative path -- the daemon accepts either on every doc endpoint. */
export function docKeyOf(doc: Pick<DocSummary, 'id' | 'path'>): string {
  return doc.id ?? doc.path;
}

export interface OutboundLink {
  targetId?: string;
  hrefAsWritten: string;
  stale: boolean;
}

export interface DocEntry {
  path: string;
  title: string;
  headings: string[];
  outbound: OutboundLink[];
}

export interface BacklinkEntry {
  id: string;
  path: string;
  title: string;
}

export interface BrokenLinkIssue {
  path: string;
  targetId: string;
  hrefAsWritten: string;
  matchType: 'tombstone' | 'not-found';
  /** only present when matchType === 'tombstone'. */
  lastPath?: string;
  /** only present when matchType === 'tombstone' -- looked up server-side from the repo's
   * index.deleted map alongside the reused brokenLinks list (see docs.ts route). */
  deletedAt?: string;
}

export interface DocDetail {
  /** frontmatter id, or null for an unidentified (id-less) doc -- v1.1 contract. */
  id: string | null;
  /** canonical doc key (`id ?? path`) -- what belongs in this doc's own URLs. */
  key: string;
  doc: DocEntry;
  raw: string;
  backlinks: BacklinkEntry[];
  brokenLinks: BrokenLinkIssue[];
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`chartroom-ui: request to ${url} failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchRepos(): Promise<RepoSummary[]> {
  return getJson<RepoSummary[]>('/api/repos');
}

export function fetchDocs(repoId: string): Promise<DocSummary[]> {
  return getJson<DocSummary[]>(`/api/repos/${encodeURIComponent(repoId)}/docs`);
}

export function fetchDoc(repoId: string, docId: string): Promise<DocDetail> {
  return getJson<DocDetail>(`/api/repos/${encodeURIComponent(repoId)}/docs/${encodeURIComponent(docId)}`);
}

/** URL for a repo-relative raw asset (image, doc source, ...), served by the daemon's per-repo
 * `@fastify/static` raw-asset mount (plan §4.1/§6.4). */
export function rawAssetUrl(repoId: string, repoRelativePath: string): string {
  return `/api/repos/${encodeURIComponent(repoId)}/raw/${repoRelativePath}`;
}

export interface SaveDocResponse {
  ok: true;
}

/**
 * `PUT /api/repos/:repoId/docs/:docId` (plan §5.1) — sends the already-reconstructed full file
 * content (frontmatter + spliced body) computed entirely client-side by `roundTrip.ts`. The daemon
 * does no block-diffing itself; it is a trusted write of exactly these bytes (plus its own cheap
 * safety checks, §5.1).
 */
export async function saveDoc(repoId: string, docId: string, raw: string): Promise<SaveDocResponse> {
  const response = await fetch(`/api/repos/${encodeURIComponent(repoId)}/docs/${encodeURIComponent(docId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`chartroom-ui: saveDoc failed with status ${response.status}${body ? `: ${body}` : ''}`);
  }
  return (await response.json()) as SaveDocResponse;
}

export interface CheckboxScope {
  directiveId: string | null;
  index: number;
}

export interface ToggleCheckboxResponse {
  ok: true;
  checked: boolean;
}

/**
 * `PATCH /api/repos/:repoId/docs/:docId/checkbox` (plan §3.2) -- sends only a stable *address*
 * (`scope`) plus the desired new value and the client's own belief about the checkbox's current
 * state (`expectedCurrent`); the daemon re-reads the file fresh and rejects a stale belief with
 * `409` rather than blindly overwriting (plan §3.2's optimistic-concurrency guard).
 */
export async function toggleCheckbox(
  repoId: string,
  docId: string,
  scope: CheckboxScope,
  checked: boolean,
  expectedCurrent: boolean,
): Promise<ToggleCheckboxResponse> {
  const response = await fetch(`/api/repos/${encodeURIComponent(repoId)}/docs/${encodeURIComponent(docId)}/checkbox`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, checked, expectedCurrent }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`chartroom-ui: toggleCheckbox failed with status ${response.status}${body ? `: ${body}` : ''}`);
  }
  return (await response.json()) as ToggleCheckboxResponse;
}

export type AskMeAnswerValue = string | string[] | number;

export interface SubmitAskMeAnswerResponse {
  ok: true;
  answered: true;
  answerText: string;
}

/**
 * `PATCH /api/repos/:repoId/docs/:docId/ask-me` (plan §3.2) -- submits a fully-composed answer
 * value for one `:::ask-me` question. Rejected with `409` if the block has already been answered
 * (plan §3.7), `400` if `value`'s shape doesn't match the question's own type.
 */
export async function submitAskMeAnswer(
  repoId: string,
  docId: string,
  directiveId: string,
  value: AskMeAnswerValue,
  author?: string,
): Promise<SubmitAskMeAnswerResponse> {
  const response = await fetch(`/api/repos/${encodeURIComponent(repoId)}/docs/${encodeURIComponent(docId)}/ask-me`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ directiveId, value, author }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`chartroom-ui: submitAskMeAnswer failed with status ${response.status}${body ? `: ${body}` : ''}`);
  }
  return (await response.json()) as SubmitAskMeAnswerResponse;
}

export interface InboxItem {
  repoId: string;
  repoName: string;
  docId: string;
  docPath: string;
  kind: 'ask-me' | 'actions';
  directiveId: string;
  label: string;
  /** ask-me only. */
  type?: string;
}

/** `GET /api/inbox` (plan §6.1) -- the cross-repo human-action inbox's own data source. */
export function fetchInbox(): Promise<InboxItem[]> {
  return getJson<InboxItem[]>('/api/inbox');
}

const AUTHOR_STORAGE_KEY = 'chartroom.authorName';

export function getCachedAuthorName(): string | null {
  try {
    return window.localStorage.getItem(AUTHOR_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Author-name capture for the `> **Answer** (date, author): ...` line (plan §3.5/§11 item 4,
 * approved): a cached `localStorage` value if present, otherwise a one-time `window.prompt` the
 * human can decline -- the daemon falls back to `os.userInfo().username` server-side if no author
 * is supplied at all, so declining the prompt is never a hard blocker.
 */
export function resolveAuthorName(): string | undefined {
  const cached = getCachedAuthorName();
  if (cached && cached.trim()) return cached.trim();
  try {
    const entered = window.prompt('Your name (shown on answers you submit to Chart Room):');
    if (entered && entered.trim()) {
      window.localStorage.setItem(AUTHOR_STORAGE_KEY, entered.trim());
      return entered.trim();
    }
  } catch {
    /* ignore -- the daemon falls back to os.userInfo().username */
  }
  return undefined;
}

export interface ClaudeSessionResponse {
  ok: true;
}

/** CSRF proof header for spawning/mutating Deck routes -- the daemon 403s without it. A
 * cross-origin form/fetch cannot attach a custom header without a CORS preflight, and the
 * daemon enables no CORS, so browser-borne CSRF dies here. */
const DECK_CLIENT_HEADER = 'x-ship-deck';

/** `POST /api/repos/:repoId/claude-session` -- spawns a terminal running `claude` in that repo's
 * working directory. 404 unknown repo, 500 with a readable error body on spawn failure. */
export async function openClaudeSession(repoId: string): Promise<ClaudeSessionResponse> {
  const response = await fetch(`/api/repos/${encodeURIComponent(repoId)}/claude-session`, {
    method: 'POST',
    headers: { [DECK_CLIENT_HEADER]: '1' },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(body || `chartroom-ui: claude-session failed with status ${response.status}`);
  }
  return (await response.json()) as ClaudeSessionResponse;
}

/* ── Captain's Deck hull endpoints (absent under standalone `chartroom serve`) ── */

export interface HullStationTab {
  id: string;
  title: string;
}

export interface HullStation {
  name: string;
  /** Deck tab registration; stations without a tab contribute routes only. */
  tab?: HullStationTab;
}

/** `GET /api/hull/stations` -- the hull's mounted-station list (plain array). Fails/404s under
 * standalone `chartroom serve`, which the shell treats as single-tab (Docs-only) mode. */
export function fetchHullStations(): Promise<HullStation[]> {
  return getJson<HullStation[]>('/api/hull/stations');
}

export type VoyageDifficulty = 'S' | 'M' | 'L' | 'XL';

/** One mission package (or, later, ledger item) in the Voyage view. Shape mirrors
 * suite-conventions' VoyageItem -- duplicated locally per this file's convention. */
export interface VoyageItem {
  id: number | string;
  title: string;
  status: string;
  /** 0-100. */
  stage_progress: number;
  difficulty: VoyageDifficulty | null;
  remaining_guess_h: number | null;
  updated_at?: string;
  note?: string;
  source?: 'mission' | 'ledger';
}

export interface VoyageResponse {
  file: string;
  updatedAt: string;
  /** true when the watched file currently fails to parse and this is the last-good snapshot. */
  stale?: boolean;
  packages: VoyageItem[];
}

/** `GET /api/voyage` -- mission progress snapshot; 404 when no voyage file is configured (the
 * shell hides the Voyage tab). Live updates ride `GET /api/voyage/events` (SSE). */
export function fetchVoyage(): Promise<VoyageResponse> {
  return getJson<VoyageResponse>('/api/voyage');
}

export interface UploadAssetResponse {
  /** repo-relative-from-the-doc's-own-directory href to insert as the image's markdown link (plan §6.1 step 6). */
  href: string;
}

/**
 * `POST /api/repos/:repoId/docs/:docId/assets` (plan §6.1) — uploads pasted/dropped image bytes;
 * the daemon writes them to `assets/<doc-id>/<timestamp>.png` (repo-root-relative) and returns the
 * relative href already computed against the *editing* doc's own directory, so the inserted image
 * link is correct from the very first paste.
 */
export async function uploadAsset(repoId: string, docId: string, blob: Blob): Promise<UploadAssetResponse> {
  const response = await fetch(`/api/repos/${encodeURIComponent(repoId)}/docs/${encodeURIComponent(docId)}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'image/png' },
    body: blob,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`chartroom-ui: uploadAsset failed with status ${response.status}${body ? `: ${body}` : ''}`);
  }
  return (await response.json()) as UploadAssetResponse;
}
