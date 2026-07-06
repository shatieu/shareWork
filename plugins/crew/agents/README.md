---
id: crew-agents-seam
---

# plugins/crew/agents

The Ship's crew roles (Ship_Spec §7, Bridge phase 4): `first-officer` (orchestrator, best as
the session's main agent), `navigator` (research), `shipwright` (implementation), `inspector`
(independent review + gates), `devils-advocate` (pre-implementation opposition),
`quartermaster` (long-horizon memory over ledger/changelog MCP). Which roles a session
assembles is decided by the scrutiny preset -- see `../skills/crew/SKILL.md` and the plugin
README. Productized from the shareWork marathon's field-tested `.claude/agents/wave-*` charters.
