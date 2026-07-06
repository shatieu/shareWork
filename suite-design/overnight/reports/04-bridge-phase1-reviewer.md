---
id: package-04-bridge-phase-1-reviewer-report
---

# Package 04 — Bridge phase 1 — Reviewer report

Date: 2026-07-06. Reviewer: independent adversarial pass per charter (lean review).
Branch reviewed: `ship-wave1-bridge1` (HEAD `5573eac`) vs `ship-wave1` (`5abb16d`).

## VERDICT: FAIL

**One concrete, reproducible reason:** the package's own deterministic acceptance gate,
`packages/ship-log/acceptance/two-repo-log.mjs` (the mandated non-negotiable), is flaky at
roughly a 1-in-3 rate on the target machine due to a real race in the ingest design, and it
failed my very first plain run. Everything else in the package is in good shape — the fix is
small and once the acceptance runs green reliably this package should PASS on re-review.

## What I executed personally

1. `node packages/ship-log/acceptance/two-repo-log.mjs` — plain runs:
   - Run 1: **FAIL** — `timed out waiting for: both sessions captured into entries with fragments`
   - Run 2: PASS (all assertions)
   - Run 3: **FAIL** (same timeout; ran under concurrent load)
   - 6 further runs of a diagnostics-instrumented copy under `%TEMP%\bridge1-review\`
     (identical logic + failure dumps): 2 more failures, 4 passes.
   - **Total: 3–4 failures out of ~10 runs.**
2. `pnpm --filter ship-log test` — **75/75 green** (12 files).
3. `pnpm --filter ship test` — **13/13 green** (3 files).
4. Custom phase-1 repro (`%TEMP%\bridge1-review\debug-phase1.mjs`) — single-session capture
   works end-to-end through the real emitter + real `ship serve` when timing cooperates.

## Root cause of the acceptance flake (diagnosed, evidence captured)

`packages/ship-log/src/station.ts:66` — the `POST /api/ship-log/events` route sends the
`202 { queued: true }` reply and only *then* runs `ingestEnvelope` (fire-and-forget). For
`SessionStart`, `ingestEnvelope` → `onSessionStart` (`src/capture.ts:63`) runs three
`spawnSync` git calls (`findRepoRoot`, `currentBranch`, `currentHead`), each ~30–100 ms.
The 202 hits the wire before those complete, `emit.mjs` exits, and the acceptance script
immediately writes + commits in the scratch repo. When the script's `git commit` completes
before the server's `currentHead` snapshot, **`head_start` is recorded as the post-commit
HEAD** → `head_start..HEAD` is empty → empty delta → the changed-only fragment policy writes
no fragment → the script's `waitFor(rows.every(r => r.fragmentPath))` times out at 20 s.

Direct evidence from a failing run (sessions-table dump on timeout):

- session A `head_start = b1020bc2…`; scratch repo A's `git log` shows `b1020bc2… feat: alpha-work`
  — i.e. head_start IS the commit made *after* SessionStart was emitted and 202'd.
- The failing session's entry: `commits: []`, `files: []`,
  `summary: "[fake-summary] No repo changes recorded for this session."`, `fragmentPath: null`.
- Spool empty, no async-ingest error in hull output — nothing crashed; the snapshot simply
  raced the test's commit. Which session loses (A or B) varies run to run.

Production impact is small (a real session's first commit lands minutes, not milliseconds,
after SessionStart; worst case is delta under-attribution in the first ~300 ms), but the
CI-able acceptance proof the spec line rests on does not reliably demonstrate the line.

**Suggested fix (either side suffices; both are small):**
- Product side (preferred): in the events route, process `SessionStart`/`Stop` synchronously
  *before* `reply.send(202)` — they are cheap (<300 ms, inside the emitter's 700 ms budget);
  keep only `SessionEnd`'s capture async. Preserves the "never block the hook" property where
  it matters.
- Test side: after emitting SessionStart, wait until the session row exists (or a fixed beat)
  before committing in the scratch repo.

## Checklist pass (plan + spec §9.1/§4 vs diff `ship-wave1...HEAD`)

- All plan §1 deliverables present: `plugins/crew` (plugin.json, hooks.json exec-form with
  `${CLAUDE_PLUGIN_ROOT}` args, emit.mjs, agents/skills seam stubs, README),
  `packages/ship-log` (db/capture/git-delta/transcript/fragments/spool/summarize/rollup/
  ingest/station/cli — 1,689 src lines), serve.ts mount (2-line), suite-conventions
  `hookEventEnvelopeSchema` additive (+34/+2), `plugins/.claude-plugin/marketplace.json`,
  mission changelog fragment, dogfood fragment `changelog/entries/2026-07-06--ship-wave1-bridge1--16bbcd68.md`.
- **All 7 logged deviations verified visible in plan §0 and matching the code:** 700 ms budget
  (emit.mjs:35), argv prompt + `MAX_TRANSCRIPT_CHARS_IN_PROMPT=4000` (summarize.ts:83),
  `resolveClaudeBinary` (summarize.ts:55), marketplace.json, `onlyBuiltDependencies` in
  pnpm-workspace.yaml, boolean `spoolPending` (station.ts:124), hardened prompts
  (summarize.ts:91-93, 109-113). None silent.
- No missing spec items; out-of-scope items correctly absent (no PermissionRequest blocking
  flow, no Deck tab, no `ship log` hull subcommand).
- `team-tasks/` untouched by every commit (`git log ship-wave1..HEAD -- team-tasks/` → empty).
  Working-tree team-tasks changes are the Captain's own, uncommitted.

## Spot-checks (dispatch's named risks)

1. **emit.mjs fail-open (highest blast radius): VERIFIED SOUND.** Every branch exits 0:
   SHIP_LOG_SUMMARIZER loop-guard (line 79), unparsable stdin (91), fetch failure/timeout →
   spool (119→125), spool-append failure → stderr only (128), top-level catch → exit 0 (135).
   700 ms `AbortSignal.timeout`; spool-first on any non-ok. Duplicate delivery after a client
   timeout is safe: SessionStart upsert + `captured` flag make re-ingest idempotent
   (capture.ts:117). Child-process tests assert exit-0 in all 5 cases (test/emit-hook.test.ts).
2. **resolveClaudeBinary: ACCEPTABLE.** No shell anywhere (`spawnSync` argv arrays); prompt is
   a single argv entry — no command injection. The PATH walk executes a `claude.exe` found on
   PATH, which is the same trust boundary as PATH itself; `SHIP_LOG_CLAUDE_PATH` override
   documented; non-win32 returns `'claude'`. 4 unit tests cover it.
3. **Machine state: MATCHES DECISIONS-NEEDED #3.** Committed `.claude/settings.json` is exactly
   `{"enabledPlugins": {"ship-crew@sharework": true}}` (commit 69795dc); fragment-commit
   default matches the parked decision; the user-settings marketplace entry and the real
   `~/.ship/log.db` contents are disclosed in the TL report with reversal noted (ordinary
   `claude plugin` commands). Live two-session proof NOT re-run (per dispatch); TL transcript
   evidence is internally consistent (fallback-then-haiku history in the real db corroborates
   the resolveClaudeBinary story).

## Non-blocking observations (for the fix pass, not the verdict)

- `runGit` (git-delta.ts:14) swallows all git failures into empty results — fine for tolerance,
  but a debug-level stderr note would have made this flake diagnosable from the hull log.
- The acceptance script collects hull stdout in `state.output` but never prints it on failure —
  same diagnosability gap.
- Scratch artifacts from my review live under `%TEMP%\bridge1-review\` (debug copies only;
  nothing in the repo touched beyond this report).

---

# RE-REVIEW (2026-07-06, scoped to remediation commits 4341dfd + 5cda378)

## VERDICT: PASS (whole package)

## Fix diff read skeptically (`git show 4341dfd`)

- `station.ts` events route: SessionStart/Stop (and unknown-event sidecar) now ingested
  synchronously BEFORE the reply (`202 { queued: false }`); only SessionEnd's slow capture
  stays async (`202 { queued: true }`). Directly kills the diagnosed race (head_start snapshot
  now committed before the emitter can exit).
- Sync-path failure returns 500, not a lying 202 — verified `emit.mjs:117` (`delivered =
  res.ok`) treats non-2xx as undelivered and spools. Correct.
- "ON CONFLICT preserves original head_start": pre-existing in `db.ts:145-147` (DO UPDATE
  touches only cwd + COALESCE'd transcript_path) — so a 700ms emitter timeout + later spool
  re-delivery cannot clobber the first, correct snapshot. Claim verified, not just trusted.
- New sync-contract test asserts the session row exists when the 202 lands (no polling);
  old async test retargeted at SessionEnd. Test encodes the fixed contract, not the bug.
- Budget argument sound: sync cost is 1-3 `git rev-parse` spawns (no tree scan), well under
  the emitter's 700ms; overrun degrades to spool-and-redeliver, not loss.

## Executed

- `node packages/ship-log/acceptance/two-repo-log.mjs` x3 plain runs: **3/3 all assertions
  passed** (pre-fix failure rate was ~1-in-3; 3 green runs is meaningful).
- `pnpm --filter ship-log test`: **76/76 green** (was 75; +1 sync-contract test as claimed).

## Residual notes (non-blocking)

- Deviation 8 logged visibly in the plan (5cda378) — no silent deviation.
- My earlier non-blocking observations (runGit silent-swallow, acceptance script not dumping
  hull output on failure) remain open; diagnosability nits only.
