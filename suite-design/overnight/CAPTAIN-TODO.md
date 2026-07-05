---
id: captain-todo-parked-integration-steps
---

# Captain TODO — parked integration steps

Each entry: one line **what**, one line **how**. These are the human-only steps
(credentials, live infra, supervised sessions) left after a package was built
to its seam. See the parking protocol in MARATHON-KICKOFF-PROMPT §4.

- **Install the Chart Room PostToolUseFailure agent hook** (package 01-housekeeping-dogfood; the
  session permission system blocked the agent from writing `.claude/hooks/` + `.claude/settings.json`
  itself — agent self-modification of live config needs a human run).
  How: from the repo root, `node packages/chartroom/dist/cli.js install-agent-hook` (idempotent).
- **Install the Chart Room pre-commit hook, post-merge** (deliberately deferred by FO direction —
  working-copy-global, must not fire before the dogfood id commit merges to `ship-wave1`).
  How: on `ship-wave1` after the merge, `node packages/chartroom/dist/cli.js init` once (idempotent,
  0 new ids, installs `.git/hooks/pre-commit`).
