---
id: plan-04-bridge-phase1
---

# Package 04 — Bridge phase 1: Crew plugin skeleton + http hooks + ship-log changelog capture — Implementation Plan

- **Status:** PLAN READY (awaiting FO approval; no code written, no checkouts performed)
- **Feature branch:** `ship-wave1-bridge1` — cut fresh from `ship-wave1` **only after package 3
  (`ship-wave1-deck`) merges**. Do not branch before that merge.
- **Spec:** `Ship_Spec.md` §9 item 1 (build order phase 1), §4 (Changelog / ship-log), §2 (hooks
  architecture + one-hull revision), §7 (Crew plugin, skeleton only), §8 (stack);
  `Suite-Architecture_and_Website_Spec.md` §1 (naming), §3 (monorepo layout: `packages/ship-log`,
  `plugins/crew`); MARATHON-KICKOFF-PROMPT queue item 4.
- **Prior art built on:** `plans/03-captains-deck-plan.md` (StationDescriptor / HostContext /
  suite-conventions events — the contract this package mounts into);
  `reports/02-chartroom-v11-researcher.md` R4 (verified: `claude -p` headless contract, hooks fire
  in `-p` mode, OAuth reuse, `--allowedTools`, JSON output fields) and R5 (`os.homedir()` honors
  `USERPROFILE`/`HOME` — the isolation mechanism for every test and acceptance script here).
- **Difficulty:** L. Honest remaining guess: ~9–12 h implementation + review.
- **Worktree caution (planning time):** package 3 is implementing in this worktree right now.
  All baseline facts were read via `git show ship-wave1:<path>` or from plan/report documents,
  never the working tree. Everything touching `packages/ship` and `packages/suite-conventions`
  is **provisional until the Deck merge** — see §0.

## 0. Rebase-refresh (mandatory step 0 of §10, against merged `ship-wave1`)

**Assumption (explicit):** implementation starts from `ship-wave1` *after* the package-3 merge.
Per plan 03, that merge will have landed: `packages/suite-conventions` (services-json helpers,
`src/events.ts` hook-event types, `src/station.ts` StationDescriptor/HostContext, security
helpers incl. `DECK_CLIENT_HEADER`), `packages/ship` (createHull, `ship serve`, Host-allowlist
guard, voyage routes), `chartroom/station`, and the Deck UI shell.

**To be re-verified at implementation start, folding deltas into this plan visibly:**

1. **The exact merged `StationDescriptor` / `HostContext` signatures** (plan 03 §4.2 is a design,
   not a diff — reviewer/FO corrections may have altered names, `contracts` shape, or lifecycle
   ordering). Everything in §3.3 below binds to whatever actually merged.
2. **`suite-conventions/src/events.ts` real content.** Plan 03 §4.2 says it types the Ship_Spec §2
   event names (`PermissionRequestEvent`, `StopEvent`, `SessionStartEvent`, `SessionEndEvent`,
   `NotificationEvent`, `TaskCreated/CompletedEvent`). Those names are **spec aspiration typed
   before anyone verified the real CLI hook contract**. After this package's researcher pass (§7
   R1), reconcile: real events keep/gain zod schemas matching actual stdin payloads; spec-named
   events the CLI does not emit get marked `/** not emitted by Claude Code <version>; spec §2
   seam */` — additive changes only, never silent removal.
3. **How `ship serve` composes its stations array** (plan 03 §4.3: `createHull([chartroom], …)`)
   — ship-log mounts by being added to that array; capture the exact merged file/function.
4. **Route-ownership convention as merged** (plan 03 §4.4: stations own `/api/<station>/*`) and
   whether the `DECK_CLIENT_HEADER` guard helper is reusable per-route (ship-log's ingest route
   wants it, §3.6).
5. **`~/.suite/services.json` merged shape** (plan 03: `{ version: 1, hull?: { port, pid,
   startedAt, stations } }`) — the hook emitter (§3.2) discovers the hull through it.
6. **Post-merge green-bar counts** (chartroom expected ≥177, chartroom-ui ≥144, plus ship /
   suite-conventions suites) — recorded as the regression floor for this package.
7. **CAPTAIN-INBOX.md** at the package boundary (FO does this; noting the dependency).

### §0 rebase-refresh verdict (developer stage, 2026-07-06, against merged `ship-wave1-bridge1`
which already carries the package-3 merge — commit `5abb16d`, tip `5448f40`)

