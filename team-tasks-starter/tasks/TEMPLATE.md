---
id: 0000
title: <short imperative title>
status: open            # open → claimed → in-progress → in-review → done | blocked
project: app-a          # must match a name in projects.md
branch: task/0000-slug
assignee:               # set on claim, e.g. "Ondřej (claude)"
priority: normal        # low | normal | high
skills: [dev, run-tests]
env_required: []        # NAMES only, e.g. [DATABASE_URL] — never values
updated: 2026-06-30
links: {}               # filled at handover, e.g. { pr: "...", branch: "..." }
---

## Spec
<What & why. The user-facing behavior. Then acceptance criteria as a checklist — this is the
definition of done a reviewer will check against:>

- [ ] <acceptance criterion 1>
- [ ] <acceptance criterion 2>

## Research
<!-- worker fills: relevant files, current patterns, constraints, resolved questions -->

## Plan
<!-- worker fills: approach, files to touch, key decisions (ADR-worthy? note it) -->

## Tasks
- [ ] <step 1> (`path/to/file`)
- [ ] <step 2>

## Progress log
<!-- append-only, newest last; one line per update -->

## Handover
<!-- branch/PR link · what's done · what's left · how to verify -->
