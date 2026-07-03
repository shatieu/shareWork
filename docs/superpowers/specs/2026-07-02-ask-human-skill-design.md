# ask-human skill — design (offline/standalone, sub-project 1 of 2)

**Date:** 2026-07-02
**Status:** approved by user, pending implementation plan

## Context

Spec-driven agentic development regularly hits points where the agent needs a human decision
(ambiguous requirement, choice between approaches, missing input) mid-task. Handing that back and
forth as markdown files is tedious for the human. This skill lets the agent compose a small,
self-contained interactive web page with questions, hand the human a clickable link, and read
their answers back once they're done — richer than a plain a/b/c/d prompt (choices, free text,
ratings, rankings, comparisons, pasted screenshots/docs), and with pre-filled suggestions the
human can accept or edit.

This is **sub-project 1 of 2**. This spec covers only the standalone/offline skill, usable in any
Claude Code project with zero external dependencies. A second design pass (not covered here) will
extend this into an **online** mode integrated with this repo's Team Tasks app, so a remote
teammate can answer a hosted version of the same page and results sync back to the board. The
schema and rendering approach below are deliberately kept reusable so that online phase can share
them rather than reinvent them.

## Goals

- Agent can ask rich, structured questions (not just multiple choice) via a generated local web
  page, with zero setup burden on the human beyond clicking a link.
- Fully self-contained and portable: copying one skill folder into any repo's `.claude/skills/`
  makes it work there, independent of this repo.
- No background polling loops — turn-based handoff that fits how Claude Code actually works.
- Supports pre-filled/suggested answers the human can accept as-is or adjust.
- Supports pasting or uploading images/docs as part of an answer.

## Non-goals (this spec)

- The online/hosted mode for the Team Tasks app (separate future spec).
- Authentication, multi-user sessions, or long-lived server processes.
- Handling the human never responding (no timeout/cleanup automation needed — turn-based).

## Architecture & data flow

A self-contained skill directory, `.claude/skills/ask-human/`, using only Node's built-in `http`
module (no npm dependencies — Node is guaranteed present since Claude Code itself runs on it).

1. Claude decides it needs clarification and writes a `spec.json` (schema below) to
   `.claude/ask-human/sessions/<sessionId>/spec.json`.
2. Claude runs the skill's `bin/server.mjs` against that session directory (background Bash). The
   script:
   - validates `spec.json` upfront, failing fast with a clear message on malformed input;
   - renders a self-contained `index.html` (styles + client JS inlined) from `template/page.html.tmpl` embedding the question spec;
   - picks a free local port (tries a few in sequence if the first is taken);
   - starts an HTTP server serving that page plus a `POST /submit` endpoint;
   - writes `server.pid` (for later shutdown) and the resolved URL;
   - best-effort auto-opens the OS default browser (`start`/`open`/`xdg-open`) — failure here is
     silent, since the printed link is always the fallback;
   - prints the clickable `http://localhost:<port>/` link to stdout.
3. Claude relays that link to the human ("I've got a few questions — answer them here: <link> —
   let me know when you're done") and ends its turn. No polling.
4. Human opens the page, answers questions (editing suggested defaults, picking choices, pasting a
   screenshot, etc.), and clicks Submit. The browser POSTs JSON + any attachments to `/submit`;
   the server writes `answers.json` and saves attachments under `attachments/`, then shows a
   "you can go back to Claude Code now" confirmation screen.
5. Human tells Claude they're done (or just continues the conversation naturally).
6. Claude reads `answers.json` (Read tool), reads any referenced attachment files, and kills the
   server process via the PID in `server.pid`, then proceeds using the answers.
7. The session directory persists on disk (gitignored) for debugging/audit. It is never
   auto-deleted — if the human wants it cleaned up, that's an explicit ask, per the standing rule
   against silent deletion.

## Question schema

Every question shares a common envelope; type-specific fields vary.

```jsonc
{
  "id": "auth-strategy",
  "type": "single-select",
  "prompt": "Which auth strategy should we use?",
  "context": "```ts\n// current middleware.ts excerpt...\n```",  // optional markdown/code blurb
  "suggested": "jwt-cookie",       // optional pre-filled default; human can accept or override
  "allowAttachment": true,          // optional, default true — paste/upload on this question
  // type-specific fields, e.g. for choice types:
  "choices": [
    {"value": "jwt-cookie", "label": "JWT in httpOnly cookie"},
    {"value": "session-db", "label": "Server-side session table"}
  ],
  "allowOther": true                 // free-text write-in choice, for choice types
}
```

**Types (v1):**

| type | description |
|---|---|
| `single-select` | radio choices, optional `allowOther` write-in |
| `multi-select` | checkbox choices, optional `allowOther` write-in |
| `text` | free-text textarea |
| `yesno` | quick yes / no / unsure toggle |
| `rating` | labeled 1–10 slider, custom end labels (e.g. "conservative" ↔ "aggressive") |
| `ranking` | drag-to-reorder a list of items |
| `compare` | side-by-side cards (each rendering markdown/code) to pick/rank between approaches |

Cross-cutting, available on any question type:
- `context` — markdown/code blurb rendered above the prompt for background (spec excerpt, diff, etc.)
- `suggested` — pre-filled default the human edits or accepts as-is
- attachment support — paste (Ctrl+V clipboard image) or drag-and-drop/browse upload (image or
  document), saved to disk on submit and referenced by path in `answers.json`

`answers.json` mirrors the spec:

```jsonc
[
  {
    "id": "auth-strategy",
    "type": "single-select",
    "value": "jwt-cookie",
    "attachments": ["attachments/auth-strategy-screenshot.png"]
  }
]
```

## File layout

```
.claude/skills/ask-human/
  SKILL.md              # when/how Claude uses this: authoring the spec, invoking, reading back
  SCHEMA.md             # full JSON schema + examples for every question type
  bin/
    server.mjs          # validates spec, renders HTML, starts HTTP server — zero npm deps
  template/
    page.html.tmpl       # HTML shell; styles + client JS inlined into it at render time
  examples/
    example-spec.json    # one of every question type, for Claude to copy from

.claude/ask-human/                  # created at runtime, .gitignore'd
  sessions/<sessionId>/
    spec.json
    index.html
    answers.json
    attachments/...
    server.pid
```

Copying just `skills/ask-human/` into another repo's `.claude/skills/` is sufficient to use it
there — no dependency on this repo or the future online app.

## Error handling (kept minimal — YAGNI)

- Port already in use → try the next few ports in sequence.
- Malformed `spec.json` → `server.mjs` validates upfront and fails with a clear message so Claude
  can fix its spec before the human ever sees a broken page.
- Human never responds → no timeout/cleanup automation; turn-based flow means there's nothing to
  reclaim automatically.
- Server fails to start outright (rare) → Claude falls back to asking the questions directly in
  chat rather than maintaining a separate copy-paste UI mode for this edge case.

## Forward-compatibility note (for the future online sub-project)

- The `spec.json` → `answers.json` schema and the per-question-type rendering logic should be
  written so the future hosted mode can reuse them (e.g. render the same template server-side in
  the Next.js app, write `answers.json` to Supabase instead of local disk). This spec doesn't
  design that integration — only keeps the door open.
