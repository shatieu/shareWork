---
id: report-03-captains-deck-team-lead
---

# Package 03 — Captain's Deck — Team Lead report (PLANNING stage)

**Verdict: PLAN READY — `suite-design/overnight/plans/03-captains-deck-plan.md`**
Mode respected: no code, no commits, no checkouts. All repo facts read via
`git show ship-wave1:<path>` / `git show f34c297:<path>`, never the live worktree
(package 2 was implementing in it throughout).

## What was done

1. Read: MISSION-CONTEXT, Ship_Spec §2 (one-hull amendment) + §3 progress-fields note,
   Suite-Architecture §1–§3, CAPTAIN-INBOX Order 1 items 2–3, MARATHON-KICKOFF queue item 3,
   plan 02 (§3 WIP mapping inherited), DECISIONS-NEEDED tail, `render-progress.mjs`
   (difficulty weights S1/M2/L3/XL5 — mirrored by the Voyage tab), `progress.json` shape.
2. Baseline verification (all at `ship-wave1`): `chartroom/package.json` (fastify/chokidar/zod
   already deps — new packages need NO new third-party deps), `server.ts` `buildServer` factory
   + static-mount discipline, `serve.ts` 127.0.0.1 binding + 4317 port-walk,
   `copy-ui-dist.mjs` pipeline, `turbo.json`, `pnpm-workspace.yaml` (globs already cover new
   packages), baseline `App.tsx` hash routing.
3. WIP salvage evaluation (dispatch-inherited, ~25 files on f34c297): I read
   `routes/claude-session.ts` in full myself; fanned out two Explore agents over (a) the nine
   server-side items and (b) the fifteen UI items, each reporting what-it-does / hazards /
   deps / test coverage / coupling per file. Their findings corroborated my own reading.

## Key findings folded into the plan

- **No tab/multi-station shell exists in the WIP** — its App.tsx is a Chart-Room-only layout.
  The Deck shell must be re-authored around a TabBar; WIP chrome/css/RepoTree salvage feeds it.
