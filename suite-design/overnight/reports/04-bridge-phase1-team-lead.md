---
id: report-04-bridge-phase1-team-lead-planning
---

# Package 04 — Bridge phase 1 — Team Lead report (PLANNING stage)

Date: 2026-07-05. Mode: planning only. No code written, no checkouts, no branch created.
Worktree was hot with package 3 the whole time — every baseline fact was read via
`git show ship-wave1:<path>` or from plan/report documents, never the working tree.

## What was produced

- **Plan:** `suite-design/overnight/plans/04-bridge-phase1-plan.md` — complete: scope,
  out-of-scope, file-level design (Deck-dependent parts explicitly marked [PROVISIONAL]),
  §0 rebase-refresh section (plan-03-§0 pattern, as dispatched), capture-semantics design,
  test plan, acceptance proposal, researcher questions R1–R6, risks, Captain decisions,
  implementation order.
- **DECISIONS-NEEDED.md:** appended a "Package 4 (Bridge phase 1) planning" section with 4
  entries (summarizer engine default, fragment noise policy, dogfood commit policy, potential
  Ship_Spec-§2-vs-real-CLI event gap).

## Evidence trail (what was actually read)

- `MISSION-CONTEXT.md`; `Ship_Spec.md` in full (§2 one-hull revision, §4 changelog, §7 crew,
  §8 stack, §9.1 acceptance line, §10–11); `Suite-Architecture_and_Website_Spec.md` §1–§3
  (naming: dir `plugins/crew`, plugin name `ship-crew`, package `packages/ship-log`).
- `plans/03-captains-deck-plan.md` in full — the plan binds ship-log's station to plan 03 §4.2's
  StationDescriptor/HostContext and §4.4's route-ownership convention, with §0 of my plan
  listing exactly which of those facts must be re-verified against the merged tree.
- `reports/02-chartroom-v11-researcher.md` — R4 (claude -p headless: hooks fire in -p, JSON
  output fields, OAuth reuse, budget flags) and R5 (homedir override) are load-bearing for the
  summarizer design and every test's isolation strategy; cited in the plan rather than re-asked.
