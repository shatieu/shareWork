---
id: plan-03-captains-deck
---

# Package 03 — Hull refactor → Captain's Deck — Implementation Plan

- **Status:** PLAN READY (awaiting FO approval; no code written, no checkouts performed)
- **Feature branch:** `ship-wave1-deck` — cut fresh from `ship-wave1` **only after package 2
  (`ship-wave1-cr-v11`) merges**. Do not branch before that merge.
- **Spec:** `Ship_Spec.md` §2 as amended 5 July (one-hull revision), §3 (progress fields note);
  `Suite-Architecture_and_Website_Spec.md` §1 (naming), §2 (system map), §3 (monorepo);
  `MARATHON-KICKOFF-PROMPT.md` queue item 3; CAPTAIN-INBOX Order 1 items 2–3.
- **Difficulty:** XL. Honest remaining guess: ~13–16 h implementation + review (phase cut line
  in §10 lets the FO trim to ~9–11 h).
- **Worktree caution (planning time):** package 2 is implementing in this worktree right now.
  Every baseline fact below was read via `git show ship-wave1:<path>` / `git show f34c297:<path>`,
  never the working tree. File-level details of chartroom's `server.ts`/`serve.ts`/UI are
  **provisional until the v1.1 merge** — see §0.

## 0. Rebase assumption and stability map

**Assumption (explicit):** implementation starts from `ship-wave1` *after* the package-2 merge.
Package 2 will have already landed: `buildServer(runtimes, { uiDistDir, registrar })`, dynamic
raw route (`routes/raw.ts`), `routes/repo-register.ts`, `daemon-info.ts` (`~/.chartroom/daemon.json`
find-or-start), doc key-addressing (`key = id ?? path`) across doc routes, `DocDetail.id/key`
client fields, Sidebar accepting id-less docs, and `associate`/`open` commands.

**Architecture-stable sections (safe to approve now):** §1–§3 (scope, parking, salvage verdicts),
§4.1–§4.3 (package layout, suite-conventions, hull), §4.5 security posture, §4.6 UI shell concept,
§5–§10 structure.

**To-be-refreshed at implementation start (step 0 of §10), against the merged tree:**
- Exact extraction seams in `chartroom/src/daemon/server.ts` and `src/commands/serve.ts`
  (package 2 rewires both; the refactor in §4.4 is described functionally, not by line).
- Sidebar vs RepoTree reconciliation (§4.6): package 2 patches `Sidebar.tsx` for id-less docs;
  the salvaged `RepoTree.tsx` already handles them via `docKeyOf` — re-verify equivalence.
- `client.ts` merge points (package 2 adds `DocDetail.id/key`; WIP fragments overlap).
- Test/acceptance counts ("all Chart Room tests still pass" — capture the post-merge number,
  expected ≥177, as the regression floor).
- Whether package 2's `repo-register` route landed with any CSRF guard (if not, §4.5 adds one).

## 1. Scope

1. **NEW `packages/suite-conventions`** (reduced scope per kickoff): `~/.suite/services.json`
   read/write helpers (hull port registration), shared event-shape types (the §2 hook events:
   `PermissionRequest`, `Notification`, `Stop`, `SessionStart/End`, `TaskCreated/TaskCompleted`),
   the **typed station-plugin contract** (`StationDescriptor`, host context), a `VoyageItem`
   shape shared by mission progress and future ledger items, and the local-security helpers
   (Host allowlist + CSRF header constant) used by the hull.
2. **NEW `packages/ship`** — the hull: Fastify host factory (`createHull`), `ship` bin with
   `ship serve`, station mounting via the typed contract, Deck UI static serving,
   `~/.suite/services.json` registration on listen, 127.0.0.1-only binding + Host-header guard,
   Voyage backend (`GET /api/voyage`, SSE `GET /api/voyage/events`, chokidar file watch over
   `progress.json`).
