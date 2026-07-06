---
id: captain-todo-parked-integration-steps
---

# Captain TODO — parked integration steps

Each entry: one line **what**, one line **how**. These are the human-only steps
(credentials, live infra, supervised sessions) left after a package was built
to its seam. See the parking protocol in MARATHON-KICKOFF-PROMPT §4.

- **Install the Chart Room PostToolUseFailure agent hook** (package 01-housekeeping-dogfood; the
  session permission system blocked the agent from writing `.claude/hooks/` + `.claude/settings.json`
  itself — agent self-modification of live config needs a human run).
  How: from the repo root, `node packages/chartroom/dist/cli.js install-agent-hook` (idempotent).
- **Install the Chart Room pre-commit hook, post-merge** (deliberately deferred by FO direction —
  working-copy-global, must not fire before the dogfood id commit merges to `ship-wave1`).
  How: on `ship-wave1` after the merge, `node packages/chartroom/dist/cli.js init` once (idempotent,
  0 new ids, installs `.git/hooks/pre-commit`).

- **What:** Decommission the Lookout guard + sensor after the marathon fully completes (otherwise the guard keeps resurrecting headless sessions whenever this repo goes idle with tokens available).
  **How:** `schtasks /delete /f /tn ShipLookoutGuard`, then kill the lookout.ps1 powershell process (Task Manager or `Get-Process powershell | Where-Object {...}`); optionally delete `suite-design/lookout/state/`. The FO will ATTEMPT `schtasks /delete` itself at stand-down (may be permission-blocked) and will note in MARATHON-REPORT.md whether this TODO is still needed — verify regardless.

- **What:** Wire the Comm phase 2 (ElevenLabs agent + desktop-browser client) onto the phase-1
  seam — ship-voice's `/api/ship-voice/*` endpoints are live and text-mode-proven; no ElevenLabs
  code was written or faked (package 13-comm-phase1, VoiceBridge_Spec §9.2).
  **How:** (1) create an ElevenLabs account + Agents-platform agent (Council-mode prompt);
  (2) register client tools named exactly `fleet_status`, `session_status`, `send_to_session`,
  `dispatch`, `approve`, `deny`, `ledger_add`, `ledger_status`, `whats_new`, each handler calling
  the same-named `/api/ship-voice/` route and speaking the returned `spoken` field;
  (3) set `ELEVENLABS_API_KEY` + `ELEVENLABS_AGENT_ID` in the environment serving the phase-2
  test page (never in the repo); (4) build the React-SDK browser test page against a live fleet
  (spec §9.2's own acceptance). Full steps also in `packages/ship-voice/README.md`.
