# Captain's Inbox

The Captain steers the marathon by editing this file. The First Officer reads it
at every package boundary. Anything written here outranks the kickoff briefing.

Format: append entries under `## Orders` with a date. The FO marks each entry
`[read: <timestamp>]` once acted on and records the action in STATUS.md.

## Orders

### 2026-07-05 — Order 1: Amendments to the kickoff briefing (adopt whichever your copy predates) `[read: 2026-07-05T13:24:00+02:00, adopted]`

`suite-design/MARATHON-KICKOFF-PROMPT.md` was amended after (or around) your launch. Diff your understanding against the current file and adopt anything missing. The amendments, in short:

1. **Structured progress tracking — adopt immediately, regardless of current package.** Maintain `suite-design/overnight/progress.json` (one entry per queue package: `{ id, title, status, stage_progress, difficulty, remaining_guess_h, updated_at, note }`; stage_progress deterministic: pending 0 / planning 15 / plan approved 25 / implementing 60 / in review 80 / PASS+merged 100 / parked freezes; difficulty S–XL set at plan approval; remaining_guess_h an honest guess updated per stage change). Regenerate `suite-design/overnight/PROGRESS.md` from it on every update — unicode progress bar per package, difficulty badge, guessed remaining time, done/pending/parked sections, overall difficulty-weighted mission bar, last-updated stamp. Backfill entries for all packages already completed or in flight. This is the Captain's live visual check; keep it current from now on.
2. **One-hull revision (Ship_Spec §2 as amended):** "separate processes" is revoked — queue item 3 is now the hull refactor into the **Captain's Deck** (one Fastify host, Chart Room as first mounted plugin, one UI shell with tabs; modules stay independent packages, typed plugin contracts only).
3. **Deck additions:** "❯ claude" chip + per-repo session spawn (`POST /api/repos/:id/claude-session`, bind 127.0.0.1 only) and a **"Voyage" tab** rendering `progress.json` live (file-watched, same visual grammar later reused for Bridge ledger items).
4. **Chart Room v1.1 additions:** `chartroom associate` (per-user Windows .md file association via hidden launcher; open → find-or-start daemon → auto-register repo → deep-link to doc) and `chartroom open <file>`. Acceptance: double-click an .md in Explorer in a never-registered repo lands on that doc.

If any of these were already in your briefing, mark them known and move on. Do not interrupt an in-flight package for items 2–4; item 1 applies now.