3. **`packages/chartroom` plugin-ification:** the daemon's route registration is extracted into
   an exported station factory (`chartroom/station`); `chartroom serve` (standalone bin) keeps
   byte-identical behavior. Chart Room becomes the hull's first mounted plugin. `daemon.json`
   is written by the chartroom station lifecycle, so `chartroom open`/`associate` (package 2)
   find the hull automatically.
4. **Claude sessions:** salvaged, hardened `POST /api/repos/:repoId/claude-session` route
   (§4.5) + UI: "❯ claude" chip in top chrome (active repo) and per-repo hover button.
5. **Deck UI shell** in `chartroom-ui`: top chrome + station **tab bar** (Docs | Voyage, typed
   registry for future Inbox/Settings/Console/Analytics tabs), salvaged brass design system,
   RepoTree, Voyage tab rendering `progress.json` live with the visual grammar (progress bars,
   difficulty badges, stage sections, difficulty-weighted overall bar) designed for later reuse
   with Bridge ledger items.
6. **Quality salvage slice (phase 2, FO-cuttable):** DocEditor React-19 mount fix, DocView
   in-app link resolver, InboxPage "The Ask" rewrite, inbox-correctness slice
   (`repo-state.ts` key-keyed interactive blocks + `needs-you.ts` + inbox/repos stats) — all
   reviewed sound with tests (§3).

**Acceptance line:** `ship serve` boots the Deck with Chart Room mounted, all Chart Room tests
still pass, one port serves everything, and the claude chip opens a real terminal in the right repo.

## 2. Out of scope

- ship-ledger / ship-log / ship-inbox / ship-console / settings-manager plugins (packages 4–7).
  The hull ships the *seam* they mount into, nothing more.
- Ledger items as a second Voyage data source — designed for (`VoyageItem.source`), not built.
- Station-UI module federation / extracting a separate `deck-ui` package. Wave-1 consolidation:
  the Deck shell lives in `chartroom-ui` (see §4.6 rationale + DECISIONS-NEEDED).
- **Parked WIP features (stay on `wip-quarantine-2026-07-05`, per FO note in plan 02 §3.2 —
  no queue item covers them):** `routes/search.ts` + SearchModal, `routes/fs.ts` folder picker +
  RegisterRepoModal, `activity.ts` + `routes/activity.ts` + `auto-repair.ts` +
  `rebuild-pipeline.ts` + LatestPanel + their tests. Proposed as a "Chart Room v1.2 UX" package
  in DECISIONS-NEEDED. The fs route additionally has an unresolved full-filesystem-disclosure
  hazard that should be fixed before it ever ships.
