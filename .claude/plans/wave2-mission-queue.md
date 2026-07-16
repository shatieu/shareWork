---
id: wave-2-mission-queue-captain-s-orders-2026-07-16
---

# Wave 2 mission queue — Captain's orders 2026-07-16

Branch: `ship-wave1`. Preset: standard (navigator → shipwright → inspector, no plan gate).
FO session: 2cce1eab. Lookout: lock held, sensor + waiter running. Harness tasks #1–#10 mirror this queue.

| Pkg | Task# | Scope | Status |
|---|---|---|---|
| 0 | #1 | Commit+push inspected wave (chapel, wizard, lookout v2); team-tasks fixes separate; stale verify-repo cleanup; station.ts nit; .ship-crew gitignore; CAPTAIN-TODO one-liners (agent hook, pre-commit hook, MCP registrations) | in progress |
| A | #2 | Deck MD editor bug: click Edit → all text disappears. Root-cause + fix + tests | pending |
| B | #3 | Settings tab: grouped drag-drop permission chips (git → git push granularity), real project settings.json writes, fix editor, user-defined templates | pending |
| C | #4 | Chapel: fix confession-not-stored bug; live chat window w/ chaplain as main feature; cross-project (project = click-insert marker); past-confessions view | pending |
| D | #5 | Voyage: project switcher; add todos/items from UI | pending |
| E | #6 | Sessions/inbox: unwatch session; full text respond to any tracked session; ship-styled ask-questions page (ask-human pattern) | pending |
| F | #7 | PLAN ONLY: agent↔agent comms status + improvement plan; study `../claude peers` | pending |
| G | #8 | PLAN ONLY: modularization (partial adoption, separable vs core) — no edits until Captain confirms | pending |
| H | #9 | Human HOWTO.md (short), living doc + maintenance rule in CLAUDE.md/memory | pending (after A–E) |
| I | #10 | Per-session token tracking + dashboard (added mid-mission) | pending |

Order of execution: 0 → A (bugfix) → C (bugfix half first) → B → E → D → I → H.
F and G run as parallel read-only research from the start; their deliverables are plan docs
(`.claude/plans/agent-comms-status-and-plan.md`, `.claude/plans/suite-modularization-plan.md`)
gated on the Captain — no code.

Checkpoint discipline: signals checked before every dispatch; commit per package; this file's
Status column updated at every package boundary. On resume, continue from the first non-done row.
