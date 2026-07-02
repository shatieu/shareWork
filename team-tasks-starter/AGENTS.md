# Team conventions (read this before working a task)

> This is the team-wide rulebook. Per-project rules live in each target repo's `CLAUDE.md` /
> `docs/` (installed by sharpSoftAIBase). For Claude Code, symlink `CLAUDE.md` → `AGENTS.md`
> so it's picked up natively.

## How we share work
- Tasks live in `tasks/*.md` in this hub. The task file is the single source of truth for that
  task: spec, progress, and handover all in one file. Keep it current.
- Claim before you work (`status: claimed` + your name). Don't work a task someone else holds.
- One task → one branch → one PR. Report progress back to the hub as you go.

## Git
- Branch naming: `task/<id>-<slug>` (matches the task's `branch:` field).
- Never push to `main` on any repo — branch + PR. (A hook blocks it; don't fight the hook.)
- Hub commits: `task(<id>): <claim|start|progress|handover|block> — <note>`.
- Never commit secrets, `.env`, or credentials. Add to `.gitignore` if you see them untracked.

## Definition of done (a task is ready for review when…)
- All acceptance-criteria checkboxes in the task's **Spec** are checked.
- Tests pass (`run-tests` skill in the target repo).
- The **Handover** section is filled: PR/branch link, what's done, what's left, how to verify.
- `status: in-review`.

## Quality bar
- Follow the target repo's existing patterns and its `docs/CONVENTIONS.md`.
- Update the target's docs/changelog if behavior or structure changed (don't leave docs stale).
- Small, reviewable changes over big-bang PRs.

## What NOT to do (yet)
- Don't try to fetch or share secrets through the hub. Tasks name the env vars they need
  (`env_required:`); values are provided locally by the worker. Secret sharing is a later
  iteration.
- Don't invent project URLs or IDs — if a task's `project` isn't in `projects.md`, ask the
  definer to add it.
