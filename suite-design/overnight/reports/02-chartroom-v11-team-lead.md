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
