# HELP — Run the Team Tasks flow (runbook for Claude)

> **You are Claude. A teammate pointed you at this file (or ran the `teamwork` skill) and
> wants to "help out."** This is a self-contained runbook — you do not need any skill
> pre-installed. Follow it top to bottom. Be efficient; only stop for the confirmations noted.

## 0. Establish paths
- **HUB** = the directory containing this file (the `team-tasks` repo).
- **BASE_DIR** = the `sharpSoftAIBase` repo (from `SHARP_BASE_DIR`, or a sibling dir, else ask).
  It must contain `manifest.json` and `scripts/sync.mjs`.
- **WORKSPACE** = where target repos are cloned. Default: the HUB's parent dir (so projects sit
  as siblings of the hub), unless the user says otherwise. Prefer **relative** layouts.

## 1. Sync the board
`git -C "HUB" pull --rebase` (clone first if HUB isn't a repo yet). Then read `tasks/*.md`
frontmatter.

## 2. Show the board, pick a task
List tasks with `status: open` (id, title, project, priority). Also show what's already
`claimed`/`in-progress` and by whom, so nothing is double-taken. If the user named a task, use
it; otherwise propose the best open one (priority, then lowest id) and confirm. **[confirmation 1]**

## 3. Claim it
Edit the chosen task file: `status: claimed`, `assignee: <name> (claude)`, `updated: <today>`;
append `- <today> claimed by <name>` to **Progress log**. Commit `task(<id>): claim` and push.
- If push is rejected: `git pull --rebase` and retry.
- If the file already shows another `assignee`: it was just taken — go back to step 2.

## 4. Set up the target repo
Read `projects.md` for the task's `project`: get its clone URL, profile, and local path.
- If the local path is missing, `git clone <url>` into WORKSPACE.
- Install/refresh shared config by running **base-setup** (i.e. `sharpSoftAIBase`):
  ```bash
  node "BASE_DIR/scripts/sync.mjs" --init --profile <profile> --target "<targetPath>" --dry-run
  ```
  Show the plan, then re-run without `--dry-run` to apply. Use `--update` if the target already
  has `.claude/.base-version`. This installs the skills (`spec-workflow`, `dev`, `run-tests`, …)
  and safety hooks. **[confirmation 2 — applying base-setup]**
- Check `env_required` in the task frontmatter. For each name, check the target's `.env`/
  environment. If any are missing, **tell the user which to provide locally** and continue with
  whatever doesn't need them (do not invent or fetch secrets — that's deferred).

## 5. Do the work
Set `status: in-progress` (commit `task(<id>): start`, push). Create the task's `branch` in the
target repo. Follow the **spec-workflow** skill now installed in the target: fill Research →
Plan → implement the Tasks, flipping `- [ ]` → `- [x]` as you go. Work only inside the target
repo. **Never push to `main`** — branch + PR (a hook enforces this).

## 6. Report progress
At each meaningful milestone: in the HUB task file, flip the relevant checkboxes and append one
line to **Progress log**; commit `task(<id>): progress — <note>` and push. This is how the
definer sees how far you got.

## 7. Hand over
- Push the work branch on the target repo. If `gh` is available: `gh pr create` and capture the
  URL.
- In the HUB task file: fill **Handover** (PR/branch link, what's done, what's left, how to
  verify), set `links:` accordingly, set `status: in-review`, `updated: <today>`, append a
  Progress-log line. Commit `task(<id>): handover` and push.
- Tell the user it's ready for review, with the PR link and the one-line "how to verify."

## Stop conditions
If blocked or the task is out of scope: set `status: blocked` (or revert to `open` and clear
`assignee` to release it), note why in **Progress log**, push, and tell the user. Never silently
abandon a claimed task — leaving the file current is the whole point.

## Guardrails
- Only write inside HUB and the **one** target repo for the task. Never touch BASE_DIR or other
  repos.
- Branch + PR; never push `main`. Don't commit secrets or `.env` files.
- Never invent project IDs, URLs, or secret values. If unknown, ask.
- Keep the task file current at every step — a half-done checklist with nothing flipped is worse
  than none.
