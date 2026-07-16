---
id: plan-chapel-tab-on-the-captain-s-deck
---

# Plan — Chapel tab on the Captain's Deck

Captain directive (2026-07-09): a Deck screen for the Chaplain — read his brief and
dossiers, drop confessions from the UI, and open a live session with him.
Navigator findings (file:line, binding): .ship-crew/exchange/chapel-tab/findings.md.

## Shape
Hull-owned, exactly like Voyage: routes in packages/ship, tab in chartroom-ui.
Chapel state dir = `~/.ship/chaplain` (HullOptions.homeDir override for tests).
Routes are ALWAYS registered (unlike Voyage) — confessions must work before the
first chaplain session ever runs; missing files are 200-with-null, not 404.
All /api/chapel routes require the x-ship-deck header (403 without), matching the
setup-wizard GET convention.

## API contract
- GET  /api/chapel/brief            → 200 { brief: string|null, updatedAt: string|null }
- GET  /api/chapel/projects         → 200 { projects: [{ id, updatedAt }] }   (dossier files)
- GET  /api/chapel/projects/:id     → 200 { id, content, updatedAt } | 404
- POST /api/chapel/confess { text, project? } → 201 { ok: true }
  Writes an atomic dated file to ~/.ship/chaplain/inbox/:
  `<ISO-stamp-with-dashes>.md`, body = optional `project: <id>` first line + blank
  line + text verbatim. `project` is sanitized to [a-z0-9-] for the body line and
  NEVER used in the filename (traversal-proof). Empty/whitespace text → 400.
- POST /api/chapel/session          → 200 { ok: true } | 501 when no spawn contract
  Spawns a detached terminal running `claude --agent ship-crew:chaplain` in the
  hull's repoRoot, via the NEW chartroom station contract below. Fixed argv only.

## Spawn contract (the sanctioned seam)
chartroom station adds a named in-process contract `spawnTerminal` (station.ts
contracts map) wrapping the existing launchTerminal matrix + cleanClaudeEnv from
routes/claude-session.ts (export what is needed; no third copy of the per-OS
matrix). Hull consumes via HostContext.getContract('chartroom', 'spawnTerminal');
absent contract → 501 with a clear message.

## FE (chartroom-ui)
ChapelPage (src/chapel/): brief rendered with bare ReactMarkdown+remarkGfm
(CompareQuestion precedent), dossier list → dossier viewer (same renderer),
confession box (textarea + optional project select fed by /api/chapel/projects +
"Confess" button → toast on 201) and "Open Chaplain session" button (POST
/session; disabled state on 501 with the message shown). CHAPEL_TAB in App.tsx
per VOYAGE_TAB pattern: tab appended when fetchChapelBrief() resolves; hash
route #/chapel wired at the three App.tsx points the findings name. client.ts:
fetchChapelBrief, fetchChapelProjects, fetchChapelProject, chapelConfess,
chapelOpenSession (header on all). chapel.css for layout, base.css tokens.

## Verification (standard preset — lean)
- BE: vitest per voyage.test.ts pattern (temp homeDir): brief null→content flow,
  projects list/get/404, confess writes inbox file (content verbatim, stamp name,
  400 empty), 403 without header on every route, session 501-without-contract and
  spawn-seam call with fixed argv (injected contract). chartroom: contract unit
  test (SpawnLike seam). Suites: ship + chartroom + chartroom-ui builds/lint/tests.
- Inspector (lean): run the new tests + one live smoke (spawned hull: brief/
  confess/403), spot-check the two named risks ONLY: (r1) confession filename/
  content injection; (r2) /session argv is fixed server-side. Trust builder gates
  elsewhere.

## Build split (parallel, non-overlapping)
- Shipwright BE: packages/ship (chapel backend + routes + tests + serve/hull
  wiring) + packages/chartroom (spawnTerminal contract + exports + test).
- Shipwright FE: packages/chartroom-ui only.
- FO integrates: ui bundle rebuild, restart live Deck.
