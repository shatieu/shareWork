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

/* ── ship-inbox endpoints (absent under standalone `chartroom serve`) ── */

export type ShipPermissionStatus = 'pending' | 'allowed' | 'denied' | 'expired';

export interface ShipPermissionRequest {
  id: string;
  sessionId: string;
  cwd: string;
  project: string | null;
  toolName: string;
  toolInput: unknown;
  source: 'resolver' | 'hook';
  status: ShipPermissionStatus;
  decisionMessage: string | null;
  alwaysAllowRule: string | null;
  ruleBackupPath: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface ShipAgentQuestion {
  id: string;
  sessionId: string;
  cwd: string;
  project: string | null;
  kind: string;
  message: string;
  status: 'open' | 'acknowledged';
  createdAt: string;
  ackedAt: string | null;
}

/** The one-page aggregation (Ship_Spec §5): pending permissions + open agent questions +
 * Chart Room's unanswered ask-me / open actions (same InboxItem shape as `GET /api/inbox`,
 * pulled server-side through the in-process listInbox contract). */
export interface ShipInboxItems {
  permissions: ShipPermissionRequest[];
  questions: ShipAgentQuestion[];
  docs: InboxItem[];
}

export function fetchShipInboxItems(): Promise<ShipInboxItems> {
  return getJson<ShipInboxItems>('/api/ship-inbox/items');
}

export interface ShipInboxSummary {
  permissionsPending: number;
  questionsOpen: number;
  docsOpen: number;
  total: number;
}

/** Badge counts. Fails/404s when no ship-inbox station is mounted -- callers fall back to the
 * Chart Room-only `fetchInbox().length` count. */
export function fetchShipInboxSummary(): Promise<ShipInboxSummary> {
  return getJson<ShipInboxSummary>('/api/ship-inbox/summary');
}

async function postShipInbox<T>(url: string, payload?: unknown): Promise<T> {
  // No Content-Type on body-less POSTs (ack): fastify 400s an empty application/json body.
  const response = await fetch(url, {
    method: 'POST',
    headers:
      payload === undefined
        ? { [DECK_CLIENT_HEADER]: '1' }
        : { 'Content-Type': 'application/json', [DECK_CLIENT_HEADER]: '1' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(body || `chartroom-ui: request to ${url} failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

/** `POST /api/ship-inbox/permissions/:id/decision` -- the browser leg of the resolver loop.
 * `alwaysAllowRule` additionally writes a NATIVE permission rule into the request project's
 * `.claude/settings.local.json` (server-side: additive-only, atomic, backed up). */
export function decideShipPermission(
  id: string,
  decision: { behavior: 'allow' | 'deny'; message?: string; alwaysAllowRule?: string },
): Promise<ShipPermissionRequest> {
  return postShipInbox<ShipPermissionRequest>(
    `/api/ship-inbox/permissions/${encodeURIComponent(id)}/decision`,
    decision,
  );
}

/** `POST /api/ship-inbox/questions/:id/ack` -- dismisses an agent question. */
export function ackShipQuestion(id: string): Promise<ShipAgentQuestion> {
  return postShipInbox<ShipAgentQuestion>(`/api/ship-inbox/questions/${encodeURIComponent(id)}/ack`);
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

export interface RegisterRepoResult {
  id: string;
  name: string;
  absPath: string;
  /** true when the path resolved to a repo that was already registered (no-op server-side). */
  alreadyRegistered: boolean;
}

/**
 * `POST /api/repos/register` `{ path }` (v1.1 live registration) -- the Add-repo modal's submit.
 * The daemon resolves the path to its git root server-side, persists the registry entry, and
 * starts serving + watching the repo immediately (no restart). 400 with a readable `{error}`
 * body when the path has no git root; 403 without the deck header; 501 when the server mode has
 * no registrar (never the case under `ship serve` / `chartroom serve`).
 */
export async function registerRepoRequest(path: string): Promise<RegisterRepoResult> {
  const response = await fetch('/api/repos/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [DECK_CLIENT_HEADER]: '1' },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) {
    let message = `chartroom-ui: register failed with status ${response.status}`;
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
    throw new Error(message);
  }
  return (await response.json()) as RegisterRepoResult;
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

/* ── settings-manager endpoints (absent unless the settings-manager station is mounted) ──
 * Types mirror packages/settings-manager's own response shapes (scopes.ts, merge.ts,
 * simulator.ts, editor.ts, templates.ts) -- duplicated locally per this file's convention. */

export type SettingsScope = 'managed' | 'local' | 'project' | 'user';
export type WritableSettingsScope = 'local' | 'project' | 'user';

export interface SettingsValidationIssue {
  /** JSON-pointer-ish path, e.g. `permissions.allow[3]`. */
  path: string;
  message: string;
}

export interface SettingsValidation {
  ok: boolean;
  /** Shape violations on known keys -- these BLOCK an apply. */
  errors: SettingsValidationIssue[];
  /** Unknown keys / advisory findings -- shown in the diff preview, never blocking. */
  warnings: SettingsValidationIssue[];
}

export interface SettingsScopeInfo {
  scope: SettingsScope;
  path: string;
  exists: boolean;
  error?: string;
  writable: boolean;
  validation?: SettingsValidation;
}

export interface SettingsProject {
  id: string;
  name: string;
  absPath: string;
}

export interface SettingsScopesResponse {
  scopes: SettingsScopeInfo[];
  /** Registered project directories (chartroom repos under the hull). */
  projects: SettingsProject[];
  schemaSource: string;
}

/** `GET /api/settings-manager/scopes` -- per-scope file status + the registered project list. */
export function fetchSettingsScopes(project?: string): Promise<SettingsScopesResponse> {
  return getJson<SettingsScopesResponse>(`/api/settings-manager/scopes${settingsQuery(project)}`);
}

export interface AttributedSettingsRule {
  rule: string;
  scope: SettingsScope;
  /** Absolute path of the settings file the rule came from. */
  file: string;
}

export interface AttributedSettingsValue {
  value: unknown;
  scope: SettingsScope;
  file: string;
  /** Lower-precedence scopes that also define this key (shadowed, not applied). */
  overridden: { scope: SettingsScope; file: string; value: unknown }[];
}

export interface SettingsEffectiveResponse {
  /** Non-permission top-level keys, key → winning value with provenance. */
  values: Record<string, AttributedSettingsValue>;
  permissions: {
    allow: AttributedSettingsRule[];
    deny: AttributedSettingsRule[];
    ask: AttributedSettingsRule[];
    additionalDirectories: AttributedSettingsRule[];
    defaultMode?: AttributedSettingsValue;
  };
  /** Scopes excluded from the merge because they failed to parse. */
  excluded: { scope: SettingsScope; file: string; error: string }[];
}

/** `GET /api/settings-manager/effective` -- the merged view (arrays merge, scalars override). */
export function fetchSettingsEffective(project?: string): Promise<SettingsEffectiveResponse> {
  return getJson<SettingsEffectiveResponse>(`/api/settings-manager/effective${settingsQuery(project)}`);
}

export type SettingsVerdictBehavior = 'deny' | 'ask' | 'allow' | 'default';

export interface SettingsDecidingRule {
  rule: string;
  list: 'deny' | 'ask' | 'allow';
  scope: SettingsScope;
  file: string;
  /** For compound shell commands: the subcommand this rule decided. */
  subcommand?: string;
}

export interface SettingsUnevaluatedRule extends SettingsDecidingRule {
  reason: string;
}

export interface SettingsVerdict {
  behavior: SettingsVerdictBehavior;
  /** The first-match rule that decided (absent when behavior = 'default'). */
  decidingRule?: SettingsDecidingRule;
  /** For allowed compound commands: every allow rule that covered a subcommand. */
  supportingRules?: SettingsDecidingRule[];
  /** The effective defaultMode governing the no-match case. */
  mode: string;
  modeSource?: { scope: SettingsScope; file: string };
  explanation: string;
  /** Honest limits of the model that could change the real outcome. */
  caveats: string[];
  /** Rules that MIGHT apply but use syntax the engine doesn't model -- shown, never hidden. */
  unevaluated: SettingsUnevaluatedRule[];
  notes: string[];
}

export interface SettingsSimulateRequest {
  project?: string;
  tool: string;
  command?: string;
  path?: string;
  url?: string;
  input?: Record<string, unknown>;
}

/** `POST /api/settings-manager/simulate` -- read-only verdict for a hypothetical tool call. */
export function simulateSettings(request: SettingsSimulateRequest): Promise<SettingsVerdict> {
  return postSettings<SettingsVerdict>('/api/settings-manager/simulate', request);
}

export interface SettingsFileResponse {
  scope: SettingsScope;
  path: string;
  exists: boolean;
  content: string;
  error?: string;
  /** sha256 of the current bytes -- the apply ticket for the preview/apply rail. */
  baseHash: string;
  writable: boolean;
}

/** `GET /api/settings-manager/file` -- one scope's raw settings file (empty when absent). */
export function fetchSettingsFile(scope: SettingsScope, project?: string): Promise<SettingsFileResponse> {
  const projectPart = project === undefined ? '' : `&project=${encodeURIComponent(project)}`;
  return getJson<SettingsFileResponse>(`/api/settings-manager/file?scope=${encodeURIComponent(scope)}${projectPart}`);
}

export interface SettingsDiffOp {
  kind: 'same' | 'add' | 'del';
  line: string;
}

export interface SettingsEditPreview {
  targetPath: string;
  exists: boolean;
  baseHash: string;
  /** Whether the CURRENT content parses -- apply refuses unless the recovery box is ticked. */
  baseMalformed: boolean;
  baseError?: string;
  ops: SettingsDiffOp[];
  unifiedDiff: string;
  added: number;
  removed: number;
  /** Validation of the NEW content -- `errors` here block apply. */
  validation: SettingsValidation;
  schemaSource: string;
  unchanged: boolean;
}

export interface SettingsEditRequest {
  scope: WritableSettingsScope;
  project?: string;
  newContent: string;
}

/** `POST /api/settings-manager/preview` -- the mandatory diff step; NO apply without one. */
export function previewSettingsEdit(request: SettingsEditRequest): Promise<SettingsEditPreview> {
  return postSettings<SettingsEditPreview>('/api/settings-manager/preview', request);
}

export interface SettingsApplyResult {
  targetPath: string;
  changed: boolean;
  backupPath?: string;
}

/** `POST /api/settings-manager/apply` -- the write leg of the rails: requires the preview's
 * `baseHash` (409 `base-drift` when the file moved on) and the deck header. 409
 * `malformed-target` unless `overwriteMalformedBase` opts into the documented recovery path. */
export function applySettingsEdit(
  request: SettingsEditRequest & { baseHash: string; overwriteMalformedBase?: boolean },
): Promise<SettingsApplyResult> {
  return postSettings<SettingsApplyResult>('/api/settings-manager/apply', request);
}

export interface SettingsBackupEntry {
  /** Backup filename (the restore id). */
  id: string;
  path: string;
  /** Original file the backup came from. */
  targetPath: string;
  createdAt: string;
  bytes: number;
}

/** `GET /api/settings-manager/backups` -- every timestamped pre-write backup, newest first. */
export function fetchSettingsBackups(): Promise<SettingsBackupEntry[]> {
  return getJson<SettingsBackupEntry[]>('/api/settings-manager/backups');
}

/** `GET /api/settings-manager/backup?id=` -- one backup's bytes (restore flows re-preview them). */
export function fetchSettingsBackup(id: string): Promise<{ entry: SettingsBackupEntry; content: string }> {
  return getJson<{ entry: SettingsBackupEntry; content: string }>(
    `/api/settings-manager/backup?id=${encodeURIComponent(id)}`,
  );
}

export interface SettingsTemplatePack {
  id: string;
  name: string;
  version: string;
  description: string;
  permissions: { allow: string[]; deny: string[]; ask: string[] };
}

/** `GET /api/settings-manager/templates` -- the curated permission packs. */
export function fetchSettingsTemplates(): Promise<SettingsTemplatePack[]> {
  return getJson<SettingsTemplatePack[]>('/api/settings-manager/templates');
}

export interface SettingsTemplatePreviewResponse {
  pack: { id: string; name: string; version: string };
  addedRules: number;
  /** The composed content -- what apply must send verbatim alongside `preview.baseHash`. */
  newContent: string;
  preview: SettingsEditPreview;
}

/** `POST /api/settings-manager/templates/preview` -- additive merge of a pack into a scope. */
export function previewSettingsTemplate(request: {
  id: string;
  scope: WritableSettingsScope;
  project?: string;
}): Promise<SettingsTemplatePreviewResponse> {
  return postSettings<SettingsTemplatePreviewResponse>('/api/settings-manager/templates/preview', request);
}

export interface AlwaysAllowedEntry {
  rule: string;
  cwd: string;
  project: string | null;
  decidedAt: string | null;
  backupPath: string | null;
}

export interface AlwaysAllowedResponse {
  entries: AlwaysAllowedEntry[];
  /** false when no ship-inbox station is mounted (feature unavailable, never an error). */
  available: boolean;
}

/** `GET /api/settings-manager/always-allowed` -- inbox-written always-allow rules. */
export function fetchAlwaysAllowed(): Promise<AlwaysAllowedResponse> {
  return getJson<AlwaysAllowedResponse>('/api/settings-manager/always-allowed');
}

export interface SettingsRevokePreviewResponse {
  newContent: string;
  preview: SettingsEditPreview;
}

/** `POST /api/settings-manager/revoke/preview` -- exact one-rule removal from a project's
 * settings.local.json, previewed; the apply leg goes through the normal diff-modal rail. */
export function previewRevokeRule(request: { project: string; rule: string }): Promise<SettingsRevokePreviewResponse> {
  return postSettings<SettingsRevokePreviewResponse>('/api/settings-manager/revoke/preview', request);
}

/** Typed error for settings-manager mutations -- carries the station's `{error, code}` body so
 * the UI can branch on `base-drift` / `malformed-target` / `schema-violation` recoveries. */
export class SettingsApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'SettingsApiError';
    this.status = status;
    this.code = code;
  }
}

/* ── ship-console endpoints (absent unless the ship-console station is mounted) ──
 * Types mirror packages/ship-console's station.ts response shapes -- duplicated locally per
 * this file's convention. */

export interface ConsoleSession {
  sessionId: string;
  /** Never empty: session name, else the cwd folder, else a sessionId stub. */
  name: string;
  repo: string | null;
  cwd: string | null;
  kind: string | null;
  /** Effective state: 'busy' | 'idle' | 'blocked' | 'done' | 'running' (open set). */
  state: string;
  startedAt: number | null;
}

export interface ConsoleOverview {
  /** false = the fleet could not be read; pending/rollup still arrive (degrade, never blank). */
  available: boolean;
  sessions: ConsoleSession[];
  counts: { total: number; busy: number; idle: number; blocked: number; done: number };
  pending: { permissionsPending: number; questionsOpen: number } | null;
  rollup: { date: string; digest_md: string } | null;
  generatedAt: string;
}

/** `GET /api/ship-console/overview` -- the Console tab's single data source. */
export function fetchConsoleOverview(): Promise<ConsoleOverview> {
  return getJson<ConsoleOverview>('/api/ship-console/overview');
}

function settingsQuery(project?: string): string {
  return project === undefined ? '' : `?project=${encodeURIComponent(project)}`;
}

/* ── settings-manager add-modal endpoints (plan 14) ──
 * Types mirror packages/settings-manager's catalog.ts / editor.ts shapes -- duplicated locally
 * per this file's convention. */

export type SettingsCatalogKind =
  | 'string'
  | 'boolean'
  | 'number'
  | 'object'
  | 'string-array'
  | 'array'
  | 'string-or-boolean'
  | 'any';

export interface SettingsCatalogEntry {
  key: string;
  kind: SettingsCatalogKind;
  description: string;
  /** Present when the documented value set is closed -- the UI renders a select. */
  enumValues?: string[];
  /** Prefill for the value input. */
  defaultValue: unknown;
  /** Managed-settings-only keys are shown but flagged (they no-op outside managed scope). */
  managedOnly?: boolean;
}

export interface SettingsRuleTemplate {
  id: string;
  label: string;
  /** Editable prefill -- the human replaces the placeholder segment. */
  rule: string;
  defaultList: 'allow' | 'deny' | 'ask';
  description: string;
}

export interface SettingsCatalogResponse {
  settings: SettingsCatalogEntry[];
  ruleTemplates: SettingsRuleTemplate[];
  modes: string[];
}

/** `GET /api/settings-manager/catalog` -- the add-modal's searchable catalog. */
export function fetchSettingsCatalog(): Promise<SettingsCatalogResponse> {
  return getJson<SettingsCatalogResponse>('/api/settings-manager/catalog');
}

export interface SettingsAdditions {
  /** Top-level keys to set (overwriting an existing key is allowed -- the diff shows it). */
  values?: Record<string, unknown>;
  /** Sets `permissions.defaultMode` (scalar-override semantics). */
  defaultMode?: string;
  permissions?: { allow?: string[]; deny?: string[]; ask?: string[] };
}

export interface SettingsAddPreviewResponse {
  /** The composed content -- what apply must send verbatim alongside `preview.baseHash`. */
  newContent: string;
  /** Requested keys that did not exist before ("added" badges). */
  addedKeys: string[];
  /** Requested keys that existed and now hold a new value -- overwrites must stay visible. */
  overwrittenKeys: string[];
  addedRules: number;
  preview: SettingsEditPreview;
}

/** `POST /api/settings-manager/add/preview` -- one batched add per target; the apply leg is the
 * EXISTING `/apply` rail (baseHash ticket, diff modal, backups). */
export function previewSettingsAdd(request: {
  scope: WritableSettingsScope;
  project?: string;
  additions: SettingsAdditions;
}): Promise<SettingsAddPreviewResponse> {
  return postSettings<SettingsAddPreviewResponse>('/api/settings-manager/add/preview', request);
}

async function postSettings<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    // The deck header rides every settings POST: /apply requires it (hull CSRF posture), and
    // it is harmless on the read-only POSTs (simulate/preview).
    headers: { 'Content-Type': 'application/json', [DECK_CLIENT_HEADER]: '1' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    let message = `chartroom-ui: request to ${url} failed with status ${response.status}`;
    let code: string | undefined;
    const text = await response.text().catch(() => '');
    if (text) {
      try {
        const body = JSON.parse(text) as { error?: string; code?: string };
        if (typeof body.error === 'string' && body.error) message = body.error;
        if (typeof body.code === 'string') code = body.code;
      } catch {
        message = text;
      }
    }
    throw new SettingsApiError(message, response.status, code);
  }
  return (await response.json()) as T;
}
