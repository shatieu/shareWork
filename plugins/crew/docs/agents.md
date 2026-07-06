---
id: crew-agents-seam
---

# The crew roles (`../agents/`)

The Ship's crew roles (Ship_Spec §7, Bridge phase 4): `first-officer` (orchestrator, best as
the session's main agent), `navigator` (research), `shipwright` (implementation), `inspector`
(independent review + gates), `devils-advocate` (pre-implementation opposition),
`quartermaster` (long-horizon memory over ledger/changelog MCP). Which roles a session
assembles is decided by the scrutiny preset -- see `../skills/crew/SKILL.md` and the plugin
README. Productized from the shareWork marathon's field-tested `.claude/agents/wave-*` charters.

This doc lives in `docs/`, NOT in `agents/`: Claude Code loads EVERY `agents/*.md` as an agent
definition -- a README there becomes a bogus dispatchable "README" agent (empirically observed
in the package-8 live acceptance). Only real role charters may live in `agents/`.
