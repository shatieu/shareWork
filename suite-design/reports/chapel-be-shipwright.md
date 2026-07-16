---
id: chapel-tab-be-shipwright-evidence-2026-07-09-branch-ship-wave1
---

# Chapel tab — BE shipwright evidence (2026-07-09, branch ship-wave1)

Plan: `.claude/plans/deck-chapel-tab.md` · Findings: `.ship-crew/exchange/chapel-tab/findings.md`

## Verdict

DONE — all six gates green, no commits made (dispatch forbade git operations).

## What was built

### packages/ship

- `src/chapel.ts` (new): `createChapelBackend({ homeDir, repoRoot })`. State dir
  `join(homeDir ?? homedir(), '.ship', 'chaplain')`. Routes registered inside one encapsulated
  Fastify scope whose `onRequest` hook enforces `x-ship-deck` (403) on ALL five routes — a
  future route added to the scope cannot forget the guard.
  - `GET /api/chapel/brief` → reads `BRIEF.md` (filename per the chaplain agent charter,
    `plugins/crew/agents/chaplain.md:42`); missing → `200 { brief: null, updatedAt: null }`.
  - `GET /api/chapel/projects` → `projects/*.md`, sorted ids, mtime ISO stamps; missing dir → `[]`.
  - `GET /api/chapel/projects/:id` → 200 `{ id, content, updatedAt }`; unknown → 404; `:id`
    validated `^[A-Za-z0-9_-]+$` before any path join (traversal-proof; `_chapel` fits).
  - `POST /api/chapel/confess` → 201; atomic tmp+rename (tmp in the PARENT dir so the chaplain's
    "read every inbox/ file" bootstrap never sees a half-written file); filename is the ISO stamp
    with `[:.]`→`-` plus a `-<n>` counter on same-ms collision — never the project; project
    lowercased then stripped to `[a-z0-9-]`, appearing only as the `project: <id>` body line;
    empty/whitespace text → 400, nothing written.
  - `POST /api/chapel/session` → `ctx.getContract('chartroom','spawnTerminal')`; absent → 501
    readable message; present → called with fixed server-side
    `['claude','--agent','ship-crew:chaplain']`, `cwd = repoRoot`; contract throw → readable 500.
- `src/hull.ts`: chapel registered unconditionally (unlike Voyage) between the Voyage block and
  the stations loop; `HullOptions.repoRoot?` added (default `process.cwd()` inside chapel.ts, so
  `serve.ts` needed no change); `homeDir` doc extended. Local structural
  `SpawnTerminalRequest`/`SpawnTerminalContract` types in chapel.ts (no deep chartroom import —
  exports-map rule, findings §spawn-seam).

### packages/chartroom

- `src/daemon/routes/claude-session.ts`: `launchTerminal` generalized to
  `(spawner, platform, hasWt, env, title, cwd, argv)` — the ONE per-OS matrix, no copy; the
  existing route now passes `title='Claude — <name>'`, `argv=['claude']` (behavior byte-identical,
  all 11 pre-existing route tests untouched and green). New exports: `TerminalLaunchRequest`,
  `SpawnTerminalContract`, `spawnTerminal(request, seams)` (seams = existing
  `ClaudeSessionRouteOptions`; empty argv throws).
- `src/station.ts`: contracts map gains `spawnTerminal` — an arrow wrapping the export so the
  test-seams parameter is not part of the contract surface.

## Tests added

- `packages/ship/test/chapel.test.ts` — 11 tests (voyage.test.ts temp-home pattern): brief
  null→content; projects list/get/404/traversal-404; confess verbatim + stamp name, hostile
  project sanitized in body & absent from filename, 400 empties, same-ms collision names;
  session 501 / fixed-argv seam (hostile body ignored) / throwing contract 500; 403 sweep over
  all five routes with no side effects.
- `packages/chartroom/test/daemon/spawn-terminal-contract.test.ts` — 5 tests (SpawnLike seam):
  win32+wt argv shape + env hygiene + unref, cmd fallback title/cwd (+default title=argv[0]),
  linux exec line, empty-argv throw, station contracts map exposes the function.

## Gates (all run 2026-07-09, this machine)

| gate | result |
|---|---|
| pnpm --filter chartroom build | PASS |
| pnpm --filter chartroom test  | PASS — 41 files, 299 tests |
| pnpm --filter chartroom lint  | PASS (clean) |
| pnpm --filter ship build      | PASS |
| pnpm --filter ship test       | PASS — 4 files, 28 tests (11 new) |
| pnpm --filter ship lint       | PASS (clean) |

Acceptance/other suites deliberately not run (inspector/FO own integration). Live Deck on 4317 untouched.

## Deviations / judgment calls (all within plan letter, flagged for inspector)

1. Brief filename `BRIEF.md` — plan doesn't name it; taken from the chaplain agent charter.
2. Project sanitization lowercases BEFORE stripping to `[a-z0-9-]` ("MyProj"→"myproj", not "yroj").
3. Same-ms filename collision gets a `-<n>` suffix — still purely stamp-derived.
4. `GET /projects/:id` id-alphabet 404 guard — not in the plan text but required by its
   traversal-proof intent; charset `[A-Za-z0-9_-]` (dots excluded, `..` impossible).
5. suite-conventions/src/station.ts:36-39 namespace comment not extended with `/api/chapel*`
   (file outside my ownership) — one-line follow-up for the FO if wanted.

Files: packages/ship/src/chapel.ts, packages/ship/src/hull.ts, packages/ship/test/chapel.test.ts,
packages/chartroom/src/daemon/routes/claude-session.ts, packages/chartroom/src/station.ts,
packages/chartroom/test/daemon/spawn-terminal-contract.test.ts (all under C:\thisismydesign\shareWork).
