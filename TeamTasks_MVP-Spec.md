---
id: team-tasks-mvp-spec-a-git-native-way-to-share-workload-across-repos
---

# Team Tasks — MVP Spec (a git-native way to share workload across repos)

**Prepared for:** Ondřej · **Date:** 30 June 2026
**Working name:** "Team Tasks" / the skill is `teamwork` — rename freely.
**Goal:** the smallest thing the team can start using this week, that we iterate toward the bigger vision without throwing away.

> Starter files implementing this spec are scaffolded in `shareWork/team-tasks-starter/` (a ready-to-push hub repo + the `teamwork` skill). This document explains the design; the scaffold is the thing you actually run.

---

## 0. The one use case it must fulfill

1. **I (the definer) create a spec** — a task that targets some repo.
2. **A teammate comes in**, tells their Claude *"help out with common tasks,"* and Claude does **all** the steps with minimal hand-holding:
   - pulls the shared task list, picks/【is given】a task, and **claims it** (so others see it's taken),
   - **sets up the target repo** — clones it if they don't have it, installs the shared skills/config,
   - **does the work** on a branch,
   - **reports progress** back where the definer can see it,
   - **hands the result over** (pushes a branch / opens a PR, writes a handover note, marks it for review).

That's the whole MVP. Everything else is iteration.

---

## 1. Design constraints (read these first)

- **Quick to start.** No server, no database, no auth system, no deploy. The "backend" is a **single shared git repo**. A teammate is productive in minutes.
- **Reuse, don't rebuild.** Lean on `sharpSoftAIBase` for the "set up a repo + install skills" step (its `SETUP.md` runbook and `sync.mjs` already do this well). We add only the **cross-repo task-sharing layer** on top.
- **Don't build anything that takes days.** Specifically **secrets/env sharing is deferred** — but designed as a clean seam so it can be added later without rework (see §11).
- **Don't paint ourselves into a corner.** Every primitive (task, claim, status, handover) is shaped so it can later move behind an MCP server / hosted board with the same schema. The skill becomes a thin client; the data doesn't change.

---

## 2. Architecture at a glance

Three things, all git:

```
   ┌─────────────────────────────┐         ┌──────────────────────────────┐
   │  TASK HUB repo  (new)        │         │  sharpSoftAIBase (existing)  │
   │  the shared "board" + rules  │         │  base-repo installer         │
   │  • tasks/*.md  (specs+status)│         │  • SETUP.md runbook          │
   │  • projects.md (repo registry)│        │  • scripts/sync.mjs          │
   │  • AGENTS.md   (team rules)   │  uses   │  • base/.claude/skills,hooks │
   │  • HELP.md     (zero-install) │ ──────▶ │    (base-setup, spec-workflow│
   │  • .claude/skills/teamwork    │         │     dev, run-tests, …)       │
   └──────────────┬──────────────┘         └──────────────────────────────┘
                  │ the teammate's Claude reads the hub, claims a task,
                  │ then sets up + works in the right TARGET repo
                  ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │  TARGET repos  (your actual projects: app-a, lib-b, book-c, …)        │
   │  cloned on demand · base config installed via sync.mjs · work on branch│
   └─────────────────────────────────────────────────────────────────────┘
```

- The **hub** is the only new repo. It holds the task specs, the project registry, the team rules, the one-time setup instructions, and the `teamwork` skill.
- **Target repos** are your existing projects. The teammate's Claude clones the one a task points at (if missing) and runs `sharpSoftAIBase` to install skills/hooks/config — exactly what you already do, just triggered automatically.
- **Coordination = git.** Claiming a task and reporting progress are commits to the hub. "Who's working on what" is visible because the hub is shared. No server needed for the MVP.

---

## 3. What we reuse from `sharpSoftAIBase` (no changes needed)

| Their asset | We use it for | How |
|---|---|---|
| `SETUP.md` (self-contained runbook) | The model for our `HELP.md` — "point Claude at this file, it does everything, no skill pre-installed" | We copy the *pattern* (a zero-install runbook) for the task flow |
| `scripts/sync.mjs` (`--init`/`--update`, profiles, dry-run, never overwrites local, stamps `.base-version`) | **"Set up the target repo / download skills"** | The `teamwork` skill calls `base-setup` (which runs `sync.mjs`) on the target repo |
| `base/.claude/skills/spec-workflow` (single-file spec: Spec→Research→Plan→Tasks checkboxes→running Changelog) | **The task file shape** and the "keep the spec current as the handoff artifact" rule | Our task files use the same section shape so any agent can resume mid-stream |
| `base/.claude/hooks` (`git-push-guard` = never push to main, branch+PR; `bash-guard`, `safety`) | Safety on target repos | Installed automatically with base-setup; we don't reinvent guards |
| `base/CLAUDE.template.md`, `docs/` (architecture, CONVENTIONS, ADRs) | Per-project rules the teammate's Claude reads | Installed by base-setup; our hub `AGENTS.md` adds *team-wide* rules on top |

Net: the only genuinely new code is **one skill** (`teamwork`) and **a handful of markdown files** in the hub.

---

## 4. The task hub repo layout

```
team-tasks/                     # the new shared repo (private)
├─ README.md                    # human: what it is + one-time setup + daily use
├─ HELP.md                      # the runbook Claude follows (zero-install entry point)
├─ AGENTS.md                    # team-wide conventions (symlink CLAUDE.md → AGENTS.md)
├─ projects.md                  # registry: project name → clone URL → setup profile
├─ tasks/
│  ├─ TEMPLATE.md               # copy this to create a task
│  ├─ 0001-add-healthcheck.md   # an example task (status: open)
│  └─ …                         # one file per task
├─ scripts/
│  └─ board.mjs                 # optional: prints a table of tasks by status
└─ .claude/
   └─ skills/
      └─ teamwork/SKILL.md      # the skill that drives the whole flow
```

The "board" is just `tasks/*.md`. A task's **state lives in its frontmatter**; the file is simultaneously the spec, the progress log, and the handover note (one artifact, like `spec-workflow`).

---

## 5. The task file schema (the handoff artifact)

Frontmatter carries machine-readable state; the body is the spec + live log. Schema is intentionally MCP-ready (these fields map 1:1 to a future task API).

```md
---
id: 0001
title: Add a /healthcheck endpoint
status: open            # open → claimed → in-progress → in-review → done | blocked
project: app-a          # must exist in projects.md
branch: task/0001-healthcheck
assignee:               # set on claim, e.g. "Ondřej (claude)"
priority: normal        # low | normal | high
skills: [dev, run-tests]        # base skills the worker should have
env_required: []        # names only, e.g. [DATABASE_URL] — NOT values (see §11)
updated: 2026-06-30
links: {}               # pr:, branch:, etc. filled at handover
---

## Spec
<what & why; user-facing behavior; acceptance criteria (a checklist)>

## Research            <!-- filled by the worker -->
## Plan                <!-- filled by the worker -->
## Tasks
- [ ] step 1 (`path`)
- [ ] step 2

## Progress log         <!-- append-only, newest last; one line per update -->
- 2026-06-30 claimed by Ondřej(claude)

## Handover             <!-- filled at the end -->
<branch/PR link · what's done · what's left · how to verify>
```

**Acceptance criteria as a checklist** is the definition-of-done the worker (and later, a reviewer) checks against.

---

## 6. The project registry (`projects.md`)

So Claude can "initialize the repo if they don't have it." One row per project:

```md
| name  | clone URL                          | profile               | local path (suggested) |
|-------|------------------------------------|-----------------------|------------------------|
| app-a | git@github.com:team/app-a.git      | nextjs-supabase-vercel| ../app-a               |
| lib-b | git@github.com:team/lib-b.git      | python-service        | ../lib-b               |
| book-c| git@github.com:team/book-c.git     | minimal               | ../book-c              |
```

`profile` is the `sharpSoftAIBase` profile to install. `local path` is a convention (sibling of the hub) so everyone's layout is predictable — and it's **relative**, which sidesteps the cross-machine stale-path problem.

---

## 7. Roles & lifecycle

Two roles in the MVP: **Definer** (creates tasks) and **Worker** (a teammate whose Claude does the task). A **Reviewer** role is the first post-MVP iteration (§13) — the schema already supports it via the `in-review` state.

State machine (the same worker→reviewer→done shape from the larger architecture, minus the parts we're deferring):

```
open ──claim──▶ claimed ──start──▶ in-progress ──submit──▶ in-review ──approve──▶ done
                   │                    │                      │
                   └── release ◀────────┘                      └── changes ──▶ in-progress
                                  blocked ◀── (stuck) ──┘
```

MVP stops at **in-review** (handover done, waiting for a human/Reviewer). `done` is set by the definer/reviewer. `blocked` + a Progress-log note when stuck.

---

## 8. The teammate experience

### One-time setup (small — this is the bar to clear)
1. Be added to the **hub** repo and the **target** repos (normal git access).
2. Get `sharpSoftAIBase` on the machine (clone it once, as today).
3. **Either** install the `teamwork` skill (clone the hub; the skill lives in `team-tasks/.claude/skills/` — point Claude Code's skills at it, or install the hub as a plugin) **or** skip install entirely and use the zero-install path below.
4. Make sure `git`, `gh` (optional), and `node` are available (node is needed by `sync.mjs`).

That's it — no accounts, no keys (until we add secrets in a later iteration).

### Daily use
The teammate opens Claude **in the hub folder** (or anywhere, if the skill is installed globally) and says:

> "Help out with common tasks."   — or —   "Pick up task 0001."   — or —   (zero-install) "Read `team-tasks/HELP.md` and help out."

Claude then runs the flow in §9. The teammate watches and answers the occasional question; otherwise Claude drives.

---

## 9. The `teamwork` skill (what Claude actually does)

The skill encodes this procedure (full text in the scaffold). Each step names the future MCP operation it stands in for, so the skill can later become a thin MCP client without changing behavior.

1. **Sync the hub** → `git pull` (clone if missing). *(future: `list_tasks`)*
2. **Show the board** → parse `tasks/*.md` frontmatter; list `open` tasks (and who holds the rest). Let the user pick, or take the named task. *(future: `list_available_tasks`)*
3. **Claim** → set `status: claimed`, `assignee`, `updated`; append to Progress log; commit `task(0001): claim` and **push**. If push is rejected, `pull --rebase` and retry; if the task is already claimed by someone else, offer another. *(future: `claim_task`, with real locking)*
4. **Resolve the target repo** → read `projects.md`; if the local path is missing, `git clone` it; then run the **`base-setup`** skill (`sync.mjs --init/--update --profile <profile>`) to install skills/hooks/config. *(future: `get_task_package`)*
5. **Work** → `status: in-progress`; create the `branch`; follow the **`spec-workflow`** skill (research → plan → implement, flipping `- [ ]` → `- [x]`). Never push to `main` (a hook blocks it anyway). *(future: same, just authenticated)*
6. **Report progress** → on meaningful milestones, append one line to the task's Progress log + flip checkboxes, commit `task(0001): progress …` and push the **hub**. *(future: `report_progress`)*
7. **Hand over** → push the work branch on the target repo; open a PR (`gh pr create`) if available; fill the **Handover** section (PR/branch link, done/left, how to verify); set `status: in-review`; commit + push hub. *(future: `submit_result`)*
8. **Stop conditions** → if blocked or out of scope, set `status: blocked` (or release the claim), note why in the Progress log, push, and tell the user. Never silently abandon.

Guardrails baked into the skill: only write inside the hub and the one target repo; branch + PR, never push `main`; never invent project IDs or secrets; keep the task file current (a half-done checklist with nothing flipped is worse than none).

---

## 10. Concurrency, safety & git conventions

- **Claiming is a push.** Small team → conflicts are rare and git resolves them. The skill always `pull --rebase`s before claiming and re-checks the task isn't already taken. (Good enough for the MVP; a server adds real locking later.)
- **One commit convention:** `task(<id>): <claim|progress|handover|block> — <note>` in the hub; normal commits in target repos.
- **Branch + PR always**; `git-push-guard` from `sharpSoftAIBase` enforces "never push to main."
- **Safety hooks** (bash-guard, safety) come with base-setup — agents run under the same guards on every target repo.

---

## 11. Deferred — but with the seam left open

| Deferred | Why now-skip is safe | The seam that keeps it unblocked |
|---|---|---|
| **Secrets / env sharing** | A real broker (Vault + short-lived tokens) is days of setup | Tasks declare `env_required: [NAME]` (names only). MVP: the skill checks the target repo's `.env`/environment and, if missing, tells the teammate what to provide locally. Later: a broker fulfills `env_required` automatically — **the task schema doesn't change.** |
| **Reviewer step / approval** | Adds a second role + UI | `in-review` state + Handover section already exist. A reviewer's Claude can later pick up `in-review` tasks, read the PR, and set `done`/`changes`. No schema change. |
| **Hosted board / MCP server** | Server + DB + auth is the big build | Every skill step maps to a named task operation (§9). Swap "read/commit markdown" for "call MCP tool" later; the task fields are identical. |
| **Live presence** | Needs realtime infra | "Who's working on what" is the hub's claimed-task list today; realtime is a nicer view of the same data later. |
| **Non-code work (docs/books/art)** | Nothing special needed | `project` can be any repo, `skills`/`profile` can be `minimal`; the flow is identical. Already works. |

The rule: **never put a value where a reference belongs, and never let a step assume a server.** Follow that and none of the above requires a rewrite.

---

## 12. Build checklist (to go live this week)

1. **Create the hub repo** from `shareWork/team-tasks-starter/` (push it private). *(scaffold provided)*
2. **Fill `projects.md`** with your real repos + clone URLs + profiles.
3. **Write 2–3 real tasks** from `tasks/TEMPLATE.md`.
4. **Confirm `sharpSoftAIBase` is reachable** on each teammate's machine (clone + `SHARP_BASE_DIR` env or sibling dir).
5. **Distribute the `teamwork` skill** — simplest: everyone clones the hub and points Claude Code skills at `team-tasks/.claude/skills/`; or package the hub as a plugin later.
6. **Dry-run with one teammate**: have them say "help out," watch the full claim → setup → work → handover loop on a throwaway task. Fix friction.
7. Iterate.

If steps 1–6 take more than an afternoon, something's been over-built — push back to the markdown-and-one-skill core.

---

## 13. Iteration path (so this grows into the real thing)

1. **MVP (this doc):** git hub + `teamwork` skill. Define → claim → set up → work → report → hand over.
2. **+ Review:** a Reviewer role picks up `in-review`, their Claude reviews the PR against the acceptance checklist, sets `done`/`changes-requested`. (This is the "PR-review for any work" primitive.)
3. **+ Secrets broker:** fulfill `env_required` via Supabase Vault + short-lived tokens (the architecture in `Coworking-Platform_Research-and-Architecture.md`).
4. **+ Hosted board / MCP server:** move the task list behind an MCP server on Vercel (Supabase OAuth → agent authenticates as a user, RLS applies); the `teamwork` skill becomes a thin client. Adds real locking, presence, and public projects.
5. **+ Doc/reference engine & anti-staleness gates** (the `Staleness-Linters-MCPs_Toolkit.md` stack) so handovers can't ship stale docs.

Each step reuses the previous step's schema. Nothing here is throwaway.

---

*Cross-references: bigger architecture in `Coworking-Platform_Research-and-Architecture.md`; the merge/scope reasoning in `Ship-vs-Platform_Strategy-and-Verdict.md`; the enforce-quality toolkit in `Staleness-Linters-MCPs_Toolkit.md`.*