1. **`StationDescriptor`/`HostContext` (verified, `packages/suite-conventions/src/station.ts`):**
   matches the plan's §3.3 assumption almost exactly. `StationDescriptor = { name, tab?: {id,
   title}, registerRoutes(app, ctx): void|Promise<void>, start?(ctx), stop?(), contracts?:
   Record<string, unknown> }`. `HostContext = { port?: number, getContract<T>(station, name):
   T|undefined, log(line) }`. No deltas — §3.3/§3.5 bind as written.
2. **`suite-conventions/src/events.ts` (real content read, delta found — folding here):** the
   merged file is NOT raw-CLI-shaped. It's already a *suite-envelope convention* layer: a
   `shipHookEventSchema` discriminated union on an `event` literal (`PermissionRequest`,
   `Notification`, `Stop`, `SessionStart`, `SessionEnd`, `TaskCreated`, `TaskCompleted`), each with
   a camelCase `eventCore` (`sessionId`, `project?`, `cwd?`, `timestamp`) + a `.looseObject`
   payload — NOT the raw snake_case CLI stdin shape the researcher's R1 captured empirically
   (`session_id`, `hook_event_name`, `transcript_path`, `reason`, `task_subject`, etc.). This is a
   **different layer than plan §3.2's envelope** (`{v:1, hook_event_name, session_id,
   transcript_path, cwd, emitted_at, payload}`) — the plan's `HookEventEnvelope` (§1.4) is the
   *wire* envelope emit.mjs POSTs; `events.ts`'s `ShipHookEvent` union is a *higher-level, already
   summarized* shape apparently anticipating packages 5/6's consumption. Decision: keep both,
   additive. `events.ts` gets a new export `hookEventEnvelopeSchema`/`HookEventEnvelope` (the raw
   wire shape emit.mjs sends and ship-log's ingest route validates) alongside the existing
   `ShipHookEvent` union (untouched — plan 03's design for a later package, not this one's
   problem to reconcile further). No existing export renamed or removed.
3. **Hull composition (verified, `packages/ship/src/hull.ts` + `src/commands/serve.ts`):**
   `createHull(stations: StationDescriptor[], options)` exactly as plan 03 §4.3 assumed;
   `serve.ts` currently calls `createHull([chartroom], { voyageFile })`. This package's mount is
   a literal one-line array addition: `createHull([chartroom, shipLog], { voyageFile })` plus the
   `ship-log` workspace dependency in `packages/ship/package.json`.
4. **Route ownership (verified):** stations own `/api/<station>/*`; `DECK_CLIENT_HEADER` +
   `isAllowedHostHeader` live in `suite-conventions/src/security.ts`, both plain exported
   functions/constants — directly reusable per-route by ship-log's ingest route as planned.
5. **`~/.suite/services.json` shape (verified, `services-json.ts`):** `{version:1, hull?:
   {port, pid, startedAt, stations: string[]}}` — matches plan exactly; `readServices(homeDir?)`
   is the discovery read emit.mjs performs.
6. **Regression floor:** `pnpm turbo build lint test` on the pre-existing tree (before this
   package's changes) — recorded as the floor this package must not regress below; see developer
   report for the exact counts captured at implementation start.
7. CAPTAIN-INBOX.md dependency note: FO's responsibility, not re-verified here.

Everything else in §1-§10 below stands as designed; no other deltas found.

## 1. Scope

1. **NEW `plugins/crew`** — the Crew plugin skeleton (plugin name `ship-crew` per Ship_Spec §7;
   directory `crew` per Suite-Architecture §3):
   - `.claude-plugin/plugin.json` manifest (exact schema per researcher R2).
   - `hooks/hooks.json` — registers the capture-relevant hook events that the researcher pass
     confirms exist (expected: `SessionStart`, `Stop`, `SessionEnd`; plus any confirmed subset of
     `Notification`, `PermissionRequest`, `TaskCreated`, `TaskCompleted` registered as
     forward-events now that ship-log ingests-and-stores generically).
   - `hooks/emit.mjs` — the **http-hook emitter**: self-contained, Node-stdlib-only (zero deps —
     a plugin distributed by marketplace cannot resolve workspace packages). Reads the hook JSON
     from stdin, wraps it in an envelope (`hook_event_name`, `cwd`, `emitted_at`, raw payload),
     discovers the hull via `~/.suite/services.json`, POSTs to
     `http://127.0.0.1:<port>/api/ship-log/events` with a short timeout (~1.5 s); on any failure
     appends the envelope as one JSONL line to `~/.ship/spool/events.jsonl` (append-only spool).
     **Always exits 0** — a logging hook must never block or degrade a session (fail-open).
   - `agents/README.md` + `skills/README.md` seam stubs (roles/presets are Bridge phase 4 —
     package 8; the skeleton marks where they land).
   - `README.md` — install/enable instructions (per R2), including the scratch-repo test recipe
     and the dogfood recipe for this repo.
2. **NEW `packages/ship-log`** — the changelog service (Ship_Spec §4):
   - SQLite truth store `~/.ship/log.db` (better-sqlite3, WAL) — tables §3.4.
   - Capture pipeline: session tracking from `SessionStart`, entry creation on `SessionEnd`
     (with `Stop` checkpointing), git delta, transcript-tail Haiku summary, in-repo fragment
     files `changelog/entries/<date>--<slug>--<session8>.md` — **create-only, never edited**.
   - Daily rollup: one Haiku call over the day's entries across all projects; stored + served.
   - Spool drain: ingests `~/.ship/spool/events.jsonl` on station start (hull-down capture is
     delayed, not lost).
   - **Station** `ship-log/station` → `createShipLogStation(): StationDescriptor` mounting
     routes under `/api/ship-log/*` into the hull (§3.5). No Deck tab in phase 1.
   - **Standalone bin `ship-log`** (spec §2: every module keeps its own bin): `capture` (stdin
     event → direct local capture, no hull needed), `rollup [--date]`, `build` (compile
     committed `CHANGELOG.md` from fragments — spec §4's `ship log build`), `serve [--port]`
     (station standalone on its own Fastify instance, degraded mode per spec §10).
3. **`packages/ship` (provisional):** add `ship-log` workspace dep; mount
   `createShipLogStation()` in `ship serve`'s stations array. Expected to be a ~5-line diff
   against whatever §0.3 finds.
4. **`packages/suite-conventions` (provisional, additive):** reconcile `events.ts` with the
   verified real hook payloads (§0.2); add the envelope type (`HookEventEnvelope`) ship-log and
   the emitter share. The emitter cannot import it at runtime (stdlib-only rule) — a unit test
   asserts the emitter's literal envelope object satisfies the type (compile-time check in the
   ship-log test suite, which may import both).
5. **Dogfooding (authorized by dispatch):** enable the crew plugin's hooks for THIS repo so real
   sessions here produce fragments under `<repo-root>/changelog/entries/`. Mechanism per R2
   (plugin enable vs. `.claude/settings.json` hooks block); evidence in the crew report.
   Note: this repo's mission tracking already uses the same pattern at
   `suite-design/overnight/changelog/entries/` (mission-level, hand-written) — the product's
   fragments live at the repo root and do not touch the mission's directory.
6. **Changelog fragment for this package** under `suite-design/overnight/changelog/entries/`
   (mission convention), REMOVALS.md untouched (nothing removed; `plugins/README.md` gets its
   "Empty for now" sentence updated — an edit, not a removal).

**Acceptance line (proposal, faithful to spec §9.1):** with the Crew plugin's hooks installed,
two sessions in two different scratch repos each produce a create-only changelog fragment in
their own repo plus a SQLite entry, and one daily rollup digest covers both — demonstrated
deterministically by `packages/ship-log/acceptance/two-repo-log.mjs` (synthetic events, injected
summarizer, isolated HOME) **and** live on this machine by two real `claude -p` sessions with
real Haiku summaries + a real rollup (evidence in the crew report). Bonus proof: hull-down →
event spools → next `ship serve` drains it into a fragment.

## 2. Out of scope

- **Crew roles, scrutiny presets, FO orchestration, Quartermaster** — Bridge phase 4 (package 8).
  The plugin ships hooks + seam stubs only.
- **ship-ledger, MCP tools, task mirroring** (§9.2, package 5); **inbox/permission queue**
  (§9.3, package 6) — but the emitter + generic ingest are designed so those packages add
  consumers, not new transport. `PermissionRequest`'s *synchronous JSON response* flow (hook
  stdout resolves the prompt) is explicitly NOT built — it needs a blocking emitter variant
  (`emit-blocking.mjs` seam noted in the plugin README, built by package 6).
- **Deck tab / UI for the log.** Rollup + timeline UI is the console package (9); Chart Room
  already renders a `changelog/entries/` directory as docs in any registered repo (spec §4).
- **Rollup as MCP tool** ("the Quartermaster's primary food") — lands with ledger MCP (pkg 5).
- **Marketplace distribution** of the plugin (Harbor rail) — local install only tonight.
- **`ship log build` as a hull-CLI proxy** — only the `ship-log build` bin ships; wiring a
  `ship log …` subcommand into the hull CLI is a one-liner parked for a later package.
- **New dependencies beyond `better-sqlite3`** (spec §8-named; approval sought §9.1). Fastify,
  commander, zod, vitest etc. reuse workspace versions.
- **Transcript full parsing/analytics** — only a defensive tail-reader (skill analytics owns
  deep transcript work, Trio §A).

## 3. Architecture and file-level design

### 3.1 Package layout and dependency graph

```
plugins/crew                 (no deps at runtime; devDeps only for lint; hooks/emit.mjs is stdlib-only)
packages/ship-log            (deps: fastify, better-sqlite3, commander, zod, suite-conventions)
packages/ship        [PROV]  (+ dep: ship-log; mounts the station)
packages/suite-conventions [PROV] (+ HookEventEnvelope, events.ts reconciliation — additive)
```
Discipline (plan 03 §4.1): ship-log never imports chartroom or ship internals; only
`suite-conventions` types. The hull is the only package importing `ship-log/station`.
`pnpm-workspace.yaml` globs already cover both new dirs (`packages/*`, `plugins/*`).

### 3.2 `plugins/crew/hooks/emit.mjs` — the http-hook emitter

- Stdlib only: `node:fs`, `node:path`, `node:os`, `node:http` (or global `fetch` with
  `AbortSignal.timeout` — researcher R3 confirms which is safer for a ~1.5 s budget on the
  installed Node). No imports from the workspace. Small (~120 lines), heavily commented — this
  file IS the "http hooks" of Ship_Spec §2 and doubles as first field draft for the Crew product.
- Behavior: read stdin fully (hook JSON) → envelope `{ v: 1, hook_event_name, session_id,
  transcript_path, cwd, emitted_at, payload }` (field names bind to R1's verified stdin shape)
  → read `~/.suite/services.json`; if a live hull is registered, POST
  `/api/ship-log/events` with header `x-ship-deck` (reusing the Deck's local-client header
  constant — value duplicated as a literal, compile-checked in tests per §1.4) → on ANY failure
  (no services.json, refused, timeout, non-2xx) append one JSONL line to
  `~/.ship/spool/events.jsonl` (`fs.appendFileSync`, O_APPEND) → `process.exit(0)` always.
  Stderr only on unexpected internal errors (visible in `claude --debug`, never blocking).
- `hooks/hooks.json` registers every §1.1 event with
  `node "${CLAUDE_PLUGIN_ROOT}/hooks/emit.mjs"` (exact quoting/expansion per R2 on Windows).

### 3.3 `packages/ship-log/src/station.ts` [PROVISIONAL until §0.1]

`createShipLogStation(opts?: { homeDir?, summarizer?, now? }): StationDescriptor` — binds to the
merged contract; expected shape:
- `name: 'ship-log'`, no `tab`.
- `registerRoutes(app, ctx)`: routes of §3.5.
- `start(ctx)`: open db (create `~/.ship` lazily), drain spool (§3.7), sweep orphan sessions
  (§3.8 fallback capture for sessions that died without `SessionEnd`).
- `stop()`: close db.
- `contracts`: `{ 'rollup': getRollup(date) }` — the in-process seam the console package (9)
  will consume via `HostContext.getContract` (typed in `ship-log`'s public entry, per plan 03's
  in-process-contract rule).

### 3.4 Storage — `~/.ship/log.db` (better-sqlite3, WAL) via `src/db.ts`

- `sessions(session_id TEXT PK, cwd, repo_root, project, branch_start, head_start,
  transcript_path, started_at, last_stop_at, ended_at, end_reason, captured INTEGER DEFAULT 0)`
- `entries(id INTEGER PK, session_id, date, project, repo_root, branch, commits_json,
  files_json, summary, summary_model, fragment_path, created_at)`
- `rollups(date TEXT PK, digest_md, model, entry_count, created_at)`
- `schema_meta(version)` — v1; migrations are forward-only `ALTER`s.
- All functions take an injected `homeDir` (R5 pattern) — no test ever touches the real
  `~/.ship`. Synchronous better-sqlite3 API; WAL allows the standalone `ship-log capture` CLI
  and a running hull to write concurrently.

### 3.5 HTTP surface (station routes, all under `/api/ship-log/`)

- `POST /api/ship-log/events` — generic ingest. Requires the `x-ship-deck` header (same local
  CSRF posture as the Deck's mutating routes; the emitter sends it). Validates the envelope
  (zod), stores/updates per §3.8 semantics, returns `202 { queued: true }` immediately;
  capture work (git delta, summary, fragment) runs async after the reply (never blocks the
  hook's 1.5 s budget). Unknown event names are stored in a raw `events_unknown` JSONL sidecar
  (`~/.ship/events-unknown.jsonl`) — forward-compat, nothing dropped.
- `GET /api/ship-log/entries?date=&project=` — list entries (UI/console seam).
- `GET /api/ship-log/rollup/:date` — return stored rollup or 404.
- `POST /api/ship-log/rollup/:date` — build (or rebuild) the rollup for that date (also behind
  `x-ship-deck`).
- `GET /api/ship-log/health` — `{ ok, dbPath, spoolPending }`.

### 3.6 Git delta — `src/git-delta.ts`

`computeDelta(repoRoot, headStart?)`: current branch (`git rev-parse --abbrev-ref HEAD`),
commits `headStart..HEAD` (`git log --format=%H%x09%s`), files touched (`git diff --name-only
headStart..HEAD` ∪ `git status --porcelain` dirty paths). All via `spawnSync` argv arrays (no
shell), cwd = repoRoot, tolerant of: not a git repo (→ null delta), missing `headStart`
(fallback: commits since `started_at` via `git log --since`), detached HEAD, empty repo.
`repoRoot` resolved once at SessionStart via `git rev-parse --show-toplevel` from event `cwd`.

### 3.7 Spool — `src/spool.ts`

Drain on station start and before each rollup build: rename `events.jsonl` →
`events.draining.jsonl` (atomic claim; if a stale `.draining` exists, drain it first — crash
recovery), then process line-by-line through the same ingest path as HTTP, then delete-nothing:
the drained file is truncated to zero and removed is banned-adjacent — **the drained file is
renamed to `events.drained.<ts>.jsonl`** and left (tiny, append-only trail; noted in README).
Malformed lines go to `events-unknown.jsonl`, never crash the drain.

### 3.8 Capture semantics — `src/capture.ts` (the heart)

- `SessionStart` → upsert session row: session_id, cwd, repo_root, project (= repo dir
  basename), branch_start, head_start, transcript_path, started_at.
- `Stop` → update `last_stop_at` + `transcript_path` on the session row (cheap checkpoint).
  **No entry is written on Stop** — R1/R6 must confirm, but per current docs Stop fires at the
  end of every assistant turn; an entry per turn would be noise. Spec §4's "on Stop/SessionEnd"
  is read as "the Stop-family hooks", with SessionEnd as the authoritative capture trigger.
  If R6 finds sessions commonly die without SessionEnd, the orphan sweep (below) is the net.
- `SessionEnd` → mark session ended (+ reason), then **capture**: compute git delta; read
  transcript tail (`src/transcript.ts`: last ~80 JSONL lines, defensively parsed, text extracts
  only, size-capped ~16 KB); summarize (§3.9); insert entry; write fragment (§3.10); set
  `captured=1`. Idempotent: a second SessionEnd for a captured session is a no-op (dedupe by
  `captured` flag — fragment can never be double-written).
- **Orphan sweep** (start + rollup time): sessions with `last_stop_at` older than 2 h, not
  ended, not captured → capture with `end_reason='orphaned'` (delta vs head_start still valid).
- Sessions with **no git delta and no meaningful transcript tail** get a SQLite entry but **no
  fragment** (fragment noise floor; FO may override to always-write — flagged §9.2).
- Missing SessionStart (hooks installed mid-session, spool loss): capture degrades — delta
  falls back to `--since started-at-unknown` → dirty-files-only; summary still runs; fragment
  written with a `partial: true` frontmatter flag.

### 3.9 Summary — `src/summarize.ts`

- Interface `Summarizer = (input: { project, branch, commits, files, transcriptTail }) =>
  Promise<{ text, model } | null>`; everything downstream takes it injected (tests use a fake).
- Default impl: `claude -p` with `--model <haiku alias per R5>`, `--max-turns 1`,
  `--max-budget-usd 0.05`, `--output-format json`, `--tools ""`/minimal, prompt+content passed
  via **stdin** (Windows argv length safety; exact mechanism per R5), 60 s timeout, cwd = a
  neutral temp dir (never the captured repo — the summarizer must not load that repo's hooks:
  loop risk, see §8.1). R4 verified: OAuth reuse, JSON `result` field, cost fields.
- Failure/timeout → `null` → fallback summary = commit subjects joined (+ "N files touched") —
  the entry and fragment always complete without network/credits.
- Rollup uses the same interface with a different prompt over the day's entries (one call).

### 3.10 Fragments — `src/fragments.ts`

- Path: `<repoRoot>/changelog/entries/<YYYY-MM-DD>--<slug>--<session8>.md`; slug from branch
  (sanitized) else first summary words; `session8` = first 8 chars of session_id → filename
  collision-free by construction (towncrier/changesets pattern, spec §4).
- Content: frontmatter `id: log-<session8>` (Chart-Room-indexable from day one — dogfood),
  `date`, `project`, `branch`, `session`, `partial?` + body: summary paragraph, commit list,
  files-touched count. **`wx` open flag (create-only, never overwrite, never edit)** — if the
  file exists, log-and-skip; nothing ever edits an existing fragment.
- Written only inside a real git repo root; `mkdir -p changelog/entries` on demand.

### 3.11 CLI — `src/cli.ts`, bin `ship-log`

`capture` (reads one envelope from stdin → full local capture path, no hull — the degraded/
standalone mode); `rollup [--date YYYY-MM-DD]` (local date default; prints digest);
`build [--repo <path>] [--out CHANGELOG.md]` (concatenate that repo's fragments newest-first
into a committed CHANGELOG.md — deterministic, no LLM); `serve [--port]` (standalone Fastify +
station routes, 127.0.0.1 only, same Host-guard helper from suite-conventions).

## 4. Monorepo integration

- `packages/ship-log/package.json`: `"type": "module"`, `engines.node >=20`, exports `"."`
  (lib) + `"./station"`, bin `ship-log`, scripts build/lint/test mirroring chartroom's.
- **pnpm 10 gotcha (must-do):** better-sqlite3 has a native build/postinstall; pnpm 10 blocks
  dependency build scripts by default → root `package.json` gets
  `"pnpm": { "onlyBuiltDependencies": ["better-sqlite3"] }` (exact key per R4). Without this the
  db layer fails at require-time with a misleading error.
- `plugins/crew/package.json`: private, no runtime deps, lint script only (turbo-visible);
  plugin payload files are plain (plugin.json, hooks/, README) — nothing to build.
- turbo: default task inheritance suffices (no ui-bundle-style special task).

## 5. Test plan (vitest; injected homeDir everywhere — no test touches real `~/.ship`/`~/.suite`)

- **db.ts:** schema create/reopen (WAL persists), session upsert, entry insert, rollup upsert,
  idempotent re-init, concurrent second connection (CLI-vs-hull simulation).
- **git-delta:** scratch repos — commits+dirty files vs head_start; not-a-repo → null; empty
  repo; detached HEAD; missing head_start fallback.
- **transcript:** fixture JSONL tail extraction; malformed lines skipped; size cap.
- **capture:** fake summarizer — full SessionStart→Stop→SessionEnd flow produces exactly one
  entry + one fragment; SessionEnd idempotence (no double fragment); Stop writes no entry;
  no-delta session → entry without fragment; missing-SessionStart degraded path (`partial`);
  orphan sweep captures a stale session.
- **fragments:** filename shape; create-only (`wx` — pre-existing file untouched, byte-compared);
  frontmatter id; never-edit invariant.
- **spool:** append→drain→ingested; stale `.draining` recovery; malformed line → unknown-sidecar;
  drained file renamed, not deleted.
- **summarize:** fake `claude` runner (injectable spawn) — success parse, timeout → null,
  non-zero exit → null; fallback summary content.
- **station routes** (Fastify inject, station mounted on a bare Fastify — and one integration
  test on the real merged `createHull` [PROVISIONAL]): POST event 202 + async capture completes;
  missing `x-ship-deck` → 403; bad envelope → 400; unknown event → sidecar; entries/rollup GETs;
  health.
- **emit.mjs (child-process tests):** spawn `node emit.mjs` with stdin fixture against a real
  ephemeral local http server → envelope received with header; server down → spool line appended;
  no services.json → spool; always exit code 0 (asserted in every case); envelope object
  satisfies `HookEventEnvelope` (compile-time).
- **plugin manifest:** plugin.json + hooks.json parse and match the R2-verified schema (zod).
- **Monorepo bar:** `pnpm turbo build lint test` green; chartroom/chartroom-ui/ship suites at
  the §0.6 floor (this package must not touch their behavior).

## 6. Acceptance demonstration

1. **`packages/ship-log/acceptance/two-repo-log.mjs` (deterministic, CI-able):** isolated
   HOME/USERPROFILE (R5); two scratch git repos with real commits; boot the real merged
   `ship serve` (hull + chartroom + ship-log) on an ephemeral port; pipe synthetic
   SessionStart/Stop/SessionEnd envelopes for two sessions **through the real `emit.mjs`**
   (env-pointed services.json); summarizer = injected fake via a `SHIP_LOG_FAKE_SUMMARIZER=1`
   test seam (documented, refused outside NODE_ENV=test) — assert: one fragment per repo
   (create-only, correct names/frontmatter), two SQLite entries, `POST rollup` → digest covering
   both projects, `GET rollup` serves it. Then: kill hull, emit an event → spool line; restart →
   drained into a third entry. Exit non-zero on any failure.
2. **Live proof (this machine, evidence in crew report):** install the plugin into a scratch
   repo pair per the README; run two real `claude -p --model haiku` micro-sessions (R4 recipe,
   `--allowedTools` minimal, cents); show real fragments with real Haiku summaries + a real
   rollup digest; paste fragment contents + `sqlite3`-free db dump (via a tiny inspect script)
   into the report. **This is the spec's acceptance line, literally.**
3. **Dogfood (authorized):** enable the hooks for THIS repo; show the first real fragment
   produced by a session here. Fragment files are committed (they are the shareable form —
   §9.3 flags the policy for the Captain).

## 7. Facts for a wave-researcher pass (verify before implementation — do NOT trust memory)

Builds on report 02 R4 (already verified: hooks fire in `-p` mode incl. PostToolUseFailure;
`--output-format json` fields; OAuth reuse; `--max-turns`/`--max-budget-usd`; settings that
fail validation are silently ignored in `-p`). New questions:

- **R1 (blocking):** the CLI's real hook-event inventory and stdin payloads on the installed
  version (2.1.201+): exact JSON fields for `SessionStart` (incl. `source`), `Stop`
  (`stop_hook_active`?), `SessionEnd` (`reason` values); does `SessionEnd` fire on all exit
  paths (`exit`, Ctrl+C, window close)? Which of Ship_Spec §2's `PermissionRequest`,
  `TaskCreated`, `TaskCompleted` exist at all (any agent-teams hooks)? `Notification` payload
  shape. Method: docs + empirical log-to-file hook in a scratch repo (R4's proven recipe).
- **R2 (blocking):** plugin anatomy + local enablement: `.claude-plugin/plugin.json` required
  fields; is `hooks/hooks.json` the auto-loaded location; `${CLAUDE_PLUGIN_ROOT}` expansion and
  quoting **on Windows**; local install path (`claude plugin marketplace add <local-path>` /
  `--plugin-dir` / `enabledPlugins` in settings) and what "enable for a repo" means for hooks;
  do plugin hooks fire in `-p` mode like project hooks (R4 proved project `.claude/settings.json`
  hooks do — re-verify for plugin-delivered ones).
- **R3 (blocking):** hook execution contract: default timeout + per-hook `timeout` config; are
  multiple hooks parallel; does a slow SessionEnd hook delay CLI exit (UX budget for emit.mjs);
  Windows: what shell (if any) runs `command` — does plain `node "${CLAUDE_PLUGIN_ROOT}\..."`
  resolve; is global `fetch` + `AbortSignal.timeout` safe on the floor Node (>=20) or use
  `node:http` manually.
- **R4 (blocking):** better-sqlite3: current major, prebuilt binaries for win32-x64 Node 20/22/24
  (Captain's machine runs 24.14), pnpm 10 `onlyBuiltDependencies` exact behavior/key, license.
- **R5:** `claude -p` summarizer specifics: valid `--model` alias for Haiku on 2.1.201; piping
  long content via stdin (`claude -p` reads stdin when prompt arg present? or `-p` prompt +
  stdin content contract); `--tools ""` legality to fully disable tools; interaction of cwd's
  hooks with `-p` (confirm running from a neutral dir avoids loading the target repo's hooks —
  the §8.1 loop guard).
- **R6:** Stop-vs-SessionEnd firing frequency in real sessions (empirical: counter hook over a
  short interactive + a `-p` session) — confirms §3.8's "no entry on Stop" reading; whether
  `Stop` fires for subagents (`SubagentStop` separate?) so the emitter registration list is right.

## 8. Risks

1. **Hook-loop / self-capture:** the summarizer's own `claude -p` run, or any session spawned by
   tests, fires hooks → captures itself → recursion. Guards: summarizer runs `--bare`?  NO —
   R4 showed `--bare` breaks OAuth; instead run from a neutral non-repo cwd with no plugin
   enabled + env marker `SHIP_LOG_SUMMARIZER=1` that emit.mjs treats as "exit 0 immediately".
   Cheap, testable, documented. (Emitter-side guard is authoritative; R5 verifies the cwd rule.)
2. **Spec-vs-reality event gap:** if `PermissionRequest`/`TaskCreated`/`TaskCompleted` don't
   exist in the CLI (R1), packages 5–6's designs inherit a real problem. This package stores
   whatever exists, marks the gap in suite-conventions types, and flags it in DECISIONS-NEEDED —
   phase 1 acceptance needs only SessionStart/Stop/SessionEnd.
3. **better-sqlite3 native build on Windows** (R4): prebuilds normally cover win32; if the
   installed Node 24 lacks one, fallback is compiling (needs MSVC — may not exist here). Plan B
   (FO decision at impl time): pin the newest major with a Node-24 prebuild.
4. **Package-3 drift:** all [PROVISIONAL] marks + §0 refresh; ship-log's core (db, capture,
   fragments, spool, CLI) is hull-independent by design, so Deck-contract drift only moves the
   thin station file.
5. **SessionEnd unreliability** (crashes, killed windows): orphan sweep (§3.8) is the net;
   acceptance doesn't depend on it but a test proves it.
6. **Summary latency/cost:** capture replies 202 and summarizes async; hard 60 s timeout +
   deterministic fallback → a dead/slow `claude` CLI can never wedge the hull or lose an entry.
7. **Hook UX drag:** emit.mjs budget ~1.5 s worst-case (timeout) on SessionEnd only; Stop path
   identical but R3 confirms whether Stop-hook latency is user-visible; if so, drop `Stop` from
   hooks.json (checkpointing is a nicety, not acceptance-relevant).
8. **Fragment noise in real repos** (entry-per-session): mitigated by the no-delta-no-fragment
   rule (§3.8); policy knob flagged to Captain (§9.2).

## 9. Captain-only decisions (parked to DECISIONS-NEEDED.md; seams built regardless)

1. **Summarizer engine:** default taken = `claude -p --model haiku` (verified R4: OAuth reuse, no
   new dependency, cents/day) instead of spec §8's literal "Haiku via Agent SDK" (new dependency
   + API-key management). Interface-injected, so swapping later is one file.
2. **Fragment noise policy:** default = fragment only when the session changed the repo (else
   SQLite-only). Alternative: every session fragments.
3. **Dogfood fragment commit policy for shareWork:** default = `changelog/entries/` fragments
   are committed (they're the product's shareable form). Alternative: gitignore until the
   monorepo migration.
4. **If R1 finds Ship_Spec §2 events missing from the real CLI** (esp. `PermissionRequest`):
   spec amendment territory — affects packages 5–6 design, not this one's acceptance.

## 10. Implementation order (small conventional commits; researcher first)

0. **Rebase-refresh pass (§0)** against merged `ship-wave1`; fold deltas into this plan visibly;
   record test-count floor. Branch `ship-wave1-bridge1` only now.
1. Researcher pass R1–R6 → verdicts appended to this plan + reports file.
2. `ship-log` core: db.ts + git-delta + transcript + fragments + spool + tests (hull-independent;
   can start even if 0 slips, minus station wiring).
3. capture.ts + summarize.ts (+ loop-guard env) + tests.
4. CLI (`capture`/`rollup`/`build`/`serve`) + tests.
5. suite-conventions reconciliation (events.ts + HookEventEnvelope, additive) [PROVISIONAL].
6. station.ts + route tests; mount into `ship serve` + hull integration test [PROVISIONAL].
7. `plugins/crew`: plugin.json + hooks.json + emit.mjs + child-process tests + README stubs.
8. `acceptance/two-repo-log.mjs` green.
9. Live proof: scratch-repo real-session run + dogfood enable on this repo; evidence to report.
10. Full green bar (`pnpm turbo build lint test` + floors); changelog fragment (mission dir);
    DECISIONS-NEEDED entries; crew report; hand to FO for independent review.
