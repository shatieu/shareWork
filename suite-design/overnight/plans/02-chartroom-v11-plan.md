---
id: plan-02-chartroom-v11
---

# Package 02 — Chart Room v1.1 — Implementation Plan

- **Status:** APPROVED (FO, STATUS.md 17:05) — IMPLEMENTING. R1–R5 verdicts folded in (§7bis).
- **Feature branch:** `ship-wave1-cr-v11`, cut fresh from `ship-wave1` (currently `4031f41`)
- **Spec:** `suite-design/ChartRoom_Spec.md` §6 (staleness), §5 (check contract), §9 (DoD);
  `suite-design/MARATHON-KICKOFF-PROMPT.md` §3 item 2; CAPTAIN-INBOX Order 1 item 4.
  Morning-report decision §4.1 (staleness) resolved YES by kickoff.
- **Difficulty estimate:** L. Honest remaining guess: ~7–9 h implementation + review.
- **Worktree caution:** this worktree's HEAD is currently detached at `f34c297` (the WIP
  quarantine commit) — a reviewer is using it. `ship-wave1` itself is `4031f41` and contains
  NONE of the WIP. All baseline facts below were verified against `git show ship-wave1:<path>`,
  not the working tree. Implementation must begin by confirming the worktree is free and
  branching from fresh `ship-wave1`.

## 1. Scope — five items

- **(a) Staleness rules** in `chartroom check`: frontmatter `ttl_days` + `sources:` freshness
  gates, orphan detection (no inbound links). CLI output, `--json`, CI exit codes.
- **(b) Phase-3 whitespace-gap quirk fix** in the round-trip engine (`chartroom-ui`
  `src/editor/roundTrip.ts`): the "denser second alignment" pass can leak an original gap's
  spacing onto a new block adjacency when a reorder is combined with non-default blank-line
  spacing (DECISIONS-NEEDED "Package 3 … whitespace-only defect", root-caused at
  `roundTrip.ts:337-353`).
- **(c) Real-agent end-to-end proof:** headless `claude -p` in a SCRATCH Chart-Room-enabled
  repo (never this repo): agent resolves a moved doc via hook/skill; ask-me answers flow
  end-to-end. Closes spec §9's last unproven DoD line.
- **(d) `chartroom associate`:** one-time per-user (HKCU, no admin) Windows registration of a
  "Chart Room Markdown" `.md` handler via a hidden launcher; right-click .md → Open with →
  Chart Room → "Always". Opening finds-or-starts the daemon, auto-registers the file's repo
  if new, deep-links to the doc.
- **(e) `chartroom open <file>`:** same behavior from the terminal.
- **Acceptance line (d+e):** double-click a `.md` in Explorer in a never-registered repo →
  browser lands on that doc.

### Enabling substrate (required by d+e, salvaged from WIP — see §3)

The acceptance scenario is a *never-registered* repo, whose docs have **no `id:` frontmatter**.
The baseline daemon addresses docs **by id only** (`GET /api/repos/:repoId/docs/:docId` reads
`state.index.docs[docId]`; baseline `Sidebar.tsx` filters id-less docs out of the list). So
(d)/(e) force three substrate changes, all present in the WIP in reviewable form:

1. **Doc key addressing** (`key = id ?? path`) in the daemon routes + minimal UI acceptance
   of `id: null` docs.
2. **Daemon discovery file** `~/.chartroom/daemon.json` (find-or-start).
3. **Live repo registration** (`POST /api/repos/register`) + a dynamic raw-asset route
   (fastify cannot add routes/static mounts after `.listen()`), so `open` works even when a
   daemon is *already running* — otherwise the acceptance line only holds when no daemon runs.

## 2. Out of scope

