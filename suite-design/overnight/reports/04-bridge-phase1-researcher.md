---
id: 04-bridge-phase1-researcher-report-r1-r4
---

# 04-bridge-phase1 — Researcher report (R1–R4)

Date: 2026-07-05. Machine: Windows 11 Pro 25H2. Claude Code CLI **2.1.201** (`claude --version`;
npm global install, native `bin/claude.exe`, 231 MB). Node **v24.14.0**. Repo pnpm pinned
**10.34.4** via `packageManager` (corepack); machine-global pnpm is **11.10.0** — version matters
for R4. Sources: code.claude.com docs fetched 2026-07-05 + empirical runs in session scratchpad
(`scratchpad/hooklab`, `scratchpad/plugintest`, `scratchpad/bsq3*`). Total `claude -p` spend
≈ $0.20 (7 haiku runs), at the authorized cap.

---

## R1 — Real hook-event inventory + payloads on 2.1.201: **NO spec-vs-reality gap in event
existence. `PermissionRequest`, `TaskCreated`, `TaskCompleted` all EXIST.** One real gap found:
`PermissionRequest` does not fire in `-p` mode (details below).

### Inventory
Current hooks doc (code.claude.com/docs/en/hooks, fetched 2026-07-05) lists **29 events**:
SessionStart, Setup, UserPromptSubmit, UserPromptExpansion, PreToolUse, **PermissionRequest**,
PermissionDenied, PostToolUse, PostToolUseFailure, PostToolBatch, Notification, MessageDisplay,
SubagentStart, SubagentStop, **TaskCreated**, **TaskCompleted**, Stop, StopFailure,
**TeammateIdle**, InstructionsLoaded, ConfigChange, CwdChanged, FileChanged, WorktreeCreate,
WorktreeRemove, PreCompact, PostCompact, Elicitation, ElicitationResult.

**Installed-binary confirmation (2.1.201):** string-grep of `claude.exe` finds every
Ship_Spec-§2 name — PermissionRequest (78 hits), TaskCreated (22), TaskCompleted (29),
TeammateIdle (27), SessionEnd (36), SubagentStop (56), StopFailure (17), PostToolBatch (27).
The docs inventory is not newer-than-installed vapor.

### Empirically captured payloads (scratch repo `.claude/settings.json` logger, 4 `-p` runs)
Events that fired in `-p`: SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop,
SessionEnd, **TaskCreated**, **TaskCompleted** (the latter two via a prompt using the
`TaskCreate`/`TaskUpdate` tools). Exact stdin JSON observed:

- **SessionStart**: `{session_id, transcript_path, cwd, hook_event_name, source:"startup"}` —
  NO prompt_id, NO permission_mode. Docs matcher values for source: startup|resume|clear|compact.
- **UserPromptSubmit**: `{session_id, transcript_path, cwd, prompt_id, permission_mode, hook_event_name, prompt}`.
- **PreToolUse**: `{…common, prompt_id, permission_mode, tool_name, tool_input, tool_use_id}`.
- **PostToolUse**: PreToolUse fields + `tool_response`, `duration_ms`.
- **Stop**: `{…common, prompt_id, permission_mode, stop_hook_active:false, last_assistant_message, background_tasks:[], session_crons:[]}`.
- **SessionEnd**: `{session_id, transcript_path, cwd, prompt_id, hook_event_name, reason:"other"}` —
  no permission_mode. Docs reason values: clear|resume|logout|prompt_input_exit|bypass_permissions_disabled|other.
  A normal `-p` completion gives `reason:"other"`.
- **TaskCreated**: `{session_id, prompt_id, transcript_path, cwd, hook_event_name, task_id:"1", task_subject, task_description}`.
- **TaskCompleted**: identical shape (same task fields). (Docs don't document these fields —
  this empirical shape is the only schema; treat as unstable.)
- `transcript_path`/`cwd` are absolute Windows paths with backslashes.

### The real gap (flag for packages 5–6)
- **PermissionRequest did NOT fire in `-p` mode** even when a tool call was permission-denied:
  run with `--permission-mode default` + non-allowlisted command → result had 2
  `permission_denials`, log shows only PreToolUse, **no PermissionRequest event**, and the
  session ended without Stop (SessionEnd still fired). Docs describe it as firing "when a
  permission dialog appears" — it is an **interactive-dialog event**. Its documented resolution
  contract: exit 0 + stdout `{"hookSpecificOutput":{"hookEventName":"PermissionRequest",
  "decision":{"behavior":"allow"|"deny","updatedInput":{…}}}}`. **Interactive firing not
  empirically verified here** (no tty harness in budget) — package 6 must verify interactively
  before building the inbox resolver. Fallback signal: `Notification` with
  `notification_type:"permission_prompt"` (docs; also has message field; types:
  permission_prompt|idle_prompt|auth_success|elicitation_*|agent_needs_input|agent_completed).