- Baseline via `git show ship-wave1:` — root package.json (pnpm 10 → the better-sqlite3
  onlyBuiltDependencies gotcha, plan §4), pnpm-workspace.yaml (globs already cover plugins/*),
  plugins/README.md (only file in plugins/), chartroom/package.json (workspace versions to
  reuse: fastify, zod, commander, vitest), no tracked `.claude/settings.json` (dogfood target).
- `MARATHON-KICKOFF-PROMPT.md` queue item 4 + PLAN.md + DECISIONS-NEEDED.md history.

## Key design calls (FO should challenge these)

1. **Emitter is stdlib-only and fail-open** (`plugins/crew/hooks/emit.mjs`): POST to hull with
   1.5 s budget, spool to `~/.ship/spool/events.jsonl` on any failure, always exit 0. A
   marketplace plugin can't resolve workspace deps — this is why the emitter is thin and the
   brains live in `packages/ship-log`.
2. **Capture on SessionEnd, not Stop** (Stop = per-turn checkpoint only; orphan sweep as the
   net for crashed sessions). Spec's "on Stop/SessionEnd" read as trigger-family; R6 verifies.
3. **Summarizer = `claude -p --model haiku`** (injected interface; R4-verified) over the spec's
   literal "Agent SDK" — parked to Captain with rationale. Deterministic fallback (commit
   subjects) so capture never depends on network/credits.
4. **Hook-loop guard:** summarizer child runs from a neutral cwd + `SHIP_LOG_SUMMARIZER=1` env
   marker that emit.mjs short-circuits on — self-capture recursion is structurally dead.
5. **One new dependency requested: better-sqlite3** (spec §8-named). Includes the pnpm-10
   `onlyBuiltDependencies` root change — called out explicitly since it touches root config.
6. **Acceptance = two tiers:** deterministic `acceptance/two-repo-log.mjs` (synthetic events
   through the real emitter + real hull, fake summarizer, isolated HOME) + a live run on this
   machine (two real `claude -p` sessions, real Haiku fragments + rollup) matching spec §9.1
   literally. Plus spool-drain proof (hull down → capture delayed, not lost).

## Researcher pass needed before implementation (plan §7)

R1 real hook-event inventory + stdin payloads (SessionStart/Stop/SessionEnd fields; do
PermissionRequest/TaskCreated/TaskCompleted exist at all?); R2 plugin anatomy + local
enable mechanics on Windows (${CLAUDE_PLUGIN_ROOT} quoting); R3 hook timeout/shell contract;
R4 better-sqlite3 win32 prebuilds for Node 24 + pnpm-10 allowlist key; R5 haiku model alias +
stdin content passing; R6 Stop firing frequency. R1–R4 are blocking; all are cheap
(docs + the R4-style scratch-repo empirical recipe already proven in package 2).

## Risks worth the FO's eye

- Package-3 drift is the big one — mitigated by §0 refresh + keeping ship-log's core
  hull-independent (only station.ts + the ship-serve mount are contract-coupled).
- If R1 finds the spec's PermissionRequest/Task* events don't exist, packages 5–6 inherit a
  real design problem (flagged in DECISIONS-NEEDED #4); phase 1 acceptance is unaffected.
- better-sqlite3 native-build failure on this box would need a version pin decision at impl
  time (plan §8.3).

## State

- Branch `ship-wave1-bridge1`: NOT created (correct — Deck still implementing).
- Files written this stage: the plan, the DECISIONS-NEEDED append, this report. Nothing else
  touched. `team-tasks/` untouched. Nothing removed (REMOVALS.md unchanged).

---

# IMPLEMENTATION (team-lead continuation, 2026-07-06 ~05:00-05:30 local)

Mode: implementation continuation after two prior developer sessions were killed by session
limits. In-context state was lost; truth reconstructed from disk per the FO dispatch.

## Inventory findings (what the resurrections left behind)

- Branch `ship-wave1-bridge1` checked out, ONE commit ahead of `ship-wave1` (9b28bcd, a lookout
  guard fix, not bridge work). ALL bridge work sat uncommitted: `packages/ship-log/` (14 src
  files, 12 test files, built dist) and `plugins/crew/` untracked; `packages/ship`,
  `packages/suite-conventions`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `plugins/README.md`,
  and the plan's section-0 verdict modified but unstaged.
- Verified against the plan + FO directives BEFORE committing: emit.mjs already complied with
  the 700 ms directive (AbortSignal.timeout(700), spool fallback, SHIP_LOG_SUMMARIZER loop
  guard, always exit 0); hooks.json exec-form `${CLAUDE_PLUGIN_ROOT}` args per R2;
  onlyBuiltDependencies already in pnpm-workspace.yaml per FO directive 3; suite-conventions
  envelope additive-only; serve.ts mount a 2-line diff. 69/69 pre-existing ship-log tests green
  on first run. Committed as 5 slices (commit list below).
- NOT ours, left strictly alone: `team-tasks/*` modifications, untracked
  `team-tasks/.../invite-section.tsx`, untracked `suite-design/Chart Room.html` -- the Captain's
  own working-tree changes sharing this worktree. Zero team-tasks content in any commit
  (per-commit explicit pathspecs; never `git add -A`).

## What I built on top (the missing plan items)

1. **`SHIP_LOG_FAKE_SUMMARIZER` seam** (plan section 6.1) in summarize.ts -- active only when
   BOTH `SHIP_LOG_FAKE_SUMMARIZER=1` and `NODE_ENV=test`; unit-tested (refusal matrix + fake
   path).
2. **`acceptance/two-repo-log.mjs`** (deck-boot.mjs pattern): isolated HOME/USERPROFILE; two
   scratch git repos with real commits; REAL spawned `ship serve` bin; every event through the
   REAL `plugins/crew/hooks/emit.mjs` child process using R1's raw stdin payload shapes;
   asserts 403-without-header, per-repo create-only fragments (date--slug--session8,
   `id: log-<session8>` frontmatter, real commit subjects), 2 SQLite entries via API, rollup
   POST/GET covering both projects, then the spool proof: hard-kill hull -> 2 events spool
   (emitter exits 0) -> restart drains into a third entry, drained file renamed
   `events.drained.<ts>.jsonl` (never deleted), health clean. **All assertions pass.**
3. **deck-boot.mjs updated**: `/api/hull/stations` now lists chartroom (Docs tab) + tab-less
   ship-log; re-run green (package-3 acceptance unharmed).
4. **`resolveClaudeBinary()`** -- live proof exposed that `spawnSync('claude')` is ENOENT on
   Windows (npm .cmd shim; Node refuses .cmd without shell). Resolver walks PATH to the nested
   native `@anthropic-ai/claude-code/bin/claude.exe`; `SHIP_LOG_CLAUDE_PATH` override; 4 unit
   tests. Before the fix the live capture correctly fell back (entries 1-2: summary_model null,
   fallback text -- fail-open proven accidentally); after it, real Haiku summaries flowed.
5. **Prompt hardening** after the first live rollup came back as a clarifying question
   ("What was the change in live-proof-delta?...") instead of a digest: entry+rollup prompts
   now forbid questions/addressing the reader and require every project named. Rebuilt rollup:
   proper digest naming all four projects.
6. **Local marketplace manifest** `plugins/.claude-plugin/marketplace.json` (mechanism-B
   install requires it -- `claude plugin marketplace add` refuses a bare plugin dir).

## Live proof (spec 9.1 acceptance line, literally -- total spend ~$0.13 of the $0.30 cap)

- Hull: `ship serve` on real home, port 4317, stations chartroom + ship-log, db
  `C:\Users\ourba\.ship\log.db`.
- Two real sessions (`claude -p "Reply with exactly: ok" --plugin-dir <crew> --model haiku
  --allowedTools Read`), cwd = two scratch repos with a dirty file each:
  - live-proof-gamma, session fd4d7f82..., $0.0194 -> fragment `2026-07-06--main--fd4d7f82.md`,
    entry id 3, summary_model **haiku**, real summary text.
  - live-proof-delta, session ec52a787..., $0.0214 -> fragment `2026-07-06--main--ec52a787.md`,
    entry id 4, summary_model **haiku**.
- Rollup: `POST /api/ship-log/rollup/2026-07-06` -> `{model: "haiku", entry_count: 4}`, digest
  names alpha/beta/gamma/delta (alpha/beta are the pre-fix fallback entries -- honest history,
  left in the real db).
- Earlier sessions 630c36bd/7464ea7e ($0.039) predate the claude.exe fix: entries+fragments
  captured with fallback summaries -- kept as evidence that capture never depends on the LLM.
- **Dogfood ON**: `claude plugin marketplace add <repo>/plugins` + `claude plugin install
  ship-crew@sharework --scope project` (wrote `.claude/settings.json` enabledPlugins,
  committed). First live shareWork fragment from a real session (16bbcd68, $0.024):
  `changelog/entries/2026-07-06--ship-wave1-bridge1--16bbcd68.md` -- real Haiku summary,
  correct branch, committed. Note: `marketplace add` also wrote the Captain's user settings
  (machine-local, R2-documented side effect); other machines cloning the repo will see an
  unknown-plugin enabledPlugins entry until they add the marketplace.
- Teardown: hull killed, stale `~/.suite/services.json` hull entry hand-cleared (hard kill
  cannot run the graceful-stop path). Future dogfood sessions spool to `~/.ship/spool/` until
  the next `ship serve` -- by design.

## Gates (final, fresh `--force` run)

- `pnpm turbo build lint test --force`: **17/17 tasks green** -- chartroom 268/268 (floor 268),
  chartroom-ui 172/172 (floor 172), ship 13/13 (floor 13), ship-log **75/75**,
  suite-conventions 35/35.
- `node packages/ship-log/acceptance/two-repo-log.mjs` -> "all assertions passed" (incl. spool
  drain proof).
- `node packages/ship/acceptance/deck-boot.mjs` -> "all assertions passed".

## Commits on ship-wave1-bridge1 (oldest first, after inherited 9b28bcd)

    8d25b1f docs(bridge1): fold section-0 rebase-refresh verdict into package 4 plan
    7d5fae1 feat(suite-conventions): add raw wire HookEventEnvelope schema (additive)
    5f2e9f8 feat(crew): ship-crew plugin skeleton -- http-hook emitter, hooks.json, seam stubs
    a2df527 feat(ship-log): changelog capture service -- db, capture, fragments, spool,
            summarizer, rollup, CLI, station
    373db12 feat(ship): mount ship-log station into ship serve
    66e66ed feat(ship-log): fake-summarizer acceptance seam (SHIP_LOG_FAKE_SUMMARIZER,
            test-env only)
    24e22d2 test(ship-log): two-repo-log acceptance script -- real hull, real emitter,
            spool-drain proof
    0078bb1 test(ship): deck-boot expects the tab-less ship-log station alongside chartroom
    ea9d399 fix(ship-log): declare node script globals for acceptance mjs lint
    7921845 fix(ship-log): resolve claude.exe behind the npm shim on Windows; harden
            summary/rollup prompts
    69795dc feat(crew): dogfood enable for shareWork -- local marketplace, project-scoped
            install, first live fragment
    (+ final docs commit: mission changelog fragment, plan deviations note, this section)

## Deviations from the approved plan

All recorded in the plan file itself, section-0 "Implementation deviations" (7 items): 700 ms
budget (FO directive), argv prompt instead of unresearched-R5 stdin (4,000-char cap),
resolveClaudeBinary, local marketplace manifest, onlyBuiltDependencies location (FO directive),
boolean spoolPending, prompt hardening.

## Risks / notes for the reviewer

- Windows-only summarizer resolution is PATH-heuristic; `SHIP_LOG_CLAUDE_PATH` is the escape
  hatch. Non-Windows path untested on this box (returns plain 'claude').
- `claude plugin marketplace add` left machine-local user-settings state (sharework
  marketplace); removal is ordinary `claude plugin` commands -- not a CAPTAIN-TODO, but the
  reviewer should know the machine is not pristine.
- Real `~/.ship/log.db` now has 5 sessions / 5 entries / 1 rollup from the live proof + dogfood
  -- deliberate (it IS the product's real store on this machine).
- Stop-hook latency (plan 8.7): not re-measured; Stop registration kept (R3: fast hooks <1 s
  always completed; emit.mjs worst case ~700 ms + spool append).
- REMOVALS.md untouched -- nothing deleted anywhere (spool "drained" files are renames; scratch
  temp dirs under %TEMP% cleaned by the acceptance script per deck-boot precedent).
- `team-tasks/` untouched by every commit (verify: `git log --stat -- team-tasks/`).