- macOS/Linux claude-session branches: salvaged and unit-tested (argv-level), but only win32 is
  acceptance-proven (Captain's machine is Windows).
- Auth/token system for the daemon. Mitigations: 127.0.0.1 binding + Host allowlist + CSRF
  header on spawning/mutating routes (§4.5). A real token scheme is future work.
- New third-party dependencies: none. `ship`/`suite-conventions` manifests only reuse versions
  already in the workspace (fastify, @fastify/static, commander, chokidar, zod).

## 3. WIP `wip-quarantine-2026-07-05` (f34c297) — per-file salvage verdicts

Inherited from plan 02 §3.2. Method: every file below was read in full (or as a diff vs
`ship-wave1`) via `git show` by this TL + two independent review passes; verdicts are mine.
Salvage = re-author onto `ship-wave1-deck`, full new-code test bar. Nothing is deleted from the
quarantine branch.

### 3.1 SALVAGE — phase 1 (acceptance-critical)

| WIP file | Verdict / required adaptation |
|---|---|
| `chartroom/src/daemon/routes/claude-session.ts` | **Salvage with fixes.** Design is right (injectable `SpawnLike`, platform seam, `wt` detection, detached+unref, async-error swallow). Mandatory fixes: (1) unquoted `repoAbsPath` breaks on spaces and is latent injection — prefer spawn `cwd:` option over `cd`-in-shell (researcher R1), shell-quote whatever remains; (2) drop the `ActivityLog` parameter (activity is parked); (3) CSRF header guard (§4.5); (4) darwin single shared `.command` launcher has a TOCTOU race — per-request temp file name. |
| `chartroom/test/daemon/claude-session.test.ts` | **Salvage + extend:** keep 404/win32×2/500 cases; add spaces-in-path argv case, darwin/linux argv cases, missing-CSRF-header 403 case. |
| `chartroom-ui/src/App.tsx` (522-line rewrite) | **Partial salvage (re-author).** The WIP has NO tab/multi-station concept — it is a Chart-Room-only shell (verified). Salvage: chrome layout (logo/breadcrumbs/claude-chip/status), 3-region body, hash-routing patterns, localStorage persistence, chip UX (busy/toast). Re-author around: station TabBar (§4.6), Voyage route, and WITHOUT activity/search/register wiring (parked). Fix: error/toast dismissal, dedupe hash parsing, add the missing App-level tests. |
| `chartroom-ui/src/styles/base.css` (+2838) + `index.html` | **Salvage with fixes** as the Deck design system (coherent brass/dark console; has reduced-motion + focus-visible). Fixes: **remove the Google Fonts external dependency** (local font stacks; a local daemon UI must not phone home) — logged as default in DECISIONS-NEEDED; keep the inline SVG favicon/theme-color. Dark-only is accepted as the Deck's deliberate design (logged). Extend with tab-bar + voyage component styles. |
| `chartroom-ui/src/components/RepoTree.tsx` | **Salvage with fixes.** Carries the per-repo hover "❯" claude button (charter item). Fixes: indent inconsistency (paddingLeft vs marginLeft), basic tree ARIA, remove the register-footer button (register modal parked), **write the missing test**. Reconcile with package 2's Sidebar id-less handling at impl (§0). |
| `chartroom-ui/src/api/client.ts` | **Fragment salvage:** `docKeyOf`, `RepoSummary.docCount/brokenLinkCount/needsYouCount`, `ClaudeSessionResponse`/`openClaudeSession` (+ CSRF header). **Park** `fetchActivity`/`fetchSearch`/`fetchFsList`/`registerRepoRequest` fragments. |
| `chartroom/src/daemon/routes/repos.ts` stats diff + `test/daemon/repos-stats.test.ts` | **Salvage.** In-memory doc/broken/needs-you counts power RepoTree badges; test is precise. |
| `chartroom/src/daemon/repo-state.ts` diff + `routes/inbox.ts` diff + `src/daemon/needs-you.ts` | **Salvage.** Plan 02 explicitly deferred this slice here; it fixes a real gap (interactive blocks in id-less docs invisible to inbox) and is reviewed sound. Adaptation: **write the missing direct `needs-you.test.ts`** (the empty-`directiveId` skip is the subtle bit); keep the `docId` API field name (documented misnomer, back-compat). |
| `chartroom/src/daemon/server.ts` / `src/commands/serve.ts` diffs | **Salvage only** the claude-session wiring pattern (options seam). Do NOT bring activity/pipeline/search/fs wiring (parked). The real work here is the §4.4 extraction, done fresh against the merged tree. |

### 3.2 SALVAGE — phase 2 (quality slice; FO may cut to v1.2 wholesale)

| WIP file | Verdict |
|---|---|
| `chartroom-ui/src/editor/DocEditor.tsx` + `test/editor/editor-mount.test.tsx` | **Salvage.** Real React-19 bug fixes (editor never mounted via `@milkdown/react`; ProseMirror RangeError on lists), race-safe imperative lifecycle, regression-tested. Highest-value item in the WIP. |
| `chartroom-ui/src/components/DocView.tsx` + `test/DocView.test.tsx` | **Salvage.** In-app link resolver (id links, relative .md, anchors, broken tombstones), well-tested, low coupling to the shell. |
| `chartroom-ui/src/inbox/InboxPage.tsx` + test | **Salvage with fixes.** "The Ask" 3-column screen with 7 question widgets + writeback; real tests. Moderate shell coupling — lands with the shell, not before. |
| `chartroom-ui/src/components/AskMeBlock.tsx` diff | **Salvage** (additive kicker header only). |
| `chartroom-ui/src/components/BacklinksPanel.tsx` diff | **Salvage** (button→real `<a>` with modified-click passthrough — correct pattern). |
| `chartroom-ui/src/components/FrontmatterPanel.tsx`, `RefTag.tsx`, `NeedsYouPanel.tsx` | **Salvage with fixes** (context-panel pieces of the shell; fix NeedsYouPanel's redundant "view all" branch; smoke tests). |
| Deleted `Sidebar.tsx` / `RepoSwitcher.tsx` | **Accept the supersession** (RepoTree + chrome breadcrumbs replace them). Per removal policy: no `rm` — superseded files are left in place and logged in `REMOVALS.md` when they stop being imported. |

### 3.3 PARK (stay on quarantine branch; proposed v1.2 package in DECISIONS-NEEDED)

`routes/search.ts` + `search.test.ts` + `SearchModal.tsx` (sound, but no queue item);
`routes/fs.ts` + fs test portion + `RegisterRepoModal.tsx` (plus unresolved FS-disclosure
hazard); `activity.ts`, `routes/activity.ts`, `auto-repair.ts`, `rebuild-pipeline.ts`,
`activity.test.ts`, `auto-repair.test.ts`, `LatestPanel.tsx`.

### 3.4 REJECT

`chartroom-ui/test/editor/_spike.test.ts` — exploratory spike (console.log scaffolding,
exercises the abandoned headless-engine path). Not salvaged; stays on the quarantine branch.

## 4. Architecture and file-level design

### 4.1 Package layout and dependency graph

```
packages/suite-conventions   (new; no workspace deps; fastify types as peer/dev-only)
packages/ship                (new; deps: fastify, @fastify/static, commander, chokidar,
                              suite-conventions, chartroom [workspace])
packages/chartroom           (+ dep: suite-conventions; + export "./station")
packages/chartroom-ui        (unchanged deps; becomes the Deck app)
```
No cycles: contracts live in `suite-conventions`; `ship` depends on `chartroom`, never the
reverse. `pnpm-workspace.yaml` glob `packages/*` already covers both new packages; turbo tasks
inherit from root. Discipline rule enforced structurally: future station packages depend only on
`suite-conventions` (types) — never on each other; the hull is the only package that imports
stations.

### 4.2 `packages/suite-conventions`

- `src/services-json.ts` — `readServices(homeDir?)`, `writeHullRegistration({port,pid,startedAt,stations})`,
  `clearHullRegistration()`; atomic write (tmp+rename), stale/corrupt-tolerant reads; mirrors
  package 2's `daemon-info.ts` discipline. File shape:
  `{ version: 1, hull?: { port, pid, startedAt, stations: string[] } }`.
- `src/events.ts` — TS types (+ zod schemas, zod already in workspace) for the Ship_Spec §2 hook
  event shapes: `PermissionRequestEvent`, `NotificationEvent`, `StopEvent`, `SessionStartEvent`,
  `SessionEndEvent`, `TaskCreatedEvent`, `TaskCompletedEvent` — fields per spec §2/§4/§5 (session
  id, project, cwd, timestamps, payload). These are the contract packages 4–6 build against.
- `src/station.ts` — the typed plugin contract:
  ```ts
  export interface StationDescriptor {
    name: string;                          // 'chartroom'
    tab?: { id: string; title: string };   // Deck tab registration ('docs', 'Docs')
    registerRoutes(app: FastifyInstance, ctx: HostContext): void | Promise<void>;
    start?(ctx: HostContext): void | Promise<void>;   // watchers, discovery files
    stop?(): void | Promise<void>;
    contracts?: Record<string, unknown>;   // named in-process contracts, typed per-station
  }
  export interface HostContext { port?: number; getContract<T>(station: string, name: string): T | undefined; log(line: string): void; }
  ```
  In-process contract rule (documents Ship_Spec's "old HTTP contracts become in-process
  interfaces"): a station may export its contract *type declarations* from a dedicated public
  entry; consumers receive the runtime object only via `HostContext.getContract` — never by
  importing another module's internals.
- `src/voyage.ts` — `VoyageItem` (`{ id, title, status, stage_progress, difficulty, remaining_guess_h, updated_at, note, source: 'mission' | 'ledger' }`)
  matching `progress.json` entries and Ship_Spec §3's ledger progress fields — the deliberate
  bridge to the future second data source. Difficulty weights constant mirroring
  `render-progress.mjs` (S=1, M=2, L=3, XL=5, unplanned=M).
- `src/security.ts` — `isAllowedHostHeader(host, port)` (127.0.0.1/localhost/[::1] with optional
  :port) + `DECK_CLIENT_HEADER = 'x-ship-deck'` constant.

### 4.3 `packages/ship` — the hull

- `src/hull.ts` — `createHull(stations: StationDescriptor[], opts: { uiDistDir?, voyageFile?, services? })`:
  Fastify factory (no `.listen()`, same testability discipline as `buildServer`). Registers:
  global `onRequest` Host-allowlist guard (403 otherwise — kills DNS rebinding); Deck UI static
  at `/` (skip-if-absent, like chartroom); `GET /api/hull/stations` →
  `[{name, tab}]` (the UI builds its tab bar from this); voyage routes when configured; then each
  station's `registerRoutes`. Duplicate tab ids → boot error. `start()`/`stop()` lifecycle
  fan-out.
- `src/voyage.ts` — `GET /api/voyage` → `{ file, updatedAt, packages: VoyageItem[] }` (parse-
  tolerant: bad JSON serves last-good + `stale: true`); `GET /api/voyage/events` → SSE
  (`text/event-stream`, heartbeat comment every 25 s, re-push on chokidar change of the single
  file; researcher R4/R5). 404 when no voyage file configured — the UI hides the tab.
- `src/commands/serve.ts` — `ship serve [--port <n>] [--voyage <path>]`: builds the chartroom
  station via `chartroom/station` (below), `createHull([chartroom], …)`, listen on
  `127.0.0.1` with the 4317+ port-walk (same pattern as chartroom's `listenOnFreePort`),
  write `~/.suite/services.json` hull registration, run station `start()` (which writes
  chartroom's `daemon.json` with the hull's port), SIGINT/SIGTERM → station `stop()` +
  best-effort `clearHullRegistration()`. `--voyage` default: `<cwd>/suite-design/overnight/progress.json`
  when it exists, else disabled.
- `src/cli.ts` + bin `ship` (`"bin": { "ship": "./dist/cli.js" }`); commander, mirroring
  chartroom's CLI skeleton. Package published name TBD by Captain (DECISIONS-NEEDED — npm
  `ship` availability is R6); local bin name `ship` per the acceptance line regardless.
- `scripts/copy-ui-dist.mjs` — same pattern as chartroom's (copies `chartroom-ui/dist` →
  `ship/dist/public`), plus the matching `ship#build:ui-bundle` turbo task.

### 4.4 `packages/chartroom` plugin-ification

Functional description (exact seams refreshed at impl, §0):
- Extract from `buildServer` a `registerChartroomRoutes(app, runtimes, opts)` covering ALL
  `/api` routes (docs/save/assets/checkbox/ask-me/inbox/repos/mcp + package 2's raw/register)
  — everything except the UI static mount and `.listen()`. `buildServer` becomes a thin
  composition of Fastify() + UI static + `registerChartroomRoutes` → **standalone
  `chartroom serve` behavior is byte-identical** (its tests and package-2 acceptance scripts are
  the regression proof).
- New `src/station.ts` exported as `chartroom/station`:
  `createChartroomStation(opts?): StationDescriptor` — encapsulates today's serve startup
  (registry read once, initial `rebuild` per repo, live `registrar`, chokidar watchers in
  `start()`, `daemon.json` write in `start()` using the hull's port from `HostContext`, watcher
  close + `daemon.json` cleanup in `stop()`), `tab: { id: 'docs', title: 'Docs' }`.
- `src/commands/serve.ts` refactors to consume the same station internals so there is ONE
  startup codepath; behavior preserved (port walk, messages, daemon.json).
- `package.json`: add `"./station"` export + `suite-conventions` workspace dep.
- Route-ownership convention (documented in ship README): chartroom keeps its existing
  `/api/repos/...` namespace unchanged — package-2 deep links and `chartroom open` URLs keep
  working under the hull with zero changes. Future stations get `/api/<station>/*`; the hull owns
  `/api/hull/*` and `/api/voyage*`.

### 4.5 Claude sessions — hardened salvage

- Route stays in chartroom (`registerClaudeSessionRoute`) — repos are Chart Room's domain; it
  rides into the hull via the station. Fixes over WIP (§3.1): spawn `cwd:` option instead of
  `cd`-in-shell where the terminal host allows it (R1 decides the exact win32 argv; candidate:
  `spawn('cmd', ['/c','start','','wt','-d',repoAbsPath,'claude'], {cwd: repoAbsPath})` and
  fallback `spawn('cmd', ['/c','start','Claude — '+name,'cmd','/k','claude'], {cwd: repoAbsPath})`
  — verified, not trusted); per-request darwin launcher file; env hygiene per R2 (strip
  `CLAUDECODE`/`CLAUDE_CODE_*` from the child env if research confirms nesting guards).
- **Security (hull-wide + route-level):** 127.0.0.1 binding (non-negotiable, kickoff);
  Host-allowlist guard (§4.3); claude-session requires the `x-ship-deck` custom header → a
  cross-origin form/fetch cannot send it without a CORS preflight, and the hull enables no CORS
  → browser-borne CSRF is dead. Same guard retrofitted onto package 2's
  `POST /api/repos/register` (small post-merge diff + test) — it persists registry state and
  must not be form-POSTable either. `chartroom open`'s own register call adds the header.
- Response/API unchanged: 404 unknown repo, 500 readable spawn failure, `{ ok: true }`.

### 4.6 Deck UI shell (`chartroom-ui` becomes the Deck app)

Rationale for consolidation (logged, FO-visible): the spec demands one UI shell with tabs;
splitting a `deck-ui` package tonight would force vite lib-mode dual builds of the Milkdown
editor for zero present benefit (only two tabs exist). The seam is kept honest: stations
register tabs via `GET /api/hull/stations`, the shell renders only tabs the hull reports, and
future station packages will contribute tab components through public exports. Package rename
(`chartroom-ui` → deck app name) deferred to the monorepo migration (DECISIONS-NEEDED).

- `src/App.tsx` — re-authored shell (WIP chrome salvaged per §3.1): top chrome = brand
  ("The Ship — Captain's Deck"), **TabBar** (from `/api/hull/stations` + Voyage-if-available;
  Docs active by default; graceful single-tab mode when served by standalone `chartroom serve`),
  "❯ claude" chip (spawns in active repo; disabled+tooltip when none; busy/toast states from
  WIP). Hash routes: existing `#/repo/...`/`#/inbox...` = Docs tab (unchanged, deep-link
  compatible); new `#/voyage`.
- `src/components/TabBar.tsx` (new) — typed `DeckTab[]` registry; visual grammar from the brass
  system.
- `src/voyage/VoyagePage.tsx` (new) — fetch `/api/voyage`, live via `EventSource` with
  poll-fallback (5 s) on SSE error; sections: In flight / Pending / Done / Parked; per-item
  `ProgressBar` + `DifficultyBadge` + remaining-guess + note + updated-at; overall
  difficulty-weighted mission bar (weights from `suite-conventions`). `ProgressBar`/
  `DifficultyBadge`/`StageSection` built as reusable presentational components — the visual
  grammar the Bridge ledger view will reuse.
- `src/components/RepoTree.tsx` — salvaged per §3.1 (hover "❯" per repo row).
- `src/api/client.ts` — fragment salvage per §3.1 + `fetchHullStations()`, `fetchVoyage()`;
  `openClaudeSession` sends the `x-ship-deck` header.
- Phase-2 files per §3.2.

### 4.7 Build pipeline

`chartroom-ui` builds once; its dist is copied into BOTH `chartroom/dist/public` (standalone,
existing task) and `ship/dist/public` (new task `ship#build:ui-bundle`, same script pattern,
`dependsOn: ["build", "chartroom-ui#build"]`). No root-config changes beyond the turbo task
addition.

## 5. Test plan (vitest; `app.inject()` for routes, real ephemeral listen only where SSE forces it)

- **suite-conventions:** services-json round-trip / corrupt-file tolerance / atomic overwrite
  (injected homeDir); host-allowlist matrix (ports, IPv6, evil hosts); event/voyage zod schemas
  accept spec-shaped fixtures.
- **ship:** hull mounts a fake station (routes reachable, tab listed, duplicate-tab boot error);
  Host-guard 403 (`Host: evil.com`) vs 200 (`127.0.0.1:port`); UI static skip-if-absent;
  `/api/voyage` shapes incl. parse-tolerant bad-JSON; SSE event on file change (real ephemeral
  port, per R4); `services.json` written on listen / cleared on stop; integration: hull + real
  chartroom station over a temp registry+repo → `GET /api/repos`, doc fetch, raw asset, all on
  one injected app.
- **chartroom:** FULL existing suite green (the refactor's regression proof — capture post-merge
  count ≥177 as floor); station.ts unit tests (start writes daemon.json with hull port, stop
  cleans up, registrar liveness); claude-session salvaged+extended tests per §3.1 incl. CSRF 403
  and spaces-in-path argv; register-route CSRF test; needs-you direct unit test; repos-stats test.
- **chartroom-ui:** TabBar render/switch; chip disabled/busy/toast; VoyagePage fixture render
  (sections, bar widths, weighted overall, parked freeze); RepoTree test (new); salvaged
  DocView/InboxPage/editor-mount suites green (phase 2); full existing UI suite green.
- **Monorepo bar:** `pnpm turbo build lint test` green; all chartroom acceptance scripts
  (incl. package 2's) pass unchanged.

## 6. Acceptance demonstration

1. **NEW `packages/ship/acceptance/deck-boot.mjs`:** scratch registry + temp git repo with docs
   + temp `progress.json`; spawn real `ship serve --voyage <tmp>`; poll until healthy; assert:
   ONE port serves the UI html, `/api/hull/stations` (docs tab), `/api/repos` +  a doc,
   `/api/voyage`; `~/.suite/services.json` (isolated via env homedir override) and
   `~/.chartroom/daemon.json` both registered with that port; mutate `progress.json` → SSE/poll
   reflects it; kill by pid; both discovery files cleared.
2. **Chip proof (real machine, this Windows box):** `ship serve` over a real registered repo;
   `POST /api/repos/<id>/claude-session` with the deck header (and via the UI chip) → a real
   terminal window opens running `claude` with cwd = that repo. Evidence in the crew report:
   spawn argv from a debug log + `Get-Process`/window title capture + the wrong-repo negative
   (404). Also the CSRF negative: same POST without the header → 403.
3. **Test-floor evidence:** post-merge Chart Room test count vs the same count on
   `ship-wave1-deck` (must be ≥, all green), shown in the report.

## 7. Facts for a wave-researcher pass (verify before implementation — do NOT trust memory)

- **R1 (blocking, chip):** exact win32 spawn for "open a visible terminal running `claude` in
  dir X" from a detached daemon: `wt.exe` argv + PATH detection reliability; `cmd /c start`
  title/quoting rules under Node's win32 arg quoting for paths with spaces; whether spawn
  `cwd:` option makes `cd /d` unnecessary in both branches; window visibility when the parent
  daemon was itself spawned detached/hidden (package 2's launcher scenario).
- **R2 (blocking, chip):** spawning `claude` from a process that may itself live under a Claude
  Code session — which env vars must be stripped (`CLAUDECODE`, `CLAUDE_CODE_*`?) to avoid
  nested-session guards; how `claude` resolves on Windows PATH (`claude.exe` vs npm `.cmd`
  shim) and whether `cmd /c start` resolves `.cmd` shims.
- **R3:** any UserChoice/App-alias caveat for `wt.exe` detection via `where wt` when Windows
  Terminal is a Store app (App Execution Alias) — does it hold for a daemon running as a
  plain user process?
- **R4:** Fastify v5 SSE without plugins: correct `reply.raw`/`hijack()` pattern, keep-alive +
  `requestTimeout` interplay, clean client-disconnect handling, and the sane test strategy
  (inject vs ephemeral listen).
- **R5:** chokidar v4 watching a single file on Windows when editors/scripts replace it
  atomically (rename-over) — does the watch survive; is `awaitWriteFinish` still supported in v4;
  fallback `fs.watchFile` polling interval if not.
- **R6 (fact-gathering for a Captain decision):** npm availability of `ship` (and sensible
  scoped fallback names) — publishing/naming itself stays Captain-only.

## 8. Risks

1. **Package-2 drift** — plan written against a moving baseline; mitigated by §0's mandatory
   refresh step and functional (not line-level) seam descriptions.
2. **Windows terminal spawn fragility** (R1–R3) — isolated behind the `SpawnLike` seam; worst
   case the fallback `cmd /k` branch ships alone and `wt` support is a fast-follow.
3. **SSE via bare Fastify** (R4) — Voyage tab ships a polling fallback regardless, so SSE
   trouble degrades to 5 s polling, never blocks acceptance.
4. **Scope weight (XL)** — mitigated by the §10 phase cut line: phase 2 is coherent to cut and
   merge later without touching phase-1 files.
5. **UI regression surface** (shell re-author + css swap) — existing UI suites + salvaged WIP
   tests + acceptance scripts; dark-only design accepted deliberately, logged.
6. **Spawn endpoint abuse surface** — mitigated by binding + Host guard + CSRF header;
   residual risk (any local process can POST) is inherent to a local daemon and documented.
7. **Worktree contention** — implementation must not start until the FO confirms package 2 is
   merged and the worktree is free.

## 9. Captain-only decisions (parked to DECISIONS-NEEDED.md, seams built regardless)

1. Parked WIP UX features (search / fs-picker+register-modal / activity+auto-repair+pipeline) —
   schedule as "Chart Room v1.2 UX" package or drop? (Default: parked on quarantine branch.)
2. Hull package published npm name (`ship` availability per R6; local bin stays `ship`).
3. Deck visual defaults taken tonight: brass dark-only system, Google Fonts removed in favor of
   local stacks — review tomorrow.
4. `chartroom-ui` package rename (deck app) at monorepo migration time.

## 10. Implementation order (small conventional commits; phase cut line marked)

0. **Refresh pass** (§0) against merged `ship-wave1`; fold deltas into this plan visibly.
1. Researcher pass R1–R6 → verdicts recorded here.
2. `suite-conventions` package + tests.
3. chartroom route-extraction + `station.ts` export + serve refactor (full suite green before
   proceeding).
4. `ship` package: hull + Host guard + serve + services.json + tests.
5. Voyage backend (routes + watcher) + `deck-boot.mjs` acceptance script.
6. claude-session hardened salvage + register-route CSRF retrofit + tests.
7. UI shell: TabBar + chrome + chip + RepoTree + css system + VoyagePage + client fragments +
   tests. Real-machine chip proof. **← phase-1 complete; acceptance line demonstrable here.**
8. *(Phase 2, FO-cuttable)* DocEditor mount fix + editor-mount test; DocView resolver + tests;
   InboxPage "Ask" + tests; inbox-correctness slice (repo-state/needs-you/inbox/repos-stats) +
   new needs-you test; AskMe/Backlinks/Frontmatter/RefTag/NeedsYouPanel.
9. Full green bar; changelog fragment; `REMOVALS.md` entries for superseded-but-not-deleted
   files; crew report; hand to FO for independent review.