- **Stop is not guaranteed per session**: it did not fire on the denial/limit-terminated run;
  SessionEnd fired on every `-p` exit path tested (success, budget-abort, denial-abort).
  Supports plan §3.8 (SessionEnd = authoritative capture trigger; orphan sweep as net).
  Ctrl+C / window-close SessionEnd behavior remains **unverified**.
- Adjacent: on this Windows box the shell tool is named **`PowerShell`, not `Bash`**
  (`tool_name:"PowerShell"` in Pre/PostToolUse) — tool-name matchers must include it.

---

## R2 — Plugin anatomy + `${CLAUDE_PLUGIN_ROOT}` on Windows: **verified, incl. empirical
`--plugin-dir` run; both exec-form and shell-form hooks fired in `-p` mode.**

- **Manifest**: `.claude-plugin/plugin.json` is **optional**; if present, `name` is the only
  required field (kebab-case). Unrecognized top-level fields are ignored (warnings in
  `claude plugin validate`). All component dirs (hooks/, skills/, agents/, …) live at the
  **plugin root**, not inside `.claude-plugin/`. Optional fields incl. description, version
  (pins update granularity; falls back to git SHA), author, license, `hooks` (custom path/inline),
  `defaultEnabled:false` (≥2.1.154).
- **Hooks location**: `hooks/hooks.json` at plugin root is the auto-loaded default (or
  plugin.json `"hooks"` path/array/inline). Format identical to settings hooks:
  `{"hooks":{"<Event>":[{"matcher"?, "hooks":[{"type":"command","command"…|"args"…,"timeout"?,"shell"?}]}]}}`.
- **`${CLAUDE_PLUGIN_ROOT}`** (empirical, `--plugin-dir`, `-p` run): expands to the plugin's
  absolute **Windows backslash path** (`C:\Users\…\plugintest`) and is ALSO exported as an env
  var to the hook process. Exec form `{"command":"node","args":["${CLAUDE_PLUGIN_ROOT}/hooks/emit.mjs"]}`
  substitutes inside args, one argv, no quoting (docs-recommended). Shell-form
  `node "${CLAUDE_PLUGIN_ROOT}/hooks/plog.mjs"` also worked (git-bash; node accepts the mixed-
  slash path). Docs: plugin-root path **changes on plugin update** (old dir kept ~7 days);
  hooks keep the old path until `/reload-plugins`.
- **Install/enable**: (a) session-only: `claude --plugin-dir <path>` (repeatable, dirs or .zip;
  also `--plugin-url`); `--bare` skips it. (b) persistent: `claude plugin marketplace add
  <url|path|github-repo>` (local paths OK) then `claude plugin install <name>[@marketplace]
  --scope user|project|local` — **project scope writes `enabledPlugins` into
  `.claude/settings.json`** (repo-shared; local = gitignored variant). (c) skills-dir autoload:
  `~/.claude/skills/<name>/.claude-plugin/plugin.json` loads as `<name>@skills-dir`, discovered
  in place, no copy — good dogfood mechanism. `claude plugin init <name>` scaffolds there
  (`--with hooks` adds a sample hooks.json).
- **Plugin hooks fire in `-p` like project hooks** — empirically confirmed (SessionStart +
  UserPromptSubmit plugin hooks fired via `--plugin-dir` in a print-mode run).
- Hook-changes need `/reload-plugins` or restart (only SKILL.md is live-reloaded). A plugin
  CLAUDE.md is NOT loaded as context.

---

## R3 — Hook execution contract: **docs verified + one load-bearing empirical discovery: the
SessionEnd exit-grace is ~1.4 s in `-p` mode; slow SessionEnd hooks are CANCELLED, not awaited.**

- **Timeout**: default **600 s** per command hook (UserPromptSubmit 30 s, MessageDisplay 10 s);
  per-hook `"timeout": <seconds>` field. (Docs, fetched 2026-07-05.)
- **Parallelism**: all matching hooks run in **parallel**; identical commands deduped;
  `"async": true` runs in background without blocking.
- **Exit codes**: 0 → stdout parsed for JSON decisions (only on exit 0); **2 → blocking**
  (where the event supports it; stderr fed back); any other → non-blocking error (continues;
  first stderr line shown). Exit 1 does NOT block. stdout cap 10,000 chars.
