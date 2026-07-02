---
name: teamwork
description: Help out with shared team tasks. Pulls the team-tasks hub, lists open tasks, claims one, sets up the target repo (clone + sharpSoftAIBase base-setup), does the work on a branch via spec-workflow, reports progress back to the hub, and hands over with a PR. Use when the user says "help out", "pick up a task", "what can I help with", or names a task id.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# teamwork

The installed version of the hub's `HELP.md`. Lets a teammate's Claude pick up work that
someone else defined, do it end-to-end, and hand it back — coordinating entirely through a
shared git repo (the **hub**). Each step notes the future MCP operation it stands in for, so
this skill can later become a thin client of a hosted board without changing behavior.

## 0. Establish paths
- **HUB** = the `team-tasks` repo (this skill lives in `HUB/.claude/skills/teamwork/`). If run
  from elsewhere, ask for the hub path or clone it.
- **BASE_DIR** = the `sharpSoftAIBase` repo: `SHARP_BASE_DIR` env, else a sibling dir, else ask.
  Verify it has `manifest.json` and `scripts/sync.mjs`.
- **WORKSPACE** = where target repos live. Default to HUB's parent dir; prefer relative layouts.

## 1. Sync the board   ·  (future: list_tasks)
`git -C HUB pull --rebase` (clone if needed). Read `HUB/tasks/*.md` frontmatter.

## 2. Pick a task   ·  (future: list_available_tasks)
Show `status: open` tasks (id, title, project, priority) and note which are already taken and by
whom. Use the task the user named, or propose the best open one (priority, then lowest id) and
**confirm before claiming**.

## 3. Claim   ·  (future: claim_task)
In the task file set `status: claimed`, `assignee: <name> (claude)`, `updated: <today>`; append
`- <today> claimed by <name>` to **Progress log**. Commit `task(<id>): claim` and push.
- Push rejected → `git pull --rebase`, retry.
- Already assigned to someone else → it was just taken; return to step 2.

## 4. Set up the target repo   ·  (future: get_task_package)
From `HUB/projects.md`, resolve the task's `project` → clone URL, profile, local path.
- Missing locally → `git clone <url>` into WORKSPACE.
- Run **base-setup** to install shared skills/hooks/config (dry-run first, then apply):
  ```bash
  node "BASE_DIR/scripts/sync.mjs" --init --profile <profile> --target "<targetPath>" --dry-run
  ```
  Use `--update` if the target already has `.claude/.base-version`. Show the plan, then apply.
- For each name in `env_required`, check the target's `.env`/environment. If missing, tell the
  user exactly which to set locally and proceed with what's possible. **Never fetch or invent
  secrets** — secret sharing is deferred by design.

## 5. Work   ·  (future: report_progress / same)
Set `status: in-progress` (commit `task(<id>): start`, push). Create the task's `branch` in the
target. Follow the **spec-workflow** skill (now installed there): fill Research → Plan →
implement Tasks, flipping `- [ ]` → `- [x]`. Work only inside the target repo. Branch + PR —
**never push `main`** (a hook enforces it).

## 6. Report progress   ·  (future: report_progress)
At each milestone: in the HUB task file flip checkboxes and append one line to **Progress log**;
commit `task(<id>): progress — <note>` and push. This is how the definer sees how far you got.

## 7. Hand over   ·  (future: submit_result)
- Push the work branch; `gh pr create` if available, capture the URL.
- In the HUB task file fill **Handover** (PR/branch link, done, left, how to verify), set
  `links:`, `status: in-review`, `updated`; append a Progress-log line. Commit
  `task(<id>): handover` and push.
- Report back to the user with the PR link and the one-line "how to verify".

## Stop conditions
Blocked or out of scope → set `status: blocked` (or revert to `open` and clear `assignee` to
release), note why in **Progress log**, push, and tell the user. Never silently abandon.

## Rules
- Write only inside HUB and the **one** target repo. Never touch BASE_DIR or sibling repos.
- Branch + PR; never push `main`. Never commit secrets or `.env`.
- Never invent project IDs/URLs/secret values — ask.
- Keep the task file current at every step; it is the handoff artifact. A half-done checklist
  with nothing flipped is worse than none.
- Follow `HUB/AGENTS.md` and the target repo's `CLAUDE.md`/`docs/CONVENTIONS.md`.
