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