- **EMPIRICAL — exit grace (2.1.201, `-p`)**: a 4 s SessionEnd hook was killed with
  "`SessionEnd hook [...] failed: Hook cancelled`"; a 100 ms-ticker hook logged its last tick at
  **+1422 ms** before being killed. So at `-p` exit, SessionEnd hooks get **~1.3–1.5 s**, then
  cancellation. **Plan impact**: emit.mjs's proposed 1.5 s HTTP timeout is too long — worst-case
  path (timeout → spool write) would be killed mid-flight. Recommend: fetch with
  `AbortSignal.timeout(≤700ms)` then spool append; or spool-first-then-POST-and-truncate.
  (Interactive-exit grace unverified; may be longer. Fast hooks (<1 s) always completed.)
- **Windows shell**: shell-form commands run under **Git Bash when installed** (observed hook
  env: `SHELL=…\git\…\usr\bin\bash.exe`, `MSYSTEM=MINGW64`), else PowerShell; per-hook
  `"shell": "bash"|"powershell"` override; **exec form (`args`) = no shell, direct spawn** —
  `"command":"node"` resolved fine. `CLAUDE_PROJECT_DIR` is set in hook env (abs Windows path).
- **fetch/AbortSignal**: global `fetch` + `AbortSignal.timeout` work on the installed Node
  24.14 (empirical) and exist on all Node ≥20 (fetch unflagged since 18, AbortSignal.timeout
  since 17.3) — safe for emit.mjs; no need for manual `node:http`.

---

## R4 — better-sqlite3 + pnpm build-script gate: **prebuild confirmed working empirically on
win32-x64/Node 24; the `onlyBuiltDependencies` key location is pnpm-version-dependent.**

- **Current version**: **12.11.1** (npm registry, published 2026-06-15). License **MIT**.
  engines: `20.x || 22.x || 23.x || 24.x || 25.x || 26.x`. Uses `prebuild-install`.
- **Prebuilds** (GitHub release v12.11.1 assets): win32-x64 exists for Node ABI **v137 (Node
  24)** ✓, v127 (Node 22) ✓, v141, v147, + win32-arm64 — but **NO node-v115 (Node 20) asset**:
  on Node 20 it compiles from source (needs MSVC). Captain's machine is Node 24.14 → prebuild.
  Flag: repo engines say `>=20`; CI/other machines on Node 20 would need build tools.
- **Empirical install**: `pnpm add better-sqlite3` on this machine → install script ran
  prebuild-install, done in ~2 s (no compile), then `require('better-sqlite3')(':memory:')`,
  `pragma journal_mode=WAL`, insert/select all worked.
- **pnpm gate (exact behavior, all empirical)**:
  - **pnpm 10.34.4 (the repo's pinned version)**: root `package.json`
    `"pnpm": { "onlyBuiltDependencies": ["better-sqlite3"] }` **WORKS** — build script ran,
    module loads. `pnpm-workspace.yaml` `onlyBuiltDependencies:` is the other documented 10.x
    home (where `pnpm approve-builds` writes).
  - **pnpm 11.10.0 (machine-global)**: prints "**The \"pnpm\" field in package.json is no longer
    read by pnpm**"; `onlyBuiltDependencies` is **removed in v11**, replaced by
    `allowBuilds: { better-sqlite3: true }` in pnpm-workspace.yaml (empirically verified:
    install script ran, module loaded). Without any allow-key, install completes but the
    binding is missing → `Could not locate the bindings file` at require-time (the misleading
    failure the plan predicted).
  - **Recommendation**: put `onlyBuiltDependencies: [better-sqlite3]` in the repo's existing
    **pnpm-workspace.yaml** (works on pinned 10.34.4, survives approve-builds) and note the
    pnpm-11 migration (`allowBuilds`) in the package README. The plan-§4 package.json key works
    only while the repo stays on pnpm 10.

---

## Adjacent one-liners
- This user's `~/.claude/settings.json` has `defaultMode: "acceptEdits"` + 62 allow rules
  (incl. blanket `Write`) — permission-behavior tests must pass `--permission-mode default`
  AND pick non-allowlisted actions, or results lie.
- Windows shell tool is `PowerShell` (tool_name), not `Bash` — affects matchers in pkgs 5–6.
- A `-p` run that ends via permission-denial/limits skips Stop but still fires SessionEnd.
- `claude plugin validate` / `/plugin validate` checks plugin.json + hooks.json schemas.
- Scratch evidence files: `scratchpad/hooklab/run{1..4}.jsonl`, `events.jsonl`, `tick.log`,
  `scratchpad/plugintest/hooks/pluginevents.jsonl`, `scratchpad/bsq3{,b,c}/`.
