---
id: marathon-master-plan-the-rest-of-the-ship
---

# Marathon Master Plan — the rest of the Ship

History: Chart Room v1 (all 5 build-order phases + one hardening pass) was delivered, adversarially
reviewed, and merged to `ship-wave1` by the overnight mission — see `MORNING-REPORT.md`. That
mission stood down cleanly (`DONE`, 2026-07-05 ~09:xx). The marathon now continues on the same
integration branch. Kickoff briefing: `suite-design/MARATHON-KICKOFF-PROMPT.md`.

## Work queue (strict order; each package fully done before the next implements)

| # | Package | Status |
|---|---|---|
| 0 | Charter the crew (`.claude/agents/wave-*.md` + `MISSION-CONTEXT.md`, dry-run proofs, commit) | **in progress** |
| 1 | Housekeeping + dogfood (reconcile git vs tracking, push policy, Chart Room onto this repo) | pending |
| 2 | Chart Room v1.1 (staleness rules, whitespace-gap fix, real-agent e2e proof, `associate`, `open`) | pending |
| 3 | Hull refactor → Captain's Deck (one Fastify host, Chart Room as first plugin, Deck UI shell, claude chip). AMENDED (Captain Order 1): Deck also gets a 'Voyage' tab rendering progress.json live (file-watched). | pending |
| 4 | Bridge phase 1 (Crew plugin skeleton + http hooks + ship-log changelog capture) | pending |
| 5 | Bridge phase 2 (ship-ledger + MCP + native task mirroring) | pending |
| 6 | Bridge phase 3 (ship-inbox: permission queue, agent + Chart Room questions, always-allow) | pending |
| 7 | Settings manager (hull plugin + UI tab: simulator → editor with rails → template packs) | pending |
| 8 | Crew — Bridge phase 4 (full role set, scrutiny presets, SessionStart wiring, Quartermaster) | pending |
| 9 | Bridge console (thin fleet view + rollup + inbox badge) | pending |
| 10 | Scheduler productization (Lookout → real package: reset-detector lib, graceful-pause skill, fallback) | pending |
| 11 | Skill analytics (transcript collector + CLI + console panel) | pending |
| 12 | Sea Chest code-complete (Locker phases 1–3 as code + migration files only; park live seams) | pending |
| 13 | Comm phase 1 (ship-voice laptop service + summarize-for-speech, text-mode acceptance) | pending |

## Process per package (non-negotiable)

Team Lead plan (saved to `plans/`) → First Officer challenge/approval → Developer implementation →
independent adversarial Reviewer, explicit PASS/FAIL → FO merges feature branch → `ship-wave1` only
on PASS → FO pushes `ship-wave1` (plain push, never force). Changelog fragment per package; rm
banned (REMOVALS.md); `team-tasks/` untouched; Captain-only calls to DECISIONS-NEEDED.md; parked
seams to CAPTAIN-TODO.md; read CAPTAIN-INBOX.md at every package boundary.

**Planning pipeline rule:** the *next* package's Team Lead may research and write its plan while the
current package implements. Implementation is strictly sequential — never two packages building at
once.

## Git

- Integration branch: `ship-wave1` (local only — origin currently has just `main`; first push
  establishes the remote branch).
- Feature branch per package off up-to-date `ship-wave1` (dash naming, e.g. `ship-wave1-<slug>`);
  verify the branch point includes the Lookout files.
