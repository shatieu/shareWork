---
id: report-03-captains-deck-reviewer
---

# Package 03 — Captain's Deck — Reviewer report (adversarial, independent)

**Verdict: PASS**

Scope reviewed: phase-1 cut only (plan §10 steps 0-7). Step 8 (phase-2 quality slice) is
FO-cut and out of scope by design — not flagged as a gap.

## 1. Acceptance line — run for real

Line (plan §1): "`ship serve` boots the Deck with Chart Room mounted, all Chart Room tests
still pass, one port serves everything, and the claude chip opens a real terminal in the
right repo."

- `node packages/ship/acceptance/deck-boot.mjs` — **all 18 assertions PASS** (fresh run, this
  session): one port serves UI html + `/api/hull/stations` (docs tab) + `/api/repos` (stats) +
  a doc + `/api/voyage`; Host:evil.com → 403; claude-session w/o header → 403;
  `~/.suite/services.json` + `~/.chartroom/daemon.json` both registered with the hull port;
  live voyage update on file rewrite; Phase B in-process `hull.stop()` clears both discovery
  files (Windows kill-by-pid can't run signal handlers — honest documented deviation, plan
  `0-DEVIATIONS` #1).
- **Manual independent boot** (not just the script): built `ship` CLI, spawned
  `node dist/cli.js serve --port 4599` with an isolated `HOME`/`USERPROFILE`, against a real
  scratch git repo.
  - `netstat -ano` confirms bind is `127.0.0.1:4599` only (never `0.0.0.0`).
  - `curl http://127.0.0.1:4599/` → 200 (real Deck HTML).
  - `curl /api/hull/stations` → `[{"name":"chartroom","tab":{"id":"docs","title":"Docs"}}]`.
  - `curl -H "Host: evil.com" /api/hull/stations` → 403 (DNS-rebinding guard live).
  - `POST /api/repos/nonexistent/claude-session` no header → 403; same **with**
    `x-ship-deck: 1` → 404 (repo not found, guard order correct: CSRF before repo lookup).
  - `POST /api/repos/register` no header → 403; with header → 400 (bad body) — CSRF retrofit
    onto package-2's register route confirmed live, not just by reading source.
  - `~/.suite/services.json` and `~/.chartroom/daemon.json` written with matching port 4599
    on this manual boot too.
  - Cleaned up: `taskkill /F` on the spawned pid; port confirmed free after.

## 2. Full gates — reproduced independently, not trusted from claims

- `pnpm turbo build --force` and `pnpm turbo build:ui-bundle --force`: **12/12 tasks green**
  across suite-conventions, chartroom, chartroom-ui, ship (tsc + vite build + UI-bundle copy
  into both `chartroom/dist/public` and `ship/dist/public`).
- `pnpm turbo lint --force`: **4/4 packages clean**, zero eslint findings.
- `pnpm turbo test` (plain run, no `--force`): **chartroom 268/268 (38 files), chartroom-ui
  172/172 (20 files), ship 13/13 (3 files), suite-conventions all green** — matches the Team
  Lead's claimed floor exactly, independently re-derived (not trusted).

## 3. Named-risk spot checks (DECISIONS-NEEDED Package-3 entries)

**(a) claude-session route security posture — verified live, not by reading a comment.**
`packages/suite-conventions/src/security.ts`: `isAllowedHostHeader` correctly restricts to
127.0.0.1/localhost/[::1] (+matching port), rejects missing Host. Confirmed at runtime above
(evil Host → 403; loopback → 200). `claude-session.ts:153-154` checks
`request.headers[DECK_CLIENT_HEADER] === undefined` → 403, `DECK_CLIENT_HEADER` imported from
`suite-conventions`, not hand-duplicated. Default production spawner
(`claude-session.ts:148`, `options.spawner ?? (spawn as unknown as SpawnLike)`) is real
`node:child_process.spawn` — not a stub; only tests inject a fake.

**(b) `routes/fs.ts` — confirmed parked, not mounted.** `find packages/chartroom/src/daemon/routes
-iname "*fs*"` on `ship-wave1-deck` returns nothing; `fs.ts` exists only on
`wip-quarantine-2026-07-05` (`git show wip-quarantine-2026-07-05 --stat` shows it). Grep of
`register-routes.ts`/`station.ts`/`server.ts` for any fs-route import returns nothing. Live
curl confirms: `GET /api/fs`, `/api/repos/x/fs`, `/api/fs/list` all 404; `/api/search` and
`/api/activity` also 404 (both correctly parked alongside it).

**(c) "real terminal in the right repo" — real evidence exists, not simulated.** Team Lead
report (`03-captains-deck-team-lead.md`, "Chip proof" section) documents an in-process hull
composed over the real repo `C:/thisismydesign/shareWork`, argv-recording spawn wrapper
(argv itself untouched: `wt.exe -w new -d <repo> cmd /k claude`), and — critically — a
**real-machine** observation: `WindowsTerminal` `MainWindowTitle` became "Claude Code" and
the actual process tree (`WindowsTerminal → cmd.exe → claude.exe`) was captured via
`Get-Process`, plus the negative cases (wrong-repo 404, missing-header 403). This is a real
spawned window with process-tree evidence, not a mocked assertion — accepted as sufficient
given the lean-review directive (spot-check evidence exists and is credible; not required to
re-spawn a terminal myself).

## 4. team-tasks untouched

`git diff --stat ship-wave1..ship-wave1-deck` — **zero `team-tasks/` paths** in the 62 changed
files (all under `packages/{suite-conventions,ship,chartroom,chartroom-ui}`,
`suite-design/overnight/{plans,reports,changelog}`, `turbo.json`, `pnpm-lock.yaml`). The
working tree's uncommitted `team-tasks/*` modifications visible in `git status` are pre-existing
local state unrelated to this branch (confirmed not part of the `ship-wave1..ship-wave1-deck`
diff).

## 5. Diff-vs-plan checklist (plan §10 steps 0-7)

All present and matching commit-by-commit against the Team Lead's report: step 0 refresh
(`da7e1e4`), suite-conventions (`2ca8e1d`), chartroom extraction + station export (`824c194`),
repos-stats (`9b948f9`), claude-session hardening + register CSRF retrofit (`cb1c0cf`), ship
hull+voyage+serve (`d2ae02e`), deck-boot acceptance (`638fbb6`), UI shell (TabBar/RepoTree/
VoyagePage/App re-author + tests, `2ca556e`/`5c1d3a8`/`f7f5d83`). Step 8 (phase-2 DocEditor/
DocView/InboxPage/inbox-correctness) correctly absent — FO-cut, not flagged as a gap.
`docs/reports` mention parked WIP items (search/fs-picker/activity) logged in DECISIONS-NEEDED,
consistent with the plan's own §3.3 parking table; no CAPTAIN-TODO entry needed since nothing
here is blocked on credentials/live infra/a human (pure local-dev deferral, not a parked seam).

## Conclusion

Acceptance line demonstrably holds (script + independent manual boot/curl), all four
workspaces build/lint/test clean and reproduced independently, all three named risks check out
live, and no team-tasks contamination. **PASS.**
