---
name: ask-human
description: Hand a set of clarification questions to the human as an interactive local web page (choices, free text, ratings, rankings, comparisons, pasted screenshots/docs) instead of a back-and-forth markdown file. Use whenever spec-driven work hits an ambiguous requirement, a choice between approaches, or any decision only the human can make. Triggers on "/ask-human", "ask the human", "I need clarification", or similar.
allowed-tools: Read, Write, Bash, PowerShell
---

# ask-human

Turns a list of questions into a self-contained, interactive HTML page, hands the human a
clickable local link, and lets you read their answers back once they're done — richer than plain
multiple choice (free text, 1-10 ratings, drag-to-rank, side-by-side comparisons, pasted
screenshots/docs), with pre-filled suggested answers the human can accept or edit.

No polling. You start the page, hand over the link, and end your turn. The human tells you when
they're done; you read the answers file.

## When to use this

Use it when you'd otherwise have to ask the human several questions in plain chat and the
questions benefit from structure — multiple related decisions, options worth comparing side by
side, a rating/scale, a priority ranking, or anything where showing a code/spec excerpt for
context helps. For a single trivial yes/no question, just ask in chat instead — this skill is for
when composing a small form is clearly easier for the human than a wall of chat text.

## Steps

### 1. Pick a session id and write the spec

Choose a short kebab-case id describing the topic, e.g. `auth-strategy`. Create the session
directory and write `spec.json` there:

```
.claude/ask-human/sessions/<sessionId>/spec.json
```

The spec is a JSON array of questions. See `SCHEMA.md` in this skill directory for the full
schema and `examples/example-spec.json` for one of every question type to copy from. Keep
questions focused — don't pad the form with things you could reasonably decide yourself.

Every question can carry:
- `context` — a markdown/code blurb for background (a spec excerpt, a diff, current behavior)
- `suggested` — a pre-filled default the human can accept as-is or edit
- `allowAttachment: false` — set this to turn off paste/upload on a question that doesn't need it
  (attachments are allowed by default)

### 2. Start the page

Run the skill's server against the session directory:

```
node "<path-to-this-skill>/bin/server.mjs" ".claude/ask-human/sessions/<sessionId>"
```

Run this in the background (it stays alive to receive the submission). It prints a line like:

```
ASK_HUMAN_URL: http://localhost:8765/
```

If `spec.json` is malformed, the script exits with a clear error instead of starting a broken
page — fix the spec and re-run.

### 3. Hand over the link and stop

Tell the human something like:

> I've got a few questions — answer them here: http://localhost:8765/ — let me know when you're
> done, or if anything's unclear.

Then end your turn. Do not poll or wait in a loop — the human may take a while.

### 4. Read the answers back

When the human indicates they're done, read:

```
.claude/ask-human/sessions/<sessionId>/answers.json
```

It mirrors the spec: one entry per question with `id`, `type`, `value`, and an `attachments` array
of relative file paths (if any were pasted/uploaded). Read any attachment files directly with your
Read tool (it handles images and PDFs) — paths are relative to the session directory.

### 5. Stop the server

Read `server.pid` from the session directory and stop that process:
- Windows (PowerShell): `Stop-Process -Id <pid> -Force`
- macOS/Linux: `kill <pid>`

If the process is already gone, that's fine — nothing else to clean up. Leave the session
directory in place (it's gitignored); don't delete it unless the human asks you to.

## Notes

- This repo's `team-tasks` app has a hosted counterpart: the MCP tools `request_clarification` /
  `get_clarification_answers` post the same question schema as an inline form on the task's page
  instead of a local server, for when the person who needs to answer isn't at this machine. Use
  this local skill when working solo or when the human is right here; use the MCP tools when
  running as a teammate's agent against the Team Tasks board.
- Zero npm dependencies — `server.mjs` only uses Node's built-ins, so this works in any project
  with no install step. Node is guaranteed present since Claude Code itself runs on it.
- Portable: copying this entire `ask-human` folder into another repo's `.claude/skills/` is enough
  to use it there.
- If the port is busy, the server tries the next few ports automatically — just use whatever URL
  it prints, not an assumed default.
- If starting the server fails outright, don't build a workaround — just ask the questions
  directly in chat for that instance.
