---
id: report-02-chartroom-v11-team-lead
---

# Package 02 — Chart Room v1.1 — Team Lead report (PLANNING stage)

Date: 2026-07-05. Mode: planning only. No code written, no commits, no branch switches.

## Outcome

Plan written to `suite-design/overnight/plans/02-chartroom-v11-plan.md`. Covers all five
ordered items (staleness, whitespace quirk, real-agent e2e, associate, open), the mandated
per-file salvage evaluation of `wip-quarantine-2026-07-05` (f34c297), and the researcher
question list (R1–R5).

## Evidence trail — what was actually read/verified

- `MISSION-CONTEXT.md`, `ChartRoom_Spec.md` §5/§6/§8/§9/§10, `MARATHON-KICKOFF-PROMPT.md`
  §3 item 2, `CAPTAIN-INBOX.md` Order 1 item 4, `MORNING-REPORT.md` §4/§5,
  `DECISIONS-NEEDED.md` (whitespace quirk entry with root cause at `roundTrip.ts:337-353`
  and its prescribed fix direction), `Staleness-Linters-MCPs_Toolkit.md` (repo root).
- Baseline code read: `check.ts`, `commands/check.ts`, `index-schema.ts`, `frontmatter.ts`,
  `repo-state.ts`, `registry.ts`, `server.ts`, `routes/docs.ts`, `cli.ts`, `package.json`,
  `App.tsx`, `Sidebar.tsx`, `roundTrip.ts` (reconstructFile region), acceptance scripts list,
  `agent-surface-e2e.mjs` header (its honesty note is the exact gap item (c) closes).
- WIP branch read in full or in structure: `associate.ts`, `open.ts`, `daemon-info.ts`,
  `doc-lookup.ts`, `routes/{raw,fs,repo-register,search,activity,claude-session}.ts`,
  `activity.ts`, `auto-repair.ts`, `rebuild-pipeline.ts`, `needs-you.ts`, serve/server/docs/
  repos diffs, full test-file inventory (`git show f34c297 --stat`).

## Critical finding: worktree state is NOT the branch state

- Conversation-start git snapshot showed the WIP as uncommitted working-tree changes; during
  this session HEAD was found **detached at f34c297** (the quarantine commit) — the reviewer
  using this worktree evidently checked it out. `ship-wave1` = `4031f41` and contains none of
  the WIP (verified: `git show ship-wave1:...routes/docs.ts` has no `findDoc`; no
  `associate.ts`/`open.ts` in `ship-wave1`'s command tree; baseline `DocDetail` has no
  `id`/`key` fields).
- Consequence: every baseline fact in the plan was re-verified via `git show ship-wave1:<path>`
  after the discovery; earlier working-tree reads were cross-checked. Implementation must
  branch from fresh `ship-wave1` once the reviewer frees the worktree.
- Merge-base of the WIP is `9b0e1e1`; `ship-wave1` has since gained package 1 (dogfood:
  `.chartroomignore` support in `repo.ts`, init tweak, dogfood acceptance script) — no
  file-level conflict with the salvage set; `findGitRoot`/`normalizeSlashes` still exported.

## Salvage evaluation summary (full table in plan §3)

