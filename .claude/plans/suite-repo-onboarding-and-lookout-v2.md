---
id: plan-new-repo-onboarding-rework-lookout-v2-waiter-structure
---

# Plan — New-repo onboarding rework + Lookout v2 (waiter structure)

Status: draft for Captain review. Two workstreams from the 2026-07-09 directive:
(1) "adding a repo should set it up for the whole framework automatically, and a
setup skill should audit brand-new spec-only repos"; (2) "rewrite the lookout to
a new structure — platform-independent background script that communicates with
the session that opened it and puts a continue message there when the window has
renewed and the session took no action."

## Workstream 2 — Lookout v2: the waiter (implemented this session)

### Why the old structure failed
- `ScheduleWakeup` dies with the session at a hard token cap (LESSONS-LEARNED
  2026-07-05: mission idled ~1 h past the reset).
- The guard fixed that but at a heavy price: per-machine Task Scheduler/cron
  registration (platform-dependent, human step), and it *resurrected* via a new
  headless `claude --resume -p --permission-mode bypassPermissions` process
  instead of talking to the session that was already open. Captain deleted the
  guard registration; it "worked just partly".

### New structure: `lookout wait`
A platform-independent Node waiter (new `wait.ts` in `packages/scheduler`,
policy in `packages/reset-detector`) that the orchestrating session itself
spawns as a **background task** (`Bash` with `run_in_background: true`) at
session start. Communication channel: when a background task exits, the harness
delivers its output to the session that opened it as a task notification — that
IS the "continue" message. No scheduler registration, no new claude process, no
bypassPermissions.

Waiter loop (poll = config `pollSeconds`, default 300 s):
1. **Keep the sensor honest.** Read `usage.json`; if stale (≥ sensorStaleMinutes)
   run a sensor tick itself (`runSensorOnce`) so there is always one canonical
   fresh signal path. (Absorbs the guard's relaunch-sensor duty.)
2. **Arm on the current window.** Remember `windowKeyOf(resets_at)`.
3. **Detect renewal.** Window key changed, or pct fell from ≥ alertAt to
   < freshBelowPct (default 20).
4. **Idle gate with grace.** After renewal, wait `graceMinutes` (default 10):
   if session activity appears (git commit, activityDirs mtime, LOCK heartbeat)
   → the session woke itself (e.g. its own ScheduleWakeup) → **re-arm silently**
   on the new window and keep waiting.
5. **Fire.** No activity through the grace period → print the CONTINUE message
   (window renewed at X, five_hour Y%, plus the repo's `resume-prompt.txt`) and
   **exit 0**. The harness wakes the opening session with exactly that text.

Safety: pid-tracked single-instance file (`WAIT` lock, reusing lock.ts
mechanics) so two waiters never double-fire; `--max-hours` (default 24) expiry
with an explicit "waiter expired, respawn me" exit message; wait.log audit
trail; errors never break the loop and never shorten the poll interval.

Pure decision function `decideWaitTick` lives in `reset-detector` (same
convention as `decideGuardAction`: policy pure + plumbed side effects), fully
unit-tested with injected clock/activity.

What happens to the guard: code stays (it is the only thing that survives the
whole terminal being closed) but it is demoted in docs to an optional, opt-in
deep fallback. The default protocol no longer needs any per-machine step.

Skill/doc updates: `plugins/crew/skills/graceful-pause/SKILL.md` rewritten
around the waiter (spawn at session start, respawn check at every PAUSE, how to
treat the CONTINUE notification); `.claude/skills/lookout/SKILL.md` moved off
the ps1 prototype onto the `lookout` bin + waiter; `packages/scheduler/README.md`
updated. `suite-design/lookout/*.ps1` kept as the historical prototype.

## Workstream 1 — New-repo onboarding (design + skill this session; Deck wiring next)

### Canonical per-repo setup (what "fully set up" means)
Navigator-verified checklist — the one list both the skill and the automatic
flow execute:

Chart Room: registry entry in `~/.chartroom/repos.json` and `.docs/index.json`
(the only two things add-repo does today); `runInit` (frontmatter `id:`
injection + pre-commit hook, `packages/chartroom/src/commands/init.ts`);
`.chartroomignore`; `chartroom install-skill` + `install-agent-hook`;
CLAUDE.md "## Chart Room" section.

Ship crew: plugin enabled in `.claude/settings.json` (`claude plugin
marketplace add` + `claude plugin install ship-crew --scope project`);
`ship.scrutiny` setting; `.gitignore` entries `.ship/`, `.docs/`,
`.ship-crew/`; per-machine ship-ledger/ship-log MCP registration;
`lookout init` (`.ship/lookout/config.json` + resume prompt).

Mission scaffold (spec-only repos): specs passing the fullness audit, kickoff
prompt, MISSION-CONTEXT.md, tracking files, `plans/`, `reports/`,
`changelog/entries/`.

### The `setup` skill (in the crew plugin, so every repo that installs the
plugin has it)
Mode A — bootstrap audit: walk the checklist above, report present/missing,
perform the safe items, print the human-only ones.
Mode B — spec fullness audit (the "brand-new repo with only docs and specs"
case): audit every spec against the canonical anatomy proven by the TeamTasks
missions and propose concrete rewrites:
- header: `id:` frontmatter, Status line ("decision-complete, ready to implement"),
  cross-links to sibling specs;
- sections: What it is → strict in/out scope → decided stack → data model /
  interfaces → **build order in shippable phases, each with an explicit
  `Acceptance:` line** → definition of done → explicitly out of scope;
- product-spec vs build-spec split marked ("supersedes" notes where relevant);
- mission-support scaffold: kickoff prompt (numbered queue, each item = spec
  file+section + one acceptance line), MISSION-CONTEXT.md spec map, tracking
  files (PLAN/STATUS/PROGRESS + progress.json), plans/, reports/,
  changelog/entries/;
- known failure modes to flag: phase without a testable acceptance line,
  missing out-of-scope/seam, queue item with no governing spec section,
  superseded spec left unmarked, undated amendments, duplicate canonical paths,
  no DoD / completion marker.

### Automatic setup on add-repo (Deck seam — follow-up package, not this session)
Every add-repo path (Deck modal POST `/api/repos/register`, `chartroom
register`, `chartroom open`) funnels through the injected registrar in
`packages/chartroom/src/station.ts:73-96`, which today only does
`findGitRoot → registerRepo → rebuild → startWatcher`. The automatic setup
step attaches right after `registerRepo`: run the repo-local checklist
idempotently (compose the existing `runInit`, `install-skill`,
`install-agent-hook`, settings-manager writes), and surface the human-only
items (MCP registration, plugin marketplace add — machine-level) in the Deck
response the way sea-chest's `buildSetupManifest` models machine setup.
Recommended shape: a `ship setup` / `chartroom onboard` command the registrar
calls and the setup skill shells out to — one implementation, three entry
points (Deck add-repo, CLI, skill).
