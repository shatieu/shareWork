---
name: teamwork
description: Help out with shared team tasks over the Team Tasks MCP server. Lists open tasks, claims one, sets up the target repo (clone + sharpSoftAIBase base-setup), does the work on a branch, reports progress live, and hands over with a PR. Use when the user says "help out", "pick up a task", "what can I help with", or names a task.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# teamwork

Drives the Team Tasks loop end-to-end by calling the **hosted MCP server** — no shared git
repo, no markdown files. The definer created the task in the Team Tasks web app; you connect
to their team once, then this skill claims work, does it locally, and reports back live.

## 0. Confirm the MCP connection

The `team-tasks` MCP server's tools (`list_projects`, `list_available_tasks`, `get_task`,
`claim_task`, `report_progress`, `submit_result`, `get_review_feedback`) must already be
available in this session. If they aren't, the user hasn't connected yet — tell them to open
**Settings** in the Team Tasks app, generate a token, and run the `claude mcp add --transport
http ...` command it gives them, then retry.

**WORKSPACE** = where target repos live locally. Default to the current directory's parent, or
ask if ambiguous. **BASE_DIR** = the `sharpSoftAIBase` repo: `SHARP_BASE_DIR` env, else a
sibling directory, else ask. Verify it has `manifest.json` and `scripts/sync.mjs`.

## 1. List available work

Call `list_available_tasks` (optionally with a `project_id`). If the user named a task, call
`get_task` for it directly instead. Show open tasks (title, project, priority) and **confirm
which one to claim** before doing anything — never guess silently.

## 2. Claim it

Call `claim_task(task_id)`. It sets you as assignee and returns the task plus the project's
`repo_url`, `setup_profile`, and `default_branch` — this replaces reading `projects.md` from a
hub repo. If it fails because the task was just claimed by someone else, go back to step 1.

## 3. Set up the target repo

- Missing locally in WORKSPACE → `git clone <repo_url>`.
- Run **base-setup** to install shared skills/hooks/config (dry-run first, then apply):
  ```bash
  node "BASE_DIR/scripts/sync.mjs" --init --profile <setup_profile> --target "<targetPath>" --dry-run
  ```
  Use `--update` if the target already has `.claude/.base-version`. Show the plan, then apply.
- For each name in the task's `env_required`, check the target's `.env`/environment. If
  missing, tell the user exactly which to set locally and proceed with what's possible.
  **Never fetch or invent secrets** — secret sharing is deferred by design; only names are
  ever shared, values stay local.

## 4. Work

Create the branch (`task/<short-id>-<slug>`, based on the task title, off `default_branch`).
Follow the **spec-workflow** skill (now installed in the target) to turn the task's spec +
acceptance criteria into a plan and implement it. Work only inside the target repo. Branch +
PR — **never push `main`** (a hook enforces it; don't fight the hook).

## 5. Report progress

At each milestone, call `report_progress(task_id, message, checklist?)` — `checklist` is the
full updated acceptance array (mark items done as you complete them). This is what makes the
board update live for the definer; call it more than once for anything that takes a while,
not just at the end.

## 6. Hand over

Push the work branch, run `gh pr create` if available, and capture the PR URL. Call
`submit_result(task_id, pr_url, handover_md)` with a handover note covering: what's done,
what's left (if anything), and how to verify. This moves the task to `in_review` for the
definer.

## 7. If changes are requested

Call `get_review_feedback(task_id)` to read the reviewer's comments, address them on the same
branch, push, and call `submit_result` again with an updated handover note.

## Stop conditions

Blocked or out of scope → call `report_progress` explaining why and tell the user directly.
Never silently abandon a claimed task — if you truly can't continue, say so so a human can
reassign it.

## Rules

- Write only inside the **one** target repo (plus reading BASE_DIR to run its setup script).
  Never touch other repos.
- Branch + PR; never push `main`. Never commit secrets or `.env`.
- Never invent repo URLs, project ids, or secret values — the MCP tools are the source of
  truth; ask the user if something they return doesn't make sense.
- Follow the target repo's own `CLAUDE.md` / `docs/CONVENTIONS.md` (installed by
  sharpSoftAIBase) for that project's specific rules.
