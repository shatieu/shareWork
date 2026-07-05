// Typed fetch wrapper for the daemon's /api/* endpoints (plan §3). Types here mirror
// packages/chartroom's own daemon response shapes (index-schema.ts's DocEntry, check.ts's
// BrokenLinkIssue, daemon/backlinks.ts's BacklinkEntry) -- duplicated locally rather than
// cross-package-imported, same reasoning as the TOC pre-pass (plan §1.6/§2): this UI package
// never depends on the `chartroom` CLI package's internals.

export interface RepoSummary {
  id: string;
  name: string;
  absPath: string;
}

export interface DocSummary {
  id: string | null;
  path: string;
  title: string;
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
