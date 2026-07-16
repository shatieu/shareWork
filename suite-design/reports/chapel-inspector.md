---
id: chapel-tab-inspector-evidence-2026-07-09-branch-ship-wave1
---

# Chapel tab — inspector evidence (2026-07-09, branch ship-wave1)

Verdict: **PASS** (lean pass, standard preset). Scope per dispatch: three changed-package
suites, integrated bundle build, live smoke on own hull, risks r1/r2 only. Live Deck on 4317
untouched (smoke hull spawned programmatically on 4917 with a temp homeDir; `ship serve` was
deliberately NOT used — it writes real `~/.chartroom/daemon.json` / `~/.suite/services.json`).

## 1. Test suites (re-run by inspector, all exit 0)

| suite | result |
|---|---|
| pnpm --filter ship test | 4 files, 28 tests pass (chapel.test.ts 11) |
| pnpm --filter chartroom test | 41 files, 299 tests pass (spawn-terminal-contract 5) |
| pnpm --filter chartroom-ui test | 35 files, 293 tests pass (chapelClient 10, ChapelPage 12, App 18) |

Counts match builder evidence exactly.

## 2. Build + live smoke

`pnpm --filter chartroom-ui build && pnpm --filter ship build && pnpm --filter ship build:ui-bundle`
— exit 0.

Smoke script: `scratchpad/chapel-smoke.mjs` — imports `packages/ship/dist/hull.js`, temp
homeDir, 127.0.0.1:4917. 14/14 checks green:

- GET /api/chapel/brief → `{brief:null,updatedAt:null}` before state; real content + ISO
  updatedAt after seeding `BRIEF.md`.
- POST /confess → 201; inbox file stamp-named (`YYYY-MM-DDTHH-MM-SS-mmmZ(-n).md`), multi-line
  text byte-verbatim.
- Hostile confess `project: "../..\\EVIL\nproject: forged /etc"` → 201; file body exactly
  `project: evilprojectforgedetc\n\nhostile probe` (single header line, no newline injection);
  inbox holds only stamp-named files; chapel dir holds only `BRIEF.md,inbox`; temp home holds
  only `.ship`/`.suite` — nothing escaped.
- 403 without `x-ship-deck` on GET brief and POST confess (error names the header).
- POST /session with no chartroom station → 501 naming chartroom.
- Served `/` bundle JS contains `The Chaplain has not kept his brief yet` and
  `/api/chapel/brief` — chapel UI is in the integrated bundle.

Note: first smoke run had one failure that was the smoke's own bug (sent
`content-type: application/json` with empty body on /session → Fastify 400 pre-route);
verified the real client (`chartroom-ui/src/api/client.ts:656-660`) sends no content-type
there, so the app is unaffected. Fixed the probe, reran: all green. Trailing
`Assertion failed ... src\win\async.c` after `SMOKE PASS` is Node-on-Windows
process.exit teardown noise, not app behavior.

## 3. Named risks

**r1 — confession filename/content injection: HOLDS.**
`packages/ship/src/chapel.ts:119-138` — filename derived from `Date.toISOString()` +
collision counter only; `project` never touches the path, is lowercased then stripped to
`[a-z0-9-]` (path separators, dots, and newlines cannot survive → no traversal, no
frontmatter-line injection). Unit test chapel.test.ts:126-144 + live hostile probe both
confirm. Non-blocking observation: `text` is written verbatim per the plan, so a confessor
omitting `project` can start their text with `project: <anything>` — an unsanitized-looking
first line. Consumer is the chaplain LLM doing fuzzy assignment (plugins/crew/agents/
chaplain.md:34-35,69-73); no code parses that line into a path. Within the agreed design.

**r2 — /session argv fixed server-side: HOLDS.**
`chapel.ts:142-155` — the route never reads `request.body`; spawns
`[...CHAPLAIN_ARGV]` (`['claude','--agent','ship-crew:chaplain']`, module const, spread-copied)
with `cwd = repoRoot` (server option, default `process.cwd()`). Test chapel.test.ts:179-201
posts hostile `{argv:['rm','-rf','/'],cwd:'C:\\evil'}` through an injected contract and asserts
the fixed argv + hull repoRoot arrive. chartroom side: `spawnTerminal` shell-joins argv only on
darwin/linux with the fixed-argv invariant documented (claude-session.ts:68-73); it is
reachable only via the in-process contract, whose sole caller passes the constant. No real
terminal was spawned (asserted via seams, per dispatch).

## Non-blocking observations

1. The verbatim-text project-line nuance above (accepted design; note for the chaplain charter
   if ever parsed programmatically).
2. BE shipwright's own flag: `suite-conventions/src/station.ts:36-39` namespace comment not
   extended with `/api/chapel*` — one-line FO follow-up, cosmetic.
