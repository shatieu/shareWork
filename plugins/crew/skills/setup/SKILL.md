---
id: ship-setup-repo-onboarding-spec-fullness-audit
name: setup
description: Set up or audit a repo for the ship framework. Use when onboarding a new repo ("onboard this repo", "set this repo up for the ship framework", "is this repo set up?"), when asked to check the specs or run a spec audit (spec fullness, spec completeness, "are the specs ready to build from?"), or before starting a mission in a fresh spec-only repo. Covers Chart Room, crew plugin, MCP, Lookout, mission scaffold, and the canonical spec anatomy.
---

# Ship setup -- repo onboarding + spec fullness audit

Two modes. Mode A (bootstrap audit) ALWAYS runs first, even when the ask sounds
spec-only -- a spec audit in an unregistered repo produces links and ids that go
nowhere. Mode B runs when the repo is specs-first (a brand-new repo holding only
docs) or when asked to check the specs. Every rule below is a lesson that burned
a mission (suite-design/overnight/LESSONS-LEARNED.md).

## Mode A -- bootstrap audit (run first, always)

Walk this checklist top to bottom. Report each item present/missing. DO the safe
idempotent items yourself; for human-only items print the exact command and move
on -- never self-install anything machine-level.

**Chart Room**
- repo registered in `~/.chartroom/repos.json` [safe: `chartroom register`]
- `.docs/index.json` built [safe: comes with registration/rebuild]
- frontmatter `id:`s injected + pre-commit hook installed [safe: `chartroom init`]
- `.chartroomignore` authored -- deliberately-unmanaged zones (task dirs,
  templates, byte-exact fixtures, kickoff prompts) [safe: propose contents,
  confirm the exclusion list before writing]
- `chartroom install-skill` and `chartroom install-agent-hook` run [safe]
- CLAUDE.md has a "## Chart Room" section [safe]

**Crew**
- ship-crew plugin enabled in `.claude/settings.json` -- HUMAN:
  `claude plugin marketplace add <marketplace>` then
  `claude plugin install ship-crew --scope project`
- `ship.scrutiny` set in settings [safe]
- `.gitignore` has `.ship/`, `.docs/`, `.ship-crew/` [safe]

**MCP (per machine -- HUMAN)**
- ship-ledger + ship-log registered for the quartermaster; print the exact
  commands from plugins/crew/README.md ("Quartermaster MCP registration")

**Lookout**
- `lookout init` run: `.ship/lookout/config.json` exists [safe] and
  `.ship/lookout/resume-prompt.txt` edited for the mission -- the default is
  generic on purpose; flag it if untouched

**Mission scaffold** (only when missions will run here)
- mission dir with kickoff prompt, MISSION-CONTEXT.md, tracking files
  (PLAN/STATUS/PROGRESS + progress.json), `plans/`, `reports/`,
  `changelog/entries/`

## Mode B -- spec fullness audit

For every spec doc found, check it against the canonical anatomy below and
propose concrete rewrites: QUOTE the section text to add or change, never just
name the gap. "Add an acceptance line" is not a finding; the proposed line is.

**Header**
- `id:` frontmatter
- "Prepared for / Date / Status:" -- Status must read "decision-complete, ready
  to implement"; anything softer means the spec is not buildable yet
- cross-links to sibling specs

**Required sections, in order**
1. What it is -- one-paragraph identity + the core end-to-end loop
2. Scope in vs out -- strict, with deferred-but-keep-the-seam notes
3. Stack -- decided, no dithering
4. Data model / interfaces
5. Build order in shippable phases -- EVERY phase ends with an explicit,
   testable `Acceptance:` line
6. Definition of done
7. Explicitly out of scope

**Product-spec vs build-spec split**
If two specs overlap, the superseded one says "superseded by <x>" at the top,
and the kickoff prompt points crews at the build spec -- never at both.

**Kickoff prompt anatomy**
- numbered work queue; each item = title + governing spec file+section + ONE
  acceptance line
- parking protocol (what gets parked for the human vs guessed at)
- definition of mission end + completion marker (a DONE file)

**Failure modes to flag explicitly** -- each one burned a mission
(suite-design/overnight/LESSONS-LEARNED.md):
- phase without an acceptance line
- missing out-of-scope / seam notes
- queue item with no governing spec section
- superseded spec left unmarked
- undated amendment buried mid-doc
- duplicate canonical paths (two usage.json copies once fed a session
  hours-stale data)
- no definition of done / DONE marker
- tracking-file claims treated as truth -- git + disk are truth; tracking files
  are testimony

## Output contract

- a per-spec table: section -> present / missing / weak
- a prioritized rewrite list, each entry carrying its proposed text
- NEVER rewrite a spec without the human approving the proposed structure first