- **claude-session.ts:** sound seams (injectable spawner, platform switch, detached+unref) but
  unquoted `repoAbsPath` (breaks on spaces; latent injection), CSRF-triggerable spawn endpoint,
  darwin launcher TOCTOU, ActivityLog coupling to a parked feature. Plan hardens all four:
  spawn `cwd:` option, hull-wide Host-allowlist guard, `x-ship-deck` custom-header CSRF guard
  (also retrofitted onto package 2's `POST /api/repos/register`), per-request launcher file.
- **Real WIP gems:** DocEditor React-19 mount fix (regression-tested), DocView in-app link
  resolver (well tested), inbox-correctness slice (repo-state key-keyed blocks + needs-you —
  the slice plan 02 explicitly deferred to this package). Salvaged as a coherent, FO-cuttable
  phase 2.
- **Parked (no queue item, per plan-02 FO note):** search, fs folder picker + RegisterRepoModal
  (fs.ts additionally enumerates the whole filesystem with no auth — flagged), activity /
  auto-repair / rebuild-pipeline / LatestPanel. `_spike.test.ts` rejected.
- **package.json byte-identical at both revs** (verified by both reviewers): the WIP adds zero
  npm deps; only external surprise is a Google Fonts link in index.html (plan removes it).

## Architecture decided in the plan

- `packages/suite-conventions` (new): services.json helpers, §2 hook event shapes,
  `StationDescriptor` typed plugin contract, shared `VoyageItem` (mission | ledger), local
  security helpers. Contracts live here to keep `ship` ↔ `chartroom` acyclic.
- `packages/ship` (new): `createHull()` + `ship serve` bin, 127.0.0.1 + Host guard, Deck UI
  static, `/api/hull/stations`, Voyage backend (chokidar + SSE with polling fallback),
  `~/.suite/services.json` registration.
- `chartroom`: routes extracted into `registerChartroomRoutes` + `chartroom/station` export;
  standalone `chartroom serve` byte-identical; station's `start()` writes `daemon.json` with
  the hull port so package 2's `open`/`associate` find the hull automatically.
- `chartroom-ui` becomes the Deck app (consolidation rationale + rename question logged).

## Open items

- Researcher pass R1–R6 required before implementation (win32 terminal spawn argv + wt
  detection, `claude` env/PATH nesting facts, Fastify v5 SSE pattern, chokidar v4 single-file
  watch on Windows, npm name availability for the hull). R1/R2 are blocking for the chip.
- Rebase gate: branch `ship-wave1-deck` only after v1.1 merges; plan §0 lists exactly which
  sections get refreshed against the merged tree (server/serve seams, Sidebar-vs-RepoTree,
  client.ts merge points, test-count floor).
- DECISIONS-NEEDED updated with 4 entries (parked WIP features / hull npm name / visual
  defaults taken / chartroom-ui rename).
- Difficulty XL, ~13–16 h; §10 phase cut line lets the FO trim to ~9–11 h by deferring the
  quality-salvage slice to v1.2.

## Evidence pointers

- Plan: `suite-design/overnight/plans/03-captains-deck-plan.md` (salvage verdict tables §3,
  security design §4.5, acceptance demonstration §6, researcher questions §7).
- Reviewer fan-out summaries are reflected in §3 verdicts; per-file hazards quoted there.
- DECISIONS-NEEDED: new "Package 3 (Captain's Deck) planning" section.

---

# IMPLEMENTATION (2026-07-05/06, branch `ship-wave1-deck` off 3c8de99)

Scope: FO-approved phase 1 ONLY (§10 cut line). Phase 2 stays on the quarantine branch,
proposed as Chart Room v1.2 (Captain pending).

## Step 0 — refresh pass (committed da7e1e4)

Re-verified every seam against the merged v1.1 tree; results in plan `0-REFRESH` section.
Key facts: `buildServer` was already a clean composition; `repo-register` landed with NO CSRF
guard (retrofit confirmed needed); merged `interactiveBlocks` is id-keyed (phase-1 stats use
id-keyed semantics matching today's inbox; v1.2 upgrades both surfaces together).
Baseline test floors captured on 3c8de99: **chartroom 248/35 files, chartroom-ui 144/16**.

## Backend commits (mine, in order)

- `2ca8e1d` suite-conventions: services-json (atomic write, corrupt-tolerant), station contract,
  hook-event zod schemas (loose, discriminated union), voyage schema + weighted-progress formula,
  `isAllowedHostHeader` + `DECK_CLIENT_HEADER`. 35 tests.
- `824c194` chartroom extraction: `registerChartroomRoutes` (all /api routes), `buildServer`
  thinned to Fastify+static+routes, `src/station.ts` (`createChartroomStation` — factory reads
  registry + rebuilds; start = watchers + daemon.json WITH HOST PORT; stop = daemon.json delete
  first, then watcher close), `chartroom serve` refactored onto the station (one codepath),
  `"./station"` export + suite-conventions dep. 6 station tests; full suite 254 green.
- `9b948f9` repos stats (docCount incl. unidentified, brokenLinkCount, needsYouCount inlined with
  today's inbox definition) + repos-stats tests (WIP test ADAPTED: id-less-doc counting case
  removed — that's the cut v1.2 slice; noted in code comment). server.test.ts pinned new shape.
- `cb1c0cf` claude-session hardened salvage per researcher R1-R3: wt branch = DIRECT
  `spawn('wt.exe',['-w','new','-d',repo,'cmd','/k','claude'])` (no `cmd /c start` wrapper; wt
  can't resolve .cmd shims so the command rides in `cmd /k`); fallback = `cmd /c start <title>
  cmd /k claude` with `cwd:` (no `cd /d`); `;`-paths routed to fallback; env hygiene mirrors the
  vendor binary (strip CLAUDECODE + 3 session vars + ENTRYPOINT + AI_AGENT, INVOCATION_ID='');
  wt detection = `where wt` + LOCALAPPDATA existsSync; darwin per-request launcher (TOCTOU fix);
  ActivityLog param dropped (parked). CSRF: route 403s without `x-ship-deck`; same guard
  retrofitted onto `POST /api/repos/register`; `chartroom open` sends the header. 10 new tests
  incl. spaces-in-path, `;`-path, env-strip, darwin/linux argv, 403. chartroom suite 268 green.
- `d2ae02e` packages/ship: `createHull` (Host-allowlist onRequest guard w/ port pinning after
  listen, UI static skip-if-absent, `/api/hull/stations`, duplicate-tab boot error, HostContext
  getContract, services.json write on start / clear FIRST on stop), voyage backend
  (`/api/voyage` parse-tolerant last-good+stale, SSE via `reply.hijack()` per R4, 25s heartbeat,
  chokidar single-file watch per R5), `ship serve` (127.0.0.1 bind, 4317+ walk, voyage default
  `./suite-design/overnight/progress.json`), README (route ownership + security posture +
  naming note), copy-ui-dist script + turbo task. 13 tests (SSE disconnect via real ephemeral
  listen — inject can't propagate destroy, per R4; comment pinned in test).
- `638fbb6` acceptance `packages/ship/acceptance/deck-boot.mjs` — see deviations.
- `1de1f03` plan deviations recorded (see plan `0-DEVIATIONS`): (1) Windows kill-by-pid can't
  run signal handlers → acceptance Phase B drives `hull.stop()` in-process for the
  cleared-files assertion; (2) found+fixed a real startup race: chokidar rename-over BEFORE
  watcher 'ready' fires NO event → `VoyageBackend.start()` awaits ready + re-loads (empirically
  reproduced, regression-tested); (3) undici fetch drops Host overrides → acceptance evil-Host
  probe uses raw node:http.

## Acceptance evidence (backend half)

`node acceptance/deck-boot.mjs` — ALL PASS (18 assertions): real `ship serve` bin on ONE port
served Deck html, `/api/hull/stations` (docs tab), `/api/repos` (stats), a doc, `/api/voyage`;
`Host: evil.com → 403`; claude-session w/o header → 403; scratch-home `services.json` +
`daemon.json` both registered with the hull port; atomic rename-over of progress.json reflected
live; Phase B: `hull.stop()` cleared both discovery files.

All 6 chartroom acceptance scripts PASS unchanged (git-mv, two-repo, editor/ask-me round-trips,
agent-surface e2e, open-associate e2e incl. warm-daemon live registration through the new CSRF
header) — standalone `chartroom serve` behavior preserved.

## Chip proof (real machine, this Windows box, 2026-07-05 ~23:25)

In-process hull composition over a scratch registry pointing at the REAL repo
`C:/thisismydesign/shareWork`; spawner = real `child_process.spawn` wrapped only to record argv.
Sequence: `POST /api/repos/wrong-repo/claude-session` (with header) → **404**; POST without
header → **403**; POST with `x-ship-deck: 1` → **200 {"ok":true}**. Recorded argv:
`wt.exe -w new -d C:/thisismydesign/shareWork cmd /k claude` (detached, stdio ignore,
CLAUDECODE stripped, INVOCATION_ID ''). Observed: WindowsTerminal MainWindowTitle became
"Claude Code"; process tree `WindowsTerminal(7768) → cmd.exe "cmd /k claude"(22656) →
claude.exe(33052, npm shim bin path)` — a real interactive claude session in the right repo.
Cleanup: Stop-Process 33052 + 22656 only (nothing else touched).

## Full gates

`pnpm turbo build lint test` → **12/12 tasks green** (suite-conventions, chartroom,
chartroom-ui, ship × build/lint/test; the "no output files for test" turbo warnings are the
pre-existing coverage-outputs pattern, all packages alike).
