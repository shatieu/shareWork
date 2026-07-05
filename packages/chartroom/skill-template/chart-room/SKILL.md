---
name: chart-room
description: Standing behavior for repos whose markdown docs are managed by Chart Room -- resolve a moved/renamed doc by id instead of asking a human where it went, write links in id-carrying format, skip :::human blocks when reading for token efficiency, and post/check :::ask-me questions. Applies any time you're about to Read, Write, or link a markdown doc in a repo that has a .docs/index.json or a "Chart Room" section in its CLAUDE.md.
allowed-tools: Read, Write, Edit, Grep, Bash
---

# chart-room

Chart Room keeps this repo's markdown docs resolvable even after files move or get renamed: every
doc gets a hidden `id:` that link targets carry alongside their path, so a stale path is a recovery
case, not a dead end. This is a **standing behavior**, not a one-shot command like `/ask-human` --
it applies any time a doc Read fails or you're about to write a link, for as long as you're working
in a Chart-Room-managed repo.

## When to use this

You're in scope for this skill if any of the following is true:
- The repo has a `.docs/index.json` (check with a plain `Read` or `Glob` -- no tooling required).
- The repo's `CLAUDE.md` has a "Chart Room" section (see the template line it documents).
- The human or task mentions "chart room" or "resolve this doc link."

If none of those are true, this skill doesn't apply -- treat markdown docs as plain files.

## Steps

### 1. Resolving a dead path

When a `Read` on a `.md` path fails (or a link just looks stale), try these in order, cheapest
first -- all three are equivalent, just different speeds:

1. **Read `.docs/index.json` directly.** It's a plain JSON file (`docs`, keyed by id, each with a
   `path`; `deleted`, keyed by id, for tombstoned docs with `lastPath`/`deletedAt`). Zero tooling
   needed -- this always works, per Chart Room's own design: every mechanism has to work for an
   agent using nothing but `Read` and `Grep`.
2. **Run `chartroom resolve <id-or-path>` (or `--json` for a structured result)** if the CLI is
   available. Faster than reading the whole index by hand.
3. **Call the MCP `resolve` tool** (same query, same result shape) if this session is connected to
   this repo's `chartroom mcp` server.

Any of the three tells you the doc's current path (or that it was deleted, with when). Don't ask a
human where the file went before trying at least one of these.

### 2. Writing links

When linking to a Chart-Room-managed doc (one with a frontmatter `id:`), always write the link in
`[text](path "id:<id>")` format -- the `title` attribute carries the id, the visible `path` is just
a convenience for anyone reading the raw file. Never write a bare `[text](path)` link to such a doc.

```markdown
See the [resolution algorithm](../specs/resolver.md "id:resolver-algo") for the exact steps.
```

A pre-commit hook (installed by `chartroom init`) repairs stale `path`s in already-linked docs
automatically on commit -- but only if the link carries the `id:` in the first place. A bare path
link to a doc that later moves has nothing to repair it by.

### 3. `:::llm` / `:::human` blocks

Some docs contain directive blocks that split content by audience:

- `:::llm{tldr="..."}` -- content written primarily for an agent (a terse summary, a decision
  rationale). Read this normally.
- `:::human` -- content that's decorative or narrative for a human reader (a longer story, a
  screenshot caption). **Skip reading the body of a `:::human` block closely** when you're reading
  for token efficiency -- its own `tldr`/summary (if present) is enough context; the full body is
  there for a human, not for you.

### 4. Posting a question, checking back for an answer

To ask a question that belongs embedded in a specific doc's own decision record (not a general
clarification -- see Notes below for that case), write a `:::ask-me` block directly with a normal
file edit -- no tooling required to write one:

```markdown
:::ask-me{id="db-choice" type="yesno"}
Should we use Postgres for this feature instead of the existing SQLite store?
:::
```

To check whether it's been answered later, either:
- Re-`Read` the file directly -- an answered block carries `answered="true"` on its opening fence
  plus a `> **Answer** (date, author): ...` line, both plain visible text.
- Call the MCP `answer_status(question_id)` tool, or `chartroom check`, if available -- same
  information, faster to check across many docs at once.

There's no tool to submit an answer as an agent -- answering is a human action in the Chart Room
browser viewer, by design.

## Notes

- **`ask-human` vs. `chart-room`'s `:::ask-me`**: use the `ask-human` skill (this repo's other
  skill) when you need to ask a human something with no pre-existing doc/directive context -- a
  plain multi-question form, answered once, no ongoing record. Use `:::ask-me` when the question
  belongs embedded in a specific doc's own decision record, answerable later by anyone reading that
  doc, not just the person who answered it live. These are complementary, not redundant.
- Every mechanism this skill describes works with plain `Read`/`Write`/`Grep` if no CLI or MCP
  server is installed -- the CLI and MCP tools are acceleration, never a dependency.
- If `chartroom resolve` or the MCP tools aren't available (not installed, daemon not running),
  fall back to reading `.docs/index.json` directly -- don't treat their absence as a blocker.
