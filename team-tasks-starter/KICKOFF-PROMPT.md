# Kickoff prompt for Claude Code

Run Claude Code from `C:\thisismydesign\` (so it can see shareWork, sharpSoftAIBase, and your
project repos), then paste the prompt below.

---

You're standing up **"Team Tasks"** — a git-native way for our team to share work across repos.
The design is already written; your job is to make it real and validate it, not redesign it.

**Read these first, in order:**
1. `C:\thisismydesign\shareWork\TeamTasks_MVP-Spec.md` — the full MVP spec.
2. `C:\thisismydesign\shareWork\team-tasks-starter\` — a ready-made scaffold of the hub repo
   (README, HELP.md, AGENTS.md, projects.md, tasks/, scripts/board.mjs, .claude/skills/teamwork).
3. `C:\thisismydesign\sharpSoftAIBase\` — our existing base-repo installer (`SETUP.md` +
   `scripts/sync.mjs`). The flow reuses this **as-is** to set up target repos. Read its
   `SETUP.md` and `base/.claude/skills/` to understand it. **Do not modify it.**

**Constraints (important):**
- MVP we want to use THIS WEEK. Keep it simple — the "backend" is just a shared git repo. No
  server, no database, no auth.
- Reuse sharpSoftAIBase for the "clone repo + install skills" step. Don't reinvent it.
- Do NOT build secret/env sharing, a hosted server, or a reviewer UI yet — but don't do anything
  that blocks adding them later (tasks already declare `env_required` by name; keep that seam).
- Branch + PR, never push to `main`. Ask before anything destructive or anything that touches a
  remote.

**Do this:**
1. Read the three sources. Then tell me, critically, anything in the spec/scaffold that looks
   wrong, risky, or over-built for an MVP.
2. Ask me for what you can't know: our git host + org, the real repos for `projects.md`
   (name → clone URL → sharpSoftAIBase profile), where sharpSoftAIBase lives / `SHARP_BASE_DIR`,
   and where the hub repo should live (default `C:\thisismydesign\team-tasks` as a sibling so
   the relative paths in `projects.md` work).
3. Create the real hub at `C:\thisismydesign\team-tasks` from the scaffold: copy the files,
   `git init`, fill `projects.md` with the repos I give you, and write 1–2 real tasks from
   `tasks/TEMPLATE.md`.
4. Validate without breaking anything: run `node scripts/board.mjs` (should list tasks), and
   **dry-run** the target-repo setup with `node <base>/scripts/sync.mjs --init --profile <p>
   --target <repo> --dry-run` against one real repo so we see the plan. Don't apply unless I say so.
5. Paper-walk the `teamwork` skill against a real task: tell me exactly what you'd do at each
   step (claim → set up → work → progress → handover) so we catch gaps before a teammate uses it.
6. Summarize what's set up, what I still need to do (push the hub to our git host, grant access),
   and any rough edges.

**Start by reading the sources, then ask your clarifying questions and propose a short plan.
Don't make changes until I confirm.**

---

**Shorter variant (if you just want to dive in):**

> Read `C:\thisismydesign\shareWork\TeamTasks_MVP-Spec.md` and the `team-tasks-starter/` scaffold
> next to it, plus `C:\thisismydesign\sharpSoftAIBase\SETUP.md`. Stand up the hub repo for real at
> `C:\thisismydesign\team-tasks` from the scaffold. Ask me for our repo URLs/org and where
> sharpSoftAIBase lives, fill `projects.md`, and dry-run one target-repo setup. Keep it MVP — no
> server/DB/secrets. Ask questions and show a plan before changing anything.
