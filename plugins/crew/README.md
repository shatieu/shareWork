---
id: crew-plugin-readme
---

# ship-crew (Crew plugin)

Installing this plugin is joining the Ship (Ship_Spec §7). It carries the crew roles, the
orchestration skill, the scrutiny-preset SessionStart wiring, the paranoid stop gate, and the
http hooks that feed the Bridge services (`ship-log` changelog capture, `ship-ledger` task
mirroring, `ship-inbox` permission queue).

## The crew (agents/)

| Role | What it is |
|---|---|
| `first-officer` | Orchestrator, the only one the Captain (you) addresses. Best run as the session's main agent: `claude --agent first-officer`. |
| `navigator` | Research & context gathering. Verified facts only. |
| `shipwright` | Implementation, strictly per the agreed plan, with tests. |
| `inspector` | Independent adversarial review + test/lint gates; binary PASS/FAIL. Writes the paranoid PASS marker. |
| `devils-advocate` | Argues against the plan before implementation (rigorous+). |
| `quartermaster` | Long-term memory over the ledger + changelog via MCP; answers cross-week progress questions, flags drift. NOT a bookkeeper — bookkeeping is automatic. |

`skills/crew/SKILL.md` is the orchestration procedure (pipeline per preset, plan gate,
stop-gate protocol, dispatch format, hot-load fallback for lagging agent types).

## Scrutiny presets

One word per project in `.claude/settings.json` (override per user in
`.claude/settings.local.json` — local wins; override per session verbally):

```json
{ "ship": { "scrutiny": "rigorous" } }
```

| Preset | Crew & gates |
|---|---|
| `solo` | FO works directly. Ledger/changelog capture stays automatic (non-optional floor). |
| `standard` (default) | navigator → shipwright → inspector. No plan gate. |
| `rigorous` | + devils-advocate before implementation + plan-approval gate (human approves the plan before code). |
| `paranoid` | rigorous + inspector PASS required before the session may finish — enforced by a `Stop` hook (`decision: block`), not politeness. |

Custom presets are named role-lists + gate flags under the same key:

```json
{ "ship": { "scrutiny": "review-only",
            "crewPresets": { "review-only": { "roles": ["inspector"], "planGate": false, "stopGate": true } } } }
```

At `SessionStart`, `hooks/scrutiny.mjs` resolves the preset and injects a `[Ship crew]`
briefing into the session (`additionalContext`) — that is the whole "one settings line, zero
further setup" wiring — and records the resolution to `~/.ship/crew/sessions/<session_id>.json`
for the stop gate.

**Paranoid stop gate:** `hooks/stop-gate.mjs` blocks the session's stop unless
`<project>/.ship-crew/inspector-pass.json` exists with this session's id and
`"verdict": "PASS"` (written only by the inspector, only on a real PASS). Safety valves: a
second stop attempt (`stop_hook_active`) is allowed through with a stderr audit line, and any
missing/corrupt state fails open. Add `.ship-crew/` to the project's `.gitignore`.

## Quartermaster MCP registration (per machine, one time)

The quartermaster reads two MCP servers. They live in this monorepo's packages (unpublished),
so registration is a per-machine step (package-5 decision — a marketplace plugin cannot point
at a workspace dist portably). After `pnpm build`:

```
claude mcp add ship-ledger -- node <repo>/packages/ship-ledger/dist/cli.js mcp
claude mcp add ship-log    -- node <repo>/packages/ship-log/dist/cli.js mcp
```

(or `ship-ledger mcp` / `ship-log mcp` directly once those bins are on PATH, e.g. via
`pnpm link --global`; `--mcp-config` works too). Tools exposed: `ledger_create/get/list/update`
(read-write) and `log_entries` / `log_rollup` / `log_sessions` (read-only). Without
registration the quartermaster degrades honestly: it says the tools are missing and points
here — it never answers from memory.

## Hooks (hooks/)

- `hooks.json` — registers `SessionStart` (`emit.mjs` + `scrutiny.mjs`), `Stop` (`emit.mjs` +
  `stop-gate.mjs`), `SessionEnd`/`Notification`/`TaskCreated`/`TaskCompleted` (`emit.mjs`),
  and `PermissionRequest` (`permission.mjs`, the BLOCKING resolver — package 6).
- `emit.mjs` — the fire-and-forget http-hook emitter. Stdlib-only, always exits 0 (fail-open).
  POSTs the envelope to a running hull (`~/.suite/services.json` discovery, 700ms timeout —
  report 04 R3: `-p` SessionEnd hooks get ~1.3-1.5s of exit grace) and spools to
  `~/.ship/spool/events.jsonl` on any failure; the next `ship serve`/`ship-log` run drains it.
- `permission.mjs` — blocking PermissionRequest resolver feeding `ship-inbox` (package 6).
- `scrutiny.mjs` / `stop-gate.mjs` — see above. Both stdlib-only, both always exit 0
  (blocking is expressed via stdout JSON, never exit codes). `SHIP_CREW_HOME` relocates the
  state dir (test seam).

All failure modes are fail-open: hull down → spool; malformed settings/stdin → default
preset/allow; a hook must never brick a session.

## Install (local, this machine — no marketplace distribution yet)

**A. Session-only:** `claude --plugin-dir <path-to-this-directory>`

**B. Persistent, project-scoped** (what the acceptance recipes and dogfood use):
```
claude plugin marketplace add <path-to-shareWork-repo-or-this-plugin-dir>
claude plugin install ship-crew --scope project
```
This writes `enabledPlugins` into that project's `.claude/settings.json` (shared, committed) —
or `--scope local` for a gitignored per-user variant. Hook changes need `/reload-plugins` or a
fresh `claude` invocation.

## Acceptance recipes

**Crew wiring (Ship_Spec §9.4, wiring level):** scratch git repo → install per (B) → add the
one settings line (`"ship": {"scrutiny": "rigorous"}`) → `claude -p "What scrutiny preset is
active and which crew pipeline applies?" --model haiku` from inside the repo. The answer names
`rigorous` and the navigator → devils-advocate → shipwright → inspector pipeline purely from
the injected briefing — zero further setup.

**Changelog capture (§9.1):** unchanged from phase 1 — two scratch repos, one tiny `-p` session
each, then `POST /api/ship-log/rollup/<date>`; fragments land in
`<repo>/changelog/entries/`, rows in `~/.ship/log.db`.

**Manual (interactive-only, not yet machine-verified):** the paranoid stop gate's block in a
live interactive session — run an interactive session in a paranoid project, try to stop
without an inspector PASS, observe the block + reason; second stop passes the loop valve.

## Dogfood recipe (this repo)

Install per (B) scoped to `shareWork` itself — every real session then produces
`changelog/entries/<date>--...--<session8>.md` fragments at the repo root (product fragments;
distinct from `suite-design/overnight/changelog/entries/`, the mission's hand-written tracking
convention). Committed by default per DECISIONS-NEEDED "Package 4" #3.