- Staleness **viewer dashboard** (spec §10 explicitly defers it; kickoff item (a) says "in
  `chartroom check`"). The data flows into `RepoState.check` for free; UI surfacing is not built.
- `remark-validate-links` anchor checking (spec §6 mentions it; kickoff item (a) does not —
  and it would be a new dependency; parked as a future note, not built).
- The whole Deck/wave-2 UI overhaul in the WIP (App shell, RepoTree, SearchModal, activity
  feed, auto-repair pipeline, claude-session, fs folder picker) — package 3 (see §3 mapping).
- Re-keying `RepoState.interactiveBlocks` by path key (WIP `repo-state.ts` diff): entangled
  with needs-you/inbox counts → package 3. Consequence, stated honestly: ask-me blocks in
  **id-less** docs stay invisible to the inbox in v1.1 (unchanged from v1; the (c) proof uses
  id-carrying docs, so no dependency).
- macOS/Linux `associate` (Windows-only per Captain's order; `open` itself is cross-platform).
- Any new dependency. (`sources:` glob matching reuses the already-shipped `ignore` package.)

## 3. WIP branch `wip-quarantine-2026-07-05` (f34c297) — per-file salvage verdicts

Context: one monolithic `wip` commit (57 files, +7525/−788), unattributed, unreviewed, written
against merge-base `9b0e1e1` (before package 1's `.chartroomignore` work). Cherry-picking is
impossible per-file; **salvage = re-author the file/diff onto `ship-wave1-cr-v11`, read every
line, and hold it to the full new-code test bar.** Notably, the WIP ships tests for its daemon
substrate but **no tests at all for `associate.ts`/`open.ts`** — those must be written new.

### 3.1 SALVAGE into this package (adapt + full test bar)

| WIP file | Verdict / adaptation |
|---|---|
| `chartroom/src/commands/associate.ts` | Salvage. Sound design: HKCU ProgID + `.md\OpenWithProgIds` (offers, never steals the default), VBS hidden launcher, `--remove`. Adapt: injectable `reg`/fs seams for tests; launcher mechanism conditional on researcher fact R1 (VBScript deprecation). **Write the missing unit tests.** |
| `chartroom/src/commands/open.ts` | Salvage with one real design change: WIP punts with "restart your daemon" when the repo was just registered while a daemon runs — contradicting its own sibling `repo-register.ts` route. Adapt: when a healthy daemon doesn't know the repo, `POST /api/repos/register`; keep the restart message only as fallback for register-endpoint failure. Add `--print-url` (no browser) for scripts. **Write the missing unit tests** (`findOwningRepo`, `computeDocKey`, URL/registration flow). |
| `chartroom/src/daemon/daemon-info.ts` + `test/daemon/daemon-info.test.ts` | Salvage as-is (homeDir-injectable, stale-file-tolerant; test included). |
| `chartroom/src/daemon/doc-lookup.ts` + `test/daemon/doc-lookup.test.ts` | Salvage as-is. Deliberate no-fuzzy lookup (id → exact path → 404) is correct for machine-generated route params. |
| `routes/docs.ts` key-addressing diff + `test/daemon/doc-by-path.test.ts` | Salvage. Adds `id`/`key` to `DocDetailResponse`, resolves `:docId` via `findDoc`. |
| `routes/doc-save.ts` / `doc-checkbox.ts` / `doc-ask-me.ts` / `doc-assets.ts` diffs | Salvage — mechanical `findDoc` swaps so id-less docs are editable, not just viewable. **Review point:** `doc-assets.ts` derives the per-doc asset dir from the key; verify its encoding is filesystem-safe for path keys (`docs/foo.md` contains `/`); write a test proving it. |
| `routes/raw.ts` + raw-route portion of `test/daemon/raw-fs-register.test.ts` | Salvage. Dynamic raw serving over the live runtimes array (replaces per-repo `@fastify/static` mounts; UI mount stays static). Keeps the traversal 403 guard — test it. |
| `routes/repo-register.ts` + register portion of that test | Salvage. Injected-registrar seam is good. |
| `src/daemon/server.ts` diff | **Partial** salvage: `buildServer(runtimes, { uiDistDir, registrar })` + raw route + repo-register wiring only. Do NOT bring activity/search/claude-session/fs wiring (package 3). |
| `src/commands/serve.ts` diff | **Partial** salvage: write `daemon.json` after `.listen()`, best-effort delete on SIGINT/SIGTERM, and the live `registrar` (register → rebuild → push runtime → start watcher). Strip every `ActivityLog`/`RebuildPipeline` reference (package 3): `pipeline.process(identity, rebuild(...))` → `rebuild(...)`. |
| `src/cli.ts` (+4) | Trivially re-authored (register `associate` + `open`). |
| `test/daemon/server.test.ts` (4-line) | Salvage (static-mount expectation → raw-route expectation). |
| `chartroom-ui/src/api/client.ts` — `DocDetail.id`/`key` additive fields only | Salvage that fragment; search/activity/register/fs client functions → package 3. |

### 3.2 Map to PACKAGE 3 (Captain's Deck) — its TL inherits the evaluation

`routes/claude-session.ts` + test (explicit Deck order); `routes/search.ts` + test +
`SearchModal.tsx`; `RepoTree.tsx` (replaces Sidebar/RepoSwitcher); `routes/fs.ts` + fs portion
of `raw-fs-register.test.ts` + `RegisterRepoModal.tsx` (folder-picker); `activity.ts` +
`routes/activity.ts` + `auto-repair.ts` + `rebuild-pipeline.ts` + their 3 test files +
`LatestPanel.tsx`; `needs-you.ts` + `routes/repos.ts` stats diff + `repos-stats.test.ts` +
`NeedsYouPanel.tsx`; `routes/inbox.ts` + `repo-state.ts` diffs (key-keyed interactive blocks);
`App.tsx` rewrite, `index.html`, `styles/base.css` (+2838), `DocView.tsx`/`DocEditor.tsx`/
`InboxPage.tsx` diffs + their test diffs, `FrontmatterPanel.tsx`, `RefTag.tsx`,
`test/editor/editor-mount.test.tsx`, `test/editor/_spike.test.ts`.
**FO note:** auto-repair/activity/needs-you are in NO queue item's literal scope — package 3's
TL should treat them as candidate salvage only where its charter covers them, else park.

### 3.3 IGNORE (both packages)

Nothing in the WIP touches staleness (a), the whitespace quirk (b), or the real-agent proof
(c) — those are all-new work. `test/editor/_spike.test.ts` looks like a leftover dev spike;
package 3 TL decides, default ignore.

## 4. File-level design

### 4.A Staleness rules (`chartroom check`) — new work

Frontmatter contract (opt-in per doc):
```yaml
ttl_days: 90          # doc is stale when its own last change is older than this
sources:              # doc is stale when any matching file changed after the doc did
  - src/auth/**
  - package.json
```

- **`src/index-schema.ts`:** `DocEntry` gains optional
  `staleness?: { ttlDays?: number; sources?: string[] }`. Additive/optional → schema stays
  version 1 (readers already tolerate absent fields). Captured for identified AND
  unidentified docs.
- **`src/indexer.ts`:** while parsing frontmatter (already happens for `id`), lift
  `ttl_days` (positive finite number) and `sources` (non-empty string array); ignore
  malformed values silently (consistent with existing frontmatter tolerance).
- **NEW `src/staleness.ts`** (pure, injectable clock + git seam for tests):
  - `lastChangeEpoch(repoRoot, relPath)`: `git log -1 --format=%ct -- <path>`
    (`execFileSync` pattern per `hook.ts`); fallback to fs mtime for untracked files /
    git failure. Documented v1 limitation: uncommitted edits to a *tracked* file don't move
    its git timestamp — mtime fallback applies only when git has no commit for the path.
  - `matchSources(repoRoot, globs)`: `git ls-files -z` + the already-shipped `ignore`
    package as the gitignore-syntax matcher (no new dependency).
  - `runStalenessCheck(repoRoot, index, nowEpoch)` →
    `{ ttlExpired: [{id|null, path, ttlDays, ageDays}], staleAgainstSources: [{id|null, path, newerSources: string[]}], orphans: [{id, path}] }`.
  - **Orphans** = identified docs with zero inbound id-links, via the existing
    `daemon/backlinks.ts::computeBacklinks` (pure over the index — reuse, don't rewrite).
    Unidentified docs are excluded by construction (they cannot receive id-links; listing
    them all would be noise, not signal).
- **`src/check.ts::runCheck`:** additive `staleness` field on `CheckResult`.
  **`clean` keeps its exact current meaning (link/id integrity only)** — new sibling
  `stalenessClean`. Rationale: `runCheck` also runs on every daemon rebuild and any future
  hook path; a TTL expiry must never start blocking commits or flipping unrelated consumers.
  Guard test: pre-commit hook behavior byte-identical around stale docs (verify at impl that
  `hook.ts` doesn't consume `clean`; current reading says it doesn't).
- **`src/commands/check.ts`:** human output gains three sections; `--json` gains the
  `staleness` block; exit code 1 when integrity is dirty OR `ttlExpired`/`staleAgainstSources`
  non-empty; **orphans are warn-only by default**, gated by new `--fail-orphans` flag
  (design call, logged here: ttl/sources are explicit per-doc opt-ins = intent; orphanhood is
  a heuristic that would instantly fail most real repos).
- **Perf bound:** git subprocesses only when at least one doc opts in (per opted-in doc:
  1 `git log`; plus 1 `git ls-files` per check when any `sources:` present). Zero opt-ins →
  zero subprocesses → daemon rebuild cost unchanged.

### 4.B Whitespace-gap quirk fix — `chartroom-ui/src/editor/roundTrip.ts`

Root cause (verified in code at lines ~326–355): `impliedOrigIdxForCurrent` is seeded from
`matchedForCurrent` (which includes `matchReorderedBlocks` pairs), then the positional
equal-length-region fill **overwrites** those entries, so a reordered block masquerades as
positionally continuous with its new neighbor and inherits an original gap that no longer
applies. Fix per DECISIONS-NEEDED's own prescription: make the fill reorder-aware —
`if (!impliedOrigIdxForCurrent.has(prevCurEnd + k))` (equivalently: skip indices claimed by a
reorder pairing; never overwrite an existing implied index). Bounded, same shape as the
prior hardening fix. Tests:
1. exact DECISIONS-NEEDED repro (heading → A → 3 blank lines → B, A/B swapped with unrelated
   blocks between) → new heading→B gap is `DEFAULT_GAP`, not the leaked 3-blank gap;
2. no-reorder unusual-spacing case still preserves original gaps (no over-skip regression);
3. full existing suite (52/52 `roundTrip.test.ts`, 144 package total) stays green;
   update `acceptance/editor-round-trip.mjs`'s count reference if the count grows.

### 4.C Real-agent end-to-end proof — NEW `chartroom/acceptance/real-agent-e2e.mjs`

Deliberately **not** added to `test:acceptance` (requires the `claude` binary + login, burns
quota, nondeterministic) — run by TL/FO, full transcript captured as report evidence.
Scratch repo via `mkdtempSync` (never this repo), then:
1. `git init`; 2–3 id-carrying docs with id-links; `chartroom init` + `index`;
   `install-skill` → `<scratch>/.claude/skills/`; `install-agent-hook` →
   `<scratch>/.claude/settings.json`; CLAUDE.md template line.
2. `git mv docs/alpha.md guides/alpha.md` + `chartroom index` (index current; the *agent's*
   Read of the stale path is what must self-correct via hook/skill — we never tell it the
   new path).
3. **Phase A (moved-doc resolution):** `claude -p "Read docs/alpha.md and report its exact
   first heading" --output-format json` (+ permission/turn flags per researcher R4), cwd =
   scratch. Assert the result contains the heading that only exists in the moved file;
   capture the transcript proving the failed Read → hook guidance → resolution chain.
4. **Phase B (answers flow):** prompt the agent to post an `:::ask-me` question in a doc;
   script simulates the human answer (reuse `ask-me-round-trip.mjs` helpers / daemon PATCH);
   resume the session (`--resume <session_id>` from phase A's JSON, per R4) asking it to
   read the answer back; assert it states the planted answer.
5. Flake policy: one retry, both attempts logged honestly; scratch dir preserved on failure.

### 4.D `chartroom associate` — salvaged + hardened

As WIP (§3.1) with: (i) injectable `reg` runner + homeDir for tests — unit tests assert exact
`reg.exe` arg vectors and VBS content (quote-doubling, `%1` handling) without touching the
real registry; (ii) launcher mechanism finalized after researcher R1/R2/R3; (iii) win32 guard
+ `--remove` kept. Registry writes stay: ProgID `ChartRoom.md` under `HKCU\Software\Classes`,
`shell\open\command` = `wscript.exe "<home>\.chartroom\open-md.vbs" "%1"`,
`.md\OpenWithProgIds` value (offer-only — never steals the current default; the user's own
"Always" click sets UserChoice, which is also the only Windows-sanctioned way).

### 4.E `chartroom open <file>` + daemon substrate — salvaged per §3.1

Flow: resolve file → `findOwningRepo` (longest-prefix, case-insensitive on win32) →
if unknown: `findGitRoot` + register (against a live daemon: `POST /api/repos/register`;
otherwise registry file) → find-or-start daemon (`daemon.json` + health poll, spawn detached
`serve`, ≤10 s) → URL `#/repo/<id>/doc/<encoded key>` → OS browser (win32 `cmd /c start ""`).
UI minimal slice (this package, NOT the WIP shell): `DocDetail` gains optional `id`/`key`;
baseline `Sidebar.tsx` lists id-less docs too (`key = doc.id ?? doc.path`); verify
`DocView`/save path tolerate `id: null`. Existing hash routing already deep-links.

## 5. Test plan (all vitest unless noted)

- `chartroom/test/staleness.test.ts`: ttl math (injected now + injected lastChange), sources
  matching incl. `**` globs, orphan detection, unidentified handling, malformed frontmatter.
- git-integration test with a real temp git repo (commits at controlled times) for
  `lastChangeEpoch` + mtime fallback.
- `check` CLI: exit-code matrix (clean / integrity-dirty / stale-only / orphan-only ±
  `--fail-orphans`), `--json` shape; hook-unaffected guard test.
- Salvaged daemon tests re-run as-is: `daemon-info`, `doc-lookup`, `doc-by-path`,
  raw+register portions of `raw-fs-register`, `server.test.ts` adaptation.
- New: `associate.test.ts` (arg vectors, VBS content, `--remove`, non-win32 no-op),
  `open.test.ts` (`findOwningRepo`, `computeDocKey`, live-register vs spawn decision tree —
  fetch/spawn injected), `doc-assets` path-key encoding test.
- `chartroom-ui`: roundTrip quirk tests (§4.B), Sidebar id-less doc rendering test.
- Suite-green bar: `tsc --noEmit`, `eslint .`, full vitest in both packages, all five
  existing acceptance scripts still pass.

## 6. Acceptance demonstration

- **(a)** scratch repo with an expired-ttl doc, a stale-against-sources doc, an orphan →
  `chartroom check` output + exit codes shown in report (folded into staleness tests too).
- **(b)** the DECISIONS-NEEDED repro, before (leaks 3-blank gap) vs after (DEFAULT_GAP).
- **(c)** `real-agent-e2e.mjs` run once for real; transcript in report.
- **(d+e)** NEW `acceptance/open-associate-e2e.mjs`: spawns CLI with overridden
  `USERPROFILE`/`HOME` (isolated `~/.chartroom`; confirm override per R5) — scenario 1: no
  daemon, never-registered repo, `open --print-url` → daemon.json appears, repo registered,
  GET on the printed doc URL's API twin returns the doc; scenario 2: daemon already running,
  second never-registered repo → live-registered, served without restart; teardown kills the
  spawned daemon by pid (process kill, not file deletion). Registry half is unit-tested only.
  **Literal acceptance line:** one real run on the Captain's Windows machine — `chartroom
  associate` (real HKCU write, reversible via `--remove`; doing this is implied by the
  Captain's own acceptance wording), then invoke the exact registered command
  (`wscript.exe <launcher> <file>` — byte-for-byte what Explorer executes) AND a real
  double-click; browser lands on the doc. Evidence + `--remove` instructions in the report.

## 7bis. Research verdicts folded in (2026-07-05, from `reports/02-chartroom-v11-researcher.md`) — binding on §§4.C/4.D/4.E/6

- **R1 — GO for the VBS launcher**, with two hardenings: (i) `associate` performs an
  install-time presence check (`%SystemRoot%\System32\wscript.exe` AND
  `System32\vbscript.dll` exist); (ii) if absent, fall back to a
  `powershell.exe -NoProfile -WindowStyle Hidden -Command …` launcher (documented degraded
  mode: brief console flash). `conhost --headless` rejected (undocumented). Launcher `.vbs`
  must be defensive (`On Error`) — wscript shows blocking GUI dialogs on script errors;
  tests exercise it via `cscript //nologo`.
- **R2 — design confirmed.** Write ONLY `HKCU\Software\Classes\ChartRoom.md` (ProgID must be
  fully registered: default value = friendly name + valid `shell\open\command`) and
  `HKCU\Software\Classes\.md\OpenWithProgIds\ChartRoom.md`. **Never write the `.md` default
  value** (if no UserChoice exists, that would silently steal the effective handler —
  violates offer-only). **Fire `SHChangeNotify(SHCNE_ASSOCCHANGED)` after registration**
  (via a one-shot `powershell -NoProfile` P/Invoke — no new dependency) or Explorer may not
  refresh until re-login. UserChoice/UserChoiceLatest hashes block only programmatic
  default-setting, which we never do.
- **R3 — quoting verified.** Registry writes via `spawnSync("reg.exe", [args])` — args
  array, **no `shell: true`**, never `cmd /c reg add`. Command value (JS literal):
  `"…\wscript.exe" "…\open-md.vbs" "%1"`; `%1` is inert outside batch context and expands
  at ShellExecute time. `WScript.Arguments(0)` arrives quote-stripped and byte-correct for
  spaces + unicode; the .vbs re-quotes when building the CLI invocation. **Added test
  obligation:** an integration test that writes a scratch key under
  `HKCU\Software\ChartRoomTest\…`, reads it back via `reg query`, and cleans up (key
  removal via `reg delete` on the scratch key is test teardown of a key the test created —
  not repo file deletion).
- **R4 — headless contract confirmed on CLI 2.1.201.** Hooks AND skills load and fire in
  `-p` (empirically: `PostToolUseFailure` fired on a failed Read — the event name stands).
  Script rules: never `--bare`/`--safe-mode` (skip hooks + break OAuth reuse); prefer
  minimal `--allowedTools` over `--dangerously-skip-permissions`; pass `--max-turns` and
  `--max-budget-usd`; `--output-format json` carries `result`+`session_id`; phase B resumes
  via `--resume <session_id>` **from the same cwd** (session lookup is cwd-scoped); do NOT
  pass `--no-session-persistence` in phase A; logged-in OAuth reused without env keys;
  settings JSON that fails validation is silently ignored in -p → the script should
  sanity-check its generated settings fire (e.g. assert the hook log exists).
- **R5 — confirmed.** `os.homedir()` honors `USERPROFILE` (win32) / `HOME` (POSIX); the
  acceptance script must set **both** in the child-process env at spawn.

## 7. Facts for a wave-researcher pass (do NOT trust memory — verify before implementation)

- **R1 (blocking for d):** Windows 11 23H2/24H2/25H2 — is `wscript.exe`/VBScript still
  present by default (deprecation → Feature-on-Demand timeline)? If plausibly absent on
  target machines, what is the least-bad no-console-window per-user launcher requiring no
  new shipped binary (candidates to evaluate: `conhost.exe --headless`, PowerShell
  `-WindowStyle Hidden` flash behavior, plain `node.exe` console flash)?
- **R2 (blocking for d):** confirm per-user `HKCU\Software\Classes` ProgID +
  `.md\OpenWithProgIds`: (i) appears in Win11 "Open with → Choose another app"; (ii) the
  user's "Always" sets UserChoice without admin; (iii) any UserChoice-hash caveat that would
  prevent the user selecting our handler as default (we never set the default
  programmatically).
- **R3:** correctness of `"%1"` quoting inside a `shell\open\command` value written via
  `reg.exe add /d` (spaces + unicode paths end-to-end through wscript to our CLI).
- **R4 (blocking for c):** current `claude -p` headless contract: (i) exact permission
  flags for non-interactive file-read/Bash in a scratch repo (`--dangerously-skip-permissions`
  vs `--permission-mode`/`--allowedTools`); (ii) `--output-format json` fields incl.
  `session_id`; (iii) resume syntax (`--resume <id> -p`); (iv) turn/cost caps; (v) do
  project-level `.claude/settings.json` hooks and `.claude/skills/` load AND fire in `-p`
  mode; (vi) is the failed-Read hook event still `PostToolUseFailure` (phase 5's verified
  correction — re-verify against current docs); (vii) env pitfalls spawning `claude` from
  inside a Claude Code session (nesting guards, `CLAUDECODE` env); (viii) auth reuse of the
  logged-in credentials in `-p` mode.
- **R5:** Node 20/22 `os.homedir()` — is `USERPROFILE` (win32) / `HOME` honored for
  subprocess isolation in the acceptance script?

## 8. Risks

1. **VBScript deprecation (R1)** may force a launcher redesign; contained — launcher
   generation is one function. If the only clean fallback is shipping a compiled helper exe,
   that becomes a Captain decision (would be parked in DECISIONS-NEEDED if triggered).
2. **(c) is inherently nondeterministic** (LLM judgment) and consumes quota — FO/Lookout
   should schedule its runs; script kept out of the default acceptance chain.
3. Real registry mutation during the (d) demo on the Captain's machine — per-user,
   reversible, and implied by the ordered acceptance line; documented with `--remove`.
4. `doc-assets` per-doc asset-dir naming for path keys needs a safe encoding — explicit
   review point with its own test (§3.1).
5. Static→dynamic raw-route swap could regress asset serving — mitigated by salvaged tests +
   the existing `two-repo-browse`/`editor-round-trip` acceptance scripts which exercise raw
   assets.
6. Reviewer currently holds this worktree at a detached HEAD — implementation start must
   coordinate with the FO (fresh branch off `ship-wave1`, worktree free).

## 9. Captain-only decisions

None parked now. Conditional: R1 fallback-launcher (see Risk 1) escalates only if research
invalidates the VBS design.

## 10. Implementation order (small conventional commits throughout)

1. Researcher pass (R1–R5) → fold verdicts into this plan (visible deviation log).
2. Substrate salvage: doc-lookup + key-addressed routes + tests → raw route + repo-register +
   server/serve wiring + daemon-info + tests.
3. `open` (+ tests, `--print-url`), then `associate` (+ tests, launcher per R1).
4. `open-associate-e2e.mjs`; real-machine association demo; evidence.
5. Staleness (a): schema/indexer → staleness.ts → check integration → tests.
6. Quirk fix (b) + tests.
7. Real-agent proof (c): script + one evidenced run.
8. UI minimal slice (client.ts fields, Sidebar id-less docs) + tests; full green bar;
   changelog fragment; report; hand to FO for independent review.
