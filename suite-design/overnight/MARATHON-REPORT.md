---
id: marathon-report-the-rest-of-the-ship
---

# Marathon Report — the rest of the Ship

Mission window: 2026-07-05 12:51 → 2026-07-06 ~15:00 CEST, one continuous session across
five usage windows, two hard-cap deaths, and one guard-resurrected night shift.
Queue: 14 packages. Result: **14/14 PASS+merged, pushed** (`origin/ship-wave1`).

## Delivered + verified

| # | Package | Merge | Verification |
|---|---------|-------|--------------|
| 0 | Crew charter + mission context | 974a384..ae1d0b7 | 4/4 dry-runs honored the report contract |
| 1 | Housekeeping + Chart Room dogfood | c6588a5 | Independent review: FAIL→fix→PASS (renderer frontmatter landmine) |
| 2 | Chart Room v1.1 (staleness, gap fix, real-agent e2e, associate/open) | 3c8de99 | Independent lean review PASS; live HKCU + real-agent proofs |
| 3 | Captain's Deck (hull, tabs, claude chip, Voyage) | overnight | Independently re-verified by Captain's discovery session |
| 4 | Bridge 1 (crew plugin, hooks, ship-log) | 8b35d49 | Review FAIL→sync-ingest fix→PASS; re-verified by discovery session |
| 5 | Bridge 2 (ship-ledger, MCP, task mirroring) | dd5b41f | Self-verified: 20/20 gates + live MCP proof |
| 6 | Bridge 3 (ship-inbox, always-allow rails) | 78a1fbd | Self-verified: 23/23 gates; rails proven per-requirement, live loop |
| 7 | Settings manager (simulator, editor rails, packs) | f844d0c | Self-verified: 103 tests, provably read-only simulator, 27/27 acceptance |
| 8 | Crew (6 roles, presets, stop-gate, quartermaster MCP) | 95dd334 | Self-verified: 24/24 gates, live role-assembly proof |
| 9 | Bridge console (thin fleet view) | cc0a3bf | Self-verified: deck-boot 7 stations, live fleet proof |
| 10 | Scheduler productization (reset-detector, lookout bin, graceful-pause) | 10293ba | Self-verified: deterministic replay of the real guard bugs, 22/22 |
| 11 | Skill analytics (collector, CLI, Console panel) | 8684b1c | Self-verified: 1123 workspace tests, live 210-transcript run |
| 12 | Sea Chest code-complete | 0e6b6f3 | Self-verified: 88 tests, RLS proven in dockerized Postgres |
| 13 | Comm phase 1 (ship-voice, spoken-form) | 60f7db1 | Self-verified: 30/30 acceptance, live fleet summary |

Honesty note: per the Captain's wrap-up order (2026-07-06 09:35), packages 5-13 received NO
independent adversarial review — self-verification by the building Team Lead only, with
independent review reserved for named risks (none were flagged). Packages 0-4 were
independently reviewed and additionally re-verified by the Captain's morning discovery session.

Final tree: 15 workspaces, ~1123 tests green, 8 hull stations, Deck tabs
Docs/Voyage/Inbox/Settings/Console, `chartroom check` exit 0.

## Parked seams (see CAPTAIN-TODO.md for exact commands)

- Chart Room agent-hook install + interactive Explorer "Always" double-click (per-machine).
- Comm phase 2+: ElevenLabs credentials.
- Sea Chest: live Supabase apply + Harbor mount (Captain-supervised session; migrations are
  files only, RLS behavior proven against throwaway Postgres, never live).
- Per-machine registrations: `claude mcp add` (ledger/log MCP), scheduler `schtasks` job.
- Harbor migration + website: never started, reserved for Captain-supervised session per kickoff.

## Decisions needed (DECISIONS-NEEDED.md)

Highlights: proposed v1.2 package (Deck phase-2 UI fixes cut at the Deck plan's line);
npm package names (`ship` is taken; `captains-deck`/`ship-hull` free); summarizer CLI-vs-SDK
default; fragment noise/commit policies; quarantined-WIP leftovers (search/fs-picker/activity
parked — never salvaged, still on `wip-quarantine-2026-07-05`).

## Removals

Zero file deletions all mission (rm ban held). REMOVALS.md flags for Captain cleanup:
stale `suite-design/overnight/usage.json`, stray branch `ship-wave1-brass` (duplicate label
of the quarantine tip), now-inert `suite-design/lookout/state/` leftovers, five agent
worktrees + one FO merge worktree under the session scratchpad (auto-cleaned by OS temp,
or `git worktree prune` after deleting).

## Lookout + guard performance (full story)

- Sensor (5-min poller): solid throughout; both planned PAUSE checkpoints keyed off it.
- FO error, day 1: preemptive idle at 79% with no ALERT raised — Captain corrected; rule
  codified as "mechanical dispatch" (charter + skill + LESSONS-LEARNED).
- ScheduleWakeup does NOT survive hard caps (proven 18:00→21:30 gap, ~1h idle after reset).
- Fix: session-independent guard (guard.ps1 + Task Scheduler, Captain-registered 22:59).
- Night shift: guard resurrected the session and packages 3+4 got built, reviewed, merged.
  Two real guard bugs, both self-diagnosed and patched by the night continuations:
  resets_at sub-second jitter defeated once-per-window dedup (7 firings 03:35-04:59,
  5 marker files); print-mode kills background workers after 600s (killed one developer).
- Headless pushes were permission-blocked all night → 33 commits local-only until the
  morning interactive push. Known limitation, cost nothing but visibility.
- Captain decommissioned guard + sensor 2026-07-06 ~08:00 (verified: task not found).
  Wrap-up phase ran without usage signals; commit-early discipline was the only insurance
  and it worked (4 worker deaths, 0 lost work).
- Every learning is productized in `packages/reset-detector` + `packages/scheduler`,
  including deterministic tests replaying the jitter and idle-refire bugs.

## Recommended Captain session agenda

1. Browser QA pass over the full Deck (`ship serve`) — 8 stations, 5 tabs; nothing was
   eyeballed in a real browser all mission (jsdom + spawned-hull proofs only).
2. Sea Chest supervised integration: apply migrations to a Supabase branch, mount in Harbor.
3. One-line per-machine installs (CAPTAIN-TODO): agent hook, MCP registrations, scheduler task.
4. DECISIONS-NEEDED triage — approve/refuse the v1.2 package, npm names, policies.
5. ElevenLabs credentials → dispatch Comm phase 2.
6. Cleanup: REMOVALS.md items, stray branches/worktrees, 19-process check.
