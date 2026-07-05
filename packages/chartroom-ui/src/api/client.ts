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
  /** unanswered ask-me + unchecked actions items -- the other half of the alert badge. */
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
  doc: DocEntry;
  raw: string;
  backlinks: BacklinkEntry[];
  brokenLinks: BrokenLinkIssue[];
  /** the doc's stable frontmatter id, `null` for id-less docs (new contract fields). */
  id?: string | null;
  /** the doc's canonical route key (`id ?? path`), echoed by the daemon. */
  key?: string;
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

export type ActivityKind = 'repair' | 'rebuild' | 'check' | 'save' | 'session';

export interface ActivityEvent {
  /** ISO timestamp (or epoch ms) of the event. */
  ts: string | number;
  repoId: string;
  repoName: string;
  kind: ActivityKind;
  summary: string;
  detail?: string;
  /** present when the event points at a specific doc -- makes the LATEST row clickable. */
  docKey?: string;
  path?: string;
}

/** `GET /api/activity?limit=N` -- newest-first fixer/save/check event feed for the LATEST panel.
 * Repair events are how the user learns the fixer touched their files -- never dropped. */
export function fetchActivity(limit = 50): Promise<ActivityEvent[]> {
  return getJson<ActivityEvent[]>(`/api/activity?limit=${limit}`);
}

export type SearchMatchKind = 'id' | 'title' | 'heading' | 'path';

export interface SearchResult {
  repoId: string;
  repoName: string;
  docKey: string;
  path: string;
  title: string;
  matchKind: SearchMatchKind;
  heading?: string;
  score: number;
}

/** `GET /api/search?q=…` -- cross-repo search over docs, ids, and headings (⌘K modal). */
export function fetchSearch(q: string): Promise<SearchResult[]> {
  return getJson<SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`);
}

export interface ClaudeSessionResponse {
  ok: true;
}

/** `POST /api/repos/:repoId/claude-session` -- spawns a terminal running `claude` in that repo's
 * working directory. 500 with a readable error body on failure. */
export async function openClaudeSession(repoId: string): Promise<ClaudeSessionResponse> {
  const response = await fetch(`/api/repos/${encodeURIComponent(repoId)}/claude-session`, { method: 'POST' });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(body || `chartroom-ui: claude-session failed with status ${response.status}`);
  }
  return (await response.json()) as ClaudeSessionResponse;
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

/* ── folder picker + live registration (wave-2 polish) ── */

export interface FsDirEntry {
  name: string;
  path: string;
  /** true when this directory has a `.git` child, i.e. it can be registered as-is. */
  isGitRepo: boolean;
}

export interface FsListResponse {
  path: string | null;
  parent: string | null;
  home: string;
  dirs: FsDirEntry[];
}

/** `GET /api/fs/list` — server-side folder browser feeding the register-repo picker (the browser
 * sandbox can't produce real absolute paths from a native dialog; the local daemon can walk its
 * own filesystem). No path → filesystem roots (drives on Windows). */
export function fetchFsList(path?: string | null): Promise<FsListResponse> {
  return getJson<FsListResponse>(path ? `/api/fs/list?path=${encodeURIComponent(path)}` : '/api/fs/list');
}

export interface RegisterRepoResult {
  id: string;
  name: string;
  absPath: string;
  alreadyRegistered: boolean;
}

/** `POST /api/repos/register` — registers a repo live (the daemon resolves the folder's git root,
 * persists it, and starts watching immediately; no restart). */
export async function registerRepoRequest(path: string): Promise<RegisterRepoResult> {
  const response = await fetch('/api/repos/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    let message = body;
    try {
      message = (JSON.parse(body) as { error?: string }).error ?? body;
    } catch {
      /* non-JSON error body — use as-is */
    }
    throw new Error(message || `registration failed with status ${response.status}`);
  }
  return (await response.json()) as RegisterRepoResult;
}
