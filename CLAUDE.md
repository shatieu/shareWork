# shareWork

## Chart Room (managed markdown docs)

This repo's markdown docs are managed by Chart Room. Doc links carry a hidden `id:` (see the link's
title attribute, `"id:<id>"`) that survives moves/renames -- if a linked path 404s, don't ask the
human where it went: read `.docs/index.json` directly, or run `chartroom resolve <id-or-path>`. See
the `chart-room` skill for the full workflow (id-based links, `:::llm`/`:::human` blocks, `:::ask-me`
questions).

Doc discovery is scoped by the root `.chartroomignore` -- `team-tasks/`, templates, byte-exact test
fixtures, `.claude/`, and kickoff prompts are deliberately unmanaged. Never inject frontmatter there.
