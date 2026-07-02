# Team Tasks

A dead-simple, git-native way to share work across the team and across repos. One person
writes a task; a teammate tells their Claude **"help out,"** and Claude claims it, sets up
the right repo, does the work, reports progress, and hands it back — all through this repo.

No server, no database, no accounts. The shared git repo *is* the board.

## What's here

| Path | What it is |
|---|---|
| `HELP.md` | The runbook your Claude follows. Zero install: point Claude here and say "help out". |
| `AGENTS.md` | Team-wide conventions every teammate's Claude should follow. |
| `projects.md` | Registry of our repos (name → clone URL → setup profile). |
| `tasks/` | One markdown file per task. The file is the spec **and** the progress log **and** the handover. |
| `tasks/TEMPLATE.md` | Copy this to create a task. |
| `scripts/board.mjs` | Optional: `node scripts/board.mjs` prints the board grouped by status. |
| `.claude/skills/teamwork/` | The `teamwork` skill (the installed version of `HELP.md`). |

## One-time setup (per teammate)

1. Get added to this repo and to the target repos you'll touch.
2. Clone **sharpSoftAIBase** somewhere and set `SHARP_BASE_DIR` to it (or keep it as a sibling
   folder). It's what installs per-project skills/hooks/config.
3. Clone this repo. Make sure `git`, `node`, and (optionally) `gh` are installed.
4. *(optional, nicer)* Point Claude Code at `.claude/skills/` here so the `teamwork` skill is
   always available. Otherwise just use the zero-install path below.

## Daily use

### If you're handing out work (Definer)
1. `cp tasks/TEMPLATE.md tasks/0002-my-task.md`, fill in the **Spec** and acceptance criteria,
   set `project:` to a name from `projects.md`, leave `status: open`.
2. Commit & push. Done — it's now on the board.

### If you're helping out (Worker)
Open Claude in this folder and say one of:
- **"Help out with common tasks."**
- **"Pick up task 0002."**
- *(zero-install)* **"Read HELP.md and help out."**

Claude pulls the latest board, claims a task, clones/sets up the target repo, works on a
branch, pushes progress back here, and opens a PR. You watch and answer the occasional
question.

## See who's working on what

```bash
git pull
node scripts/board.mjs      # or just read the `status:`/`assignee:` lines in tasks/*.md
```

## Not yet (on purpose)

Secret/env sharing isn't built yet — a task lists the env var **names** it needs
(`env_required:`) and you provide the values locally. Everything is designed so a real secret
broker, a reviewer step, and a hosted board can be added later **without changing how tasks
look**. See `../TeamTasks_MVP-Spec.md` for the full design and the iteration path.
