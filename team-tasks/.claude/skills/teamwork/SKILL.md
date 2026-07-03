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
`claim_task`, `report_progress`, `submit_result`, `get_review_feedback`, `request_clarification`,
`get_clarification_answers`) must already be available in this session. If they aren't, the user
hasn't connected yet — tell them to open **Settings** in the Team Tasks app, generate a token, and
run the `claude mcp add --transport http ...` command it gives them, then retry.

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

## 5. If you need a decision only the human can make

Don't guess at ambiguous requirements or a choice between approaches — ask **the definer**
(whoever created the task) — not the person you're talking to, unless they happen to be the same
person. Call `request_clarification(task_id, questions)` with one or more structured questions
(single/multi choice, free text, a 1-10 rating, a drag-to-rank list, or a side-by-side comparison
— see the standalone `ask-human` skill's `SCHEMA.md` at the repo root for the exact question
shape, it's shared). This posts an interactive form addressed to the definer on the task's page in
the web app — but the app doesn't send them a notification yet, so tell whoever you're talking to
that a form is waiting there **for the definer** and, if that's someone else, ask them to loop the
definer in directly (message/email/Slack). Then keep working on anything that isn't blocked by the
answer. When you're ready to check, call `get_clarification_answers(task_id, request_event_id)` —
it returns `{ answered: false }` until the definer gets to it, so don't poll in a tight loop; check back
after the user tells you they've answered, or next time you're about to touch the blocked part.

## 6. Report progress

At each milestone, call `report_progress(task_id, message, checklist?)` — `checklist` is the
full updated acceptance array (mark items done as you complete them). This is what makes the
board update live for the definer; call it more than once for anything that takes a while,
not just at the end.

## 7. Hand over

Push the work branch, run `gh pr create` if available, and capture the PR URL. Call
`submit_result(task_id, pr_url, handover_md)` with a handover note covering: what's done,
what's left (if anything), and how to verify. This moves the task to `in_review` for the
definer.

## 8. If changes are requested

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
