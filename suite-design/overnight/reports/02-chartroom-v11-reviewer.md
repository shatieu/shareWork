---
id: report-02-chartroom-v11-reviewer
---

# Package 02 — Chart Room v1.1 — Reviewer report (LEAN review)

Date: 2026-07-05. Reviewer: independent, adversarial. Verdict: **PASS**.

Branch reviewed: `ship-wave1-cr-v11` @ `8520fda`, diffed against `ship-wave1` (`4031f41`).
Plan: `suite-design/overnight/plans/02-chartroom-v11-plan.md` (incl. §7bis, §9bis).
Spec: `suite-design/ChartRoom_Spec.md` §5/§6/§8/§9/§10.
Per dispatch: LEAN protocol; `real-agent-e2e.mjs` NOT rerun (quota) — TL transcript accepted after
verifying the script itself is genuine (see below).

## 1. What I executed (all on the branch head, this machine)

| Gate | Command | Result |
|---|---|---|
| Build + lint | `pnpm turbo build lint --filter=chartroom --filter=chartroom-ui` | 4/4 tasks green |
| chartroom tests | `pnpm test` in `packages/chartroom` | **248/248** (35 files) |
| chartroom-ui tests | `pnpm test` in `packages/chartroom-ui` | **144/144** (16 files) |
| Acceptance chain | `pnpm test:acceptance` (six scripts) | all `ALL ASSERTIONS PASSED` |
| `chartroom check` at repo head | `node dist/cli.js check` | exit 0 (orphan warns only, warn-only by design) |
| Real HKCU state (read-only `reg query`) | see §2 | offer-only confirmed |
| Real `associate --remove` → verify → reinstall | `node dist/cli.js associate --remove` / `associate` | full reversal + restore confirmed |

The six-script acceptance chain includes the new `open-associate-e2e.mjs`, which is the scripted
stand-in for the acceptance line: scenario 1 (cold start: no daemon, never-registered repo →
daemon spawned, `daemon.json` written, repo auto-registered, path-keyed doc served), scenario 1b
(id-addressed doc on the running daemon), scenario 2 (warm daemon live-registers a second brand-new
repo via `POST /api/repos/register`, no restart). All passed under an isolated fake HOME (R5).

## 2. Acceptance line verification (d+e)

**Line:** opening an `.md` in a never-registered repo finds-or-starts the daemon, auto-registers
the repo, lands on that doc; registry-level + scripted verification stands in for the interactive
double-click (documented user-only).

- Scripted flow: executed by me via `open-associate-e2e.mjs` (above) — cold-start AND warm-daemon
  paths both demonstrated for real, including the doc URL's API twin returning the path-keyed doc.
- Registry level, verified live on this machine (TL left the association installed — the deliverable):
  - `HKCU\Software\Classes\ChartRoom.md\shell\open\command` =
    `"C:\WINDOWS\System32\wscript.exe" "C:\Users\ourba\.chartroom\open-md.vbs" "%1"`
  - `.md\OpenWithProgIds` lists `ChartRoom.md` ALONGSIDE `VSCode.md`/`Antigravity.md`
  - `.md` key has **no default value** (query shows no `(Default)` entry) — nothing stolen
  - `FileExts\.md\UserChoice` **does not exist** — the default was never set programmatically
