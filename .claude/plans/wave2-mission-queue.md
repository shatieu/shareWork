---
id: wave-2-mission-queue-captain-s-orders-2026-07-16
---

# Wave 2 mission queue — Captain's orders 2026-07-16

Branch: `ship-wave1`. Preset: standard (navigator → shipwright → inspector, no plan gate).
FO session: 2cce1eab. Lookout: lock held, sensor + waiter running. Harness tasks #1–#10 mirror this queue.

| Pkg | Task# | Scope | Status |
|---|---|---|---|
| 0 | #1 | Commit+push inspected wave (chapel, wizard, lookout v2); team-tasks fixes separate; stale verify-repo cleanup; station.ts nit; .ship-crew gitignore; CAPTAIN-TODO one-liners (agent hook, pre-commit hook, MCP registrations) | DONE 2026-07-17 (browser QA still blocked: Chrome ext not connected, 5th attempt) |
| A | #2 | Editor blank-on-edit: Milkdown spread-attr bug, fixed via live-schema build + splice + compat shim; inspector PASS (147/147 mount, byte-safety held; 1 pre-existing malformed table doc fixed by FO) | PASS |
| B | #3 | Settings chips + real writes + user packs; inspector PASS (28/28 smoke, byte-verified group move, hostile packs contained) | PASS |
| C | #4 | Chapel chat + archive + history + marker chips; inspector PASS (injection + traversal held); FO hardenings: flag-proof chat text, atomic archive write (ea5f7ec) | PASS |
| D | #5 | Voyage: multi-project switcher + add-items — BUILT (a2fe15f/b03c245/3a549a9), inspector PASS (21/21 smoke, unknown fields preserved, 409-on-corrupt byte-safe) | PASS |
| E | #6 | Inbox respond/send/unwatch/askhuman page; App.tsx wired by FO (20069b4); inspector PASS (ambiguity guard held, golden bytes vs real skill server) | PASS |
| I | #10 | Token tracking + Console dashboard; dedupe fix red-proven (3x overcount), cursor-boundary + v1→v2 migration attacks held; inspector PASS | PASS |
| F | #7 | Plan approved by Captain 2026-07-18 → IMPLEMENTED: ship-comms station (send/poll/history, ambiguity-safe addressing, at-most-once documented) + comms.mjs Stop-hook delivery + hull mount (9 stations). Inspector FAIL→2 findings fixed by FO (rowid ordering 5/5 green, honest semantics docs)→verified | DONE |
| G | #8 | PLAN ONLY: modularization (partial adoption, separable vs core) — no edits until Captain confirms | DONE — plan committed, awaiting Captain decision |
| H | #9 | HOWTO.md written (299fb56), living-doc rule in CLAUDE.md + FO memory | DONE |
| I | #10 | Per-session token tracking + dashboard (added mid-mission) | pending |

| J | #11 | Chaplain rounds: daily per-project haiku digest (~/.ship/chaplain/rounds/), lazy once-per-day + Deck run button, chapel routes + Rounds panel, charter rite reads it. Inspector FAIL was a wave2-F cross-lane test miss (fixed by FO); all 24 J-specific probes green | DONE |
| QA | — | Real-browser pass over all tabs (Chrome ext connected 2026-07-18): all wave2 features verified; found+fixed stale-bundle turbo cache and overview-heading contrast. Captain still owes: enabledPlugins line for all-project capture | DONE |

Order of execution: 0 → A (bugfix) → C (bugfix half first) → B → E → D → I → H.
F and G run as parallel read-only research from the start; their deliverables are plan docs
(`.claude/plans/agent-comms-status-and-plan.md`, `.claude/plans/suite-modularization-plan.md`)
gated on the Captain — no code.

Checkpoint discipline: signals checked before every dispatch; commit per package; this file's
Status column updated at every package boundary. On resume, continue from the first non-done row.
