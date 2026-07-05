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