- Reversal, executed for real: `associate --remove` deleted the ProgID key, removed ONLY the
  ChartRoom value from `OpenWithProgIds` (VSCode/Antigravity untouched), deleted
  `~/.chartroom/open-md.vbs`. Then `associate` reinstalled cleanly (deliverable restored to the
  TL's left-installed state).
- The parked seam (a literal interactive Explorer double-click + the user's own "Always" click) is
  documented honestly in the TL report — it is user-only by Windows design, not mocked-and-claimed.
  The byte-for-byte launcher execution in the TL demo plus my scripted/registry verification covers
  the dispatch's fallback wording. PASSable seam.

## 3. Spot-checks (named risks)

**Risk 1 — offer-only association:** verified in code (`src/commands/associate.ts:138-148` writes
only the ProgID keys + an `OpenWithProgIds` *value*; the `.md` default value is explicitly never
written, comment cites R2), in the live registry (above), and by executing the remove/reinstall
cycle. `reg` invoked via `execFileSync('reg', args)` — args array, no shell (`associate.ts:79-81`).
Minor non-blocking: `removeAssociation` deletes only the ChartRoom value, so an
`OpenWithProgIds` key created *by* ChartRoom on a pristine machine would remain empty after
`--remove` — harmless (an empty key offers nothing), and on real machines the key pre-exists.

**Risk 2 — `open` find-or-start security:** `src/commands/open.ts` — every child process uses
arg-array spawn, never `shell: true` (`realSpawnDaemon:70-72`, `realOpenBrowser:76-84`); the
browser URL is built exclusively from a numeric port + `encodeURIComponent(repo.id)` +
`encodeURIComponent(docKey)` (`open.ts:199`), so no quoting/metacharacter from a file path can
survive into `cmd /c start`. Daemon listens with `host: '127.0.0.1'`
(`src/commands/serve.ts:20`); all probes/registration hit `127.0.0.1` only. The dynamic raw route
keeps the traversal guard (`resolve` + `repoRoot + sep` prefix check, `routes/raw.ts:46-49`) and
is covered by `test/daemon/raw-register.test.ts:76` (I ran it). The live-register fallback
(daemon refuses/old) degrades to a clear error message, unit-tested in `test/open.test.ts`.

**Risk 3 — reorder whitespace-gap fix:** the fix is exactly the plan §4.B prescription — the
positional fill no longer overwrites indices claimed by a reorder pairing
(`chartroom-ui/src/editor/roundTrip.ts:358-360`, one guarded set). The exact DECISIONS-NEEDED
repro (heading → 3-blank gap → A, A/B swapped) is a test:
`test/editor/roundTrip.test.ts:536+` asserting the new adjacency gets `DEFAULT_GAP`, plus
no-reorder unusual-spacing preservation and reorder+insert composition cases. 52→54 roundTrip
tests, all green in my run; `editor-round-trip.mjs` acceptance (updated count) passed.

## 4. Plan/spec conformance

- All five scope items present and tested: (a) staleness (`src/staleness.ts`, `check.ts`
  integration, `check-cli`/`staleness`/`staleness-git` tests — exit-code matrix incl.
  `--fail-orphans`); (b) quirk fix; (c) `acceptance/real-agent-e2e.mjs`; (d) `associate`;
  (e) `open` + substrate (doc-lookup key addressing, daemon.json, raw route, repo-register).
- `CheckResult.clean` keeps integrity-only meaning; staleness is the `stalenessClean` sibling
  (`src/check.ts:26-40`) — hook cannot start failing on TTL expiry; hook tests green.
- `doc-assets` path-key encoding review point closed: `assetFolderName` flattens path keys to a
  safe slug (`routes/doc-assets.ts:23-30`), tested in `test/daemon/doc-by-path.test.ts`.
- Deviations all logged in plan §9bis, none silent; spot-checked #1 (server.test.ts genuinely
  unchanged), #2 (test renamed, fs describe excluded), #3 (probe-based live-register, unit-tested).
- No package-3 scope creep: diff contains no activity/search/RepoTree/fs/claude-session code.
  Non-package files in the diff are FO bookkeeping riders (lookout guard, deck plan/reports,
  tracking) — expected per dispatch.
- `real-agent-e2e.mjs` (not rerun, per dispatch): read the script — real assertions against a
  unique heading and a planted answer, honest flake policy, scratch-repo only. Not a mock. TL
  transcript (haiku, session 527537d7, PostToolUseFailure chain) stands as run evidence.

## 5. Environment notes

- I mutated HKCU twice (remove + reinstall) as a deliberate reversibility test; end state is
  identical to the TL's left-installed deliverable. Nothing else touched; no files deleted;
  `team-tasks/` untouched (its dirty working-tree files predate this review).

## Verdict

**PASS.** Acceptance line demonstrably holds (scripted + registry-level + real reversal cycle);
build/lint/tests/acceptance all green on my own runs; no plan or spec item silently missing.