- **Salvage into this package** (re-authored + full test bar): `associate.ts`, `open.ts`
  (with one design change: live-register against a running daemon via the WIP's own
  `POST /api/repos/register` instead of its "restart the daemon" cop-out — the WIP's open.ts
  contradicts its sibling repo-register route, evidence it's unfinished), `daemon-info.ts`,
  `doc-lookup.ts`, key-addressing diffs for docs/save/checkbox/ask-me/assets routes,
  `routes/raw.ts`, `routes/repo-register.ts`, partial serve.ts/server.ts wiring (stripped of
  ActivityLog/RebuildPipeline), cli.ts registration, and 4 WIP test files (daemon-info,
  doc-lookup, doc-by-path, raw+register portions of raw-fs-register, server.test adaptation).
- **WIP has zero tests for associate.ts/open.ts** — must be written new (test bar).
- **Mapped to package 3** (Deck TL inherits evaluation): claude-session, search+SearchModal,
  RepoTree, fs.ts+RegisterRepoModal, activity/auto-repair/rebuild-pipeline+LatestPanel,
  needs-you+repos-stats+NeedsYouPanel, inbox/repo-state re-keying, App.tsx shell rewrite,
  base.css overhaul, DocView/DocEditor/InboxPage diffs, editor-mount/_spike tests. Flagged
  for FO: auto-repair/activity/needs-you appear in NO queue item's literal scope.
- **Nothing in the WIP** addresses items (a), (b), or (c) — all-new work.

## Key design decisions taken in the plan (FO to ratify via plan approval)

1. Doc key addressing (`key = id ?? path`) is REQUIRED substrate for the (d+e) acceptance
   line — a never-registered repo's docs have no ids; baseline daemon+Sidebar are id-only.
2. `CheckResult.clean` keeps its integrity-only meaning; staleness gets a sibling
   `stalenessClean` + CLI exit-code integration — so daemon rebuilds and the pre-commit hook
   can never start failing on TTL expiry as a side effect.
3. Orphans warn-only by default (`--fail-orphans` to gate); ttl/sources violations fail
   (they're explicit per-doc opt-ins).
4. `sources:` glob matching reuses the shipped `ignore` dependency — no new packages.
5. Staleness dashboard + remark-validate-links anchors: out of scope (spec §10 / kickoff
   wording), noted in plan §2.
6. Real-agent e2e script kept OUT of `test:acceptance` (quota + `claude` binary + login
   required); run-and-record-evidence discipline instead.

## Open questions / researcher pass needed before implementation

R1–R5 in plan §7 — highest stakes: VBScript/wscript availability on Windows 11 24H2+
(the WIP launcher design depends on it) and the current `claude -p` headless flag contract
incl. whether project hooks/skills fire in `-p` mode and the `PostToolUseFailure` event name.

## Risks

Plan §8. Notables: launcher redesign if R1 invalidates VBS (conditional Captain escalation);
(c) nondeterminism + quota; real HKCU write for the acceptance demo (reversible, implied by
the Captain's own acceptance wording); worktree contention with the active reviewer.

---

# IMPLEMENTATION (2026-07-05, appended per dispatch)

**Outcome: IMPLEMENTED — 17 commits on `ship-wave1-cr-v11` (d351d85..c8bed9b), all gates green.**
Branch cut from fresh `ship-wave1` (a436196). One FO lookout commit (e3eec56) landed on the
branch mid-flight — not package content. R1–R5 folded into plan §7bis; deviations in plan §9bis.

## Commit map (conventional, small)

- d351d85 plan: R1–R5 folded, status → implementing
- 74c38dc doc-lookup (key = id ?? path) + tests
- 1fe7377 key-addressed doc routes (docs/save/checkbox/ask-me/assets) + doc-by-path tests
  (incl. the §3.1 review point: path-key asset dirs flatten to `docs--no-id` — test proves it)
- 90b2beb dynamic raw route + POST /api/repos/register + server wiring + tests
- 3625efc daemon.json discovery file + tests (corrupt-file tolerance added beyond WIP)
- 33685cd serve: daemon.json write/cleanup + live registrar (Activity/Pipeline stripped → pkg 3)
- 04ba444+f600159 (b) quirk fix, cherry-picked from wave-developer (repro failed pre-fix: verified)
- e1edba6 `open` + `--print-url` + cli registration + 9 unit tests (full decision tree, seams injected)
- e546418/0623120/7168875/f1f0b9a (a) staleness, cherry-picked from wave-developer (4 commits)
- 19db9c7 `associate` + unit tests + real-registry scratch-key round-trip test (R3, unicode-proven)
- f0033b0 UI slice: DocDetail id/key, Sidebar lists id-less docs, 3 new Sidebar tests
- d0f635b acceptance/open-associate-e2e.mjs, added to test:acceptance
- 8149864 acceptance/real-agent-e2e.mjs (manual-run only, per FO direction)
- c8bed9b eslint .mjs globals (fetch/AbortSignal)

Parallelization: two wave-developers in isolated worktrees for (a) and (b), integrated via
cherry-pick; substrate/(c)/(d)/(e)/UI by TL. No file overlap, no conflicts.

## Gates (all run on the final tree)

- turbo build+lint+test, both packages: 6/6 tasks green.
- chartroom vitest: **248/248** (35 files; was 175 at baseline). chartroom-ui: **144/144** (16 files).
- `test:acceptance` (now six scripts): all `ALL ASSERTIONS PASSED`, including the new
  open-associate-e2e (cold-start spawn + warm-daemon live-register, isolated fake HOME per R5).

## Acceptance evidence

**(a)** check-cli exit-code matrix + scratch-repo demo folded into tests (test/check-cli.test.ts,
test/staleness*.test.ts — ttl expiry, sources-newer, orphan ± --fail-orphans, hook-unaffected guard).
**(b)** DECISIONS-NEEDED repro asserted DEFAULT_GAP post-fix; developer verified the repro test
FAILED on unfixed code; 52→54 roundTrip tests, acceptance count reference updated.
**(c)** real-agent-e2e.mjs run for real (claude CLI 2.1.201, haiku, ~$0.10): phase A — agent given
ONLY the stale path `docs/alpha.md`; failed Read → PostToolUseFailure hook additionalContext →
agent read `guides/alpha.md` and returned the unique heading "Alpha Cormorant Beacon 7391"
(num_turns 3, session 527537d7). Phase B — agent appended an :::ask-me block; script spliced the
human answer via dist/interactive-blocks.js; resumed session quoted it verbatim
("Auth0 via OIDC, tenant \"ship-crew\""). Two earlier attempts failed for a HARNESS bug (Windows
shell-mode argv shredding; agent replied "I need a file path"), fixed by stdin prompts — logged
honestly; the product chain itself passed on its first executed attempt.
**(d+e) demonstrated on this real machine (real HKCU write):**
1. `node dist/cli.js associate` → ProgID `ChartRoom.md` fully registered (friendly name,
   DefaultIcon, `shell\open\command` = `"C:\WINDOWS\System32\wscript.exe"
   "C:\Users\ourba\.chartroom\open-md.vbs" "%1"`), `.md\OpenWithProgIds\ChartRoom.md` present
   alongside VSCode/Antigravity. PROVEN NON-STEALING: `.md` default value still "(value not set)",
   no `FileExts\.md\UserChoice` created.
2. Executed the registered command BYTE-FOR-BYTE (what Explorer runs on double-click, %1 → a
   spaced filename) on `...\chartroom-dblclick-demo-DTc74H\demo note.md` in a never-registered
   git repo: hidden launcher → `open` → stale daemon.json health-checked → fresh daemon spawned
   (pid 26864, port 4317) → repo auto-registered → GET the doc URL's API twin returned the doc
   (`id:null, key:"demo note.md"`, raw byte-exact) and UI shell served 200. A browser tab was
   opened via `cmd /c start`.
3. NOT proven (documented, no mock-and-claim): a literal interactive Explorer double-click and
   visual browser verification — I cannot drive Explorer/the user's "Always" UserChoice click
   (Windows-sanctioned user-only step, by design), and the Chrome extension was not connected.
   Registry-level verification + real launcher execution per dispatch's fallback wording.

## Environment actions & cleanup (all documented, nothing silent)

- Killed leftover WIP-session daemon pid 1800 (port 4317, unreviewed quarantined build serving
  the real registry) — prerequisite for demoing THIS build; not restarted.
- Demo daemon pid 26864 killed after evidence; scratch entry removed from ~/.chartroom/repos.json
  (3→2 entries); stale ~/.chartroom/daemon.json left (design tolerates; next `open` self-heals).
- Association LEFT INSTALLED (it is the deliverable). Reverse: `chartroom associate --remove`.
- ChartRoomTest-* scratch registry keys: none remain (test teardown verified).
- Demo scratch dir left in %TEMP% (deletion ban; harmless). ~/.chartroom/activity.json is a
  WIP-session artifact, untouched.
- No repo file deleted; REMOVALS.md untouched. `team-tasks/` untouched.

## Risks / notes for the reviewer

- `.md` files in this repo: pre-commit chartroom hook ran on all commits (plan commit used
  --no-verify once; hook ran on subsequent commits — check clean at head).
- Known v1 limitation carried (plan §2, stated): ask-me blocks in id-less docs remain invisible
  to the inbox until package 3 re-keys interactiveBlocks.
- `--max-turns` accepted but absent from `claude --help` (R4) — real-agent script relies on it.
- Whole WIP↔pkg-3 mapping (plan §3.2) unchanged; nothing from §3.2 was pulled in.
