---
id: the-ship-how-to-use-it
---

# The Ship — How to use it

> **Living document.** Any change that alters user-facing behavior MUST update this file in the
> same package (rule in `CLAUDE.md`). Last updated: 2026-07-17 (wave 2).

## Start

```
pnpm build          # once after pulling
node packages/ship/dist/cli.js serve        # Captain's Deck at http://127.0.0.1:4317
```

`ship serve --port <n>` and `--voyage <progress.json>` override the defaults. Standalone
`chartroom serve` gives you the Docs tab only.

## The tabs

**Docs** — every registered repo's markdown, tracked by Chart Room (id-carrying links survive
`git mv`). Click a doc to read; **Edit** opens the WYSIWYG editor — saving an untouched doc
produces a zero-byte diff, lists/tables/`:::llm` blocks are safe. `+ add repo` registers a repo
(browse with the folder picker); **Set up this repo** runs the 12-item onboarding wizard
(auto items apply themselves; human items give you the exact command to paste).

**Voyage** — live progress boards. The project switcher shows the default board plus every
registered repo that has `.ship/voyage/progress.json`; **Add item** appends a new todo/package
to the selected board (hand-edits to the file are preserved).

**Chapel** — talk to the Chaplain (your cross-project confessor). The chat window is the main
feature: type and send; the reply comes from a real chaplain session that remembers previous
chats. Click a repo chip to insert a `project: <id>` marker when you want to be explicit about
which project you mean. Drop-a-note confessions land durably in the archive — the
**Past confessions** panel lists them all. (The chaplain's inbox copy is consumed when a
chaplain session next runs its rite; the archive copy is forever.)

**Inbox** — everything needing a human: permission requests, agent questions, doc questions.
You can now **respond with text** to any question (delivery resumes that session's transcript —
it is not mid-task injection), send free text to any tracked session from the Tracked-sessions
panel, and **unwatch** sessions you don't care about (rewatch any time). When a session asks
structured questions (ask-human), the inbox links to a ship-styled **question form**; answers
land byte-compatible with the skill's own format. Denying a permission can carry a note — it
reaches the session as a transcript message.

**Settings** — Claude Code permission rules as draggable chips, grouped by tool and command
(`git` group holds `git push *` etc.). Drag a chip — or a whole group — between **allow / ask /
deny**, preview the diff, apply: the target project's real `.claude/settings.json` changes (a
timestamped backup is written first). Scope picker covers user / project / local; managed rules
are locked. **Template packs**: apply the built-ins, or create your own (saved under
`~/.suite/settings-templates/`, shareable JSON).

**Console** — the fleet view (every tracked Claude session; unwatched ones stay hidden), skill
analytics, and the **token usage panel**: per-session input/output/cache token totals.

## CLI quick reference

```
chartroom register <path> | resolve <id-or-path> | check | fix-links --write | open <file.md>
lookout init | watch | wait | status --json | lock acquire|heartbeat|release
```

## Working with the crew (agents)

Repos carry a scrutiny preset (`ship.scrutiny` in `.claude/settings.json`): `solo`,
`standard` (navigator → shipwright → inspector), `rigorous` (+ devils-advocate + plan gate),
`paranoid` (+ stop gate). Say "go rigorous on this one" to override per session. The
quartermaster answers "what shipped this week?" from the ledger; the chaplain answers
"how are my projects doing?" in the Chapel tab.

## Where things live

- `~/.chartroom/repos.json` — registered repos; `~/.ship/chaplain/` — briefs, chat log, archive
- `<repo>/.ship/lookout/` — usage signals; `<repo>/.ship/voyage/progress.json` — voyage board
- `~/.suite/settings-backups/` — every settings write's backup; `~/.suite/settings-templates/` — your packs
