---
id: deck-onboarding-wizard-be-shipwright-evidence-2026-07-09
---

# Deck onboarding wizard — BE shipwright evidence (2026-07-09)

Plan: `.claude/plans/deck-onboarding-wizard.md` §API 1-4. Scope: packages/chartroom BE + ship acceptance.
No commits made (dispatch forbade git commit/checkout/branch); working tree only.

## Delivered

- `packages/chartroom/src/setup/repo-setup.ts` (NEW) — the canonical 12-item table (single source of
  truth): auto `chartroom-init, chartroom-skill, agent-hook, chartroomignore, claude-md-section,
  gitignore-entries, ship-scrutiny, lookout-init`; human `plugin-marketplace-add, plugin-install,
  mcp-ship-ledger, mcp-ship-log` with README-canonical `claude ...` commands over a runtime-resolved
  suite root (injectable). `auditRepoSetup` pure read; `applyRepoSetup` idempotent, per-item
  wrapped, throws before applying on unknown/human ids; `humanItemCommand` for /setup/run.
- `packages/chartroom/src/daemon/routes/fs-browse.ts` (NEW) — `GET /api/fs/list`, CSRF-guarded,
  directories only, dot/node_modules skipped, roots view (win32 drives; else home + `/`),
  `{path, parent, entries}` per plan; 404 on missing/unreadable/file paths (403 reserved for CSRF).
- `packages/chartroom/src/daemon/routes/repo-setup.ts` (NEW) — GET/POST `/api/repos/:id/setup` +
  POST `.../setup/run`; run spawns a detached terminal (claude-session spawn shapes + cleanClaudeEnv
  + SpawnLike seam, cwd = repo root) with server-generated argv only; success body `{ ok: true }`
  (FE alignment). Wiring: register-routes.ts + server.ts option pass-through.
- `packages/chartroom/package.json` — `"scheduler": "workspace:*"` (Captain-approved; `initConfig`
  for lookout-init at `<repo>/.ship/lookout`).
- Tests (NEW): `test/daemon/fs-browse.test.ts` (5), `test/daemon/repo-setup.test.ts` (17).
- `packages/ship/acceptance/setup-wizard.mjs` (NEW, add-repo-ui pattern; port walk from 4517, never
  the live Deck) + chained in ship `test:acceptance`.

## Evidence (all run locally, this session)

- `pnpm --filter chartroom build` — clean tsc.
- `pnpm --filter chartroom test` — 40 files / 294 tests passed (all pre-existing + 22 new).
- `pnpm --filter chartroom lint` — clean.
- `pnpm --filter ship build` + `build:ui-bundle`, then `pnpm --filter ship test:acceptance` —
  deck-boot, add-repo-ui, setup-wizard: all assertions passed (19 asserts in setup-wizard:
  register → fs/list roots + parent listing w/ isGitRepo → 12-item audit → apply subset →
  re-audit present → idempotent re-apply, byte-identical .gitignore → human-id 400 → 403 x2).

## Deviations / notes for the integrator

1. `src/daemon/server.ts` touched beyond the named file list: `BuildServerOptions.fsBrowse/repoSetup`
   pass-through — required by the mandated buildServer+inject test pattern (raw-register precedent).
2. Small enabling exports added: `HOOK_MARKER` (install-hook.ts), `AGENT_HOOK_MARKER`/
   `AGENT_HOOK_SCRIPT_RELATIVE_PATH`/`AGENT_HOOK_MARKER_IN_COMMAND` (renamed from private consts,
   install-agent-hook.ts), `SKILL_MARKER`/`SKILL_RELATIVE_PATH` (install-skill.ts),
   `windowsTerminalAvailable` (claude-session.ts). Pure-read audit needs the markers; no behavior change.
3. `station.ts` needed NO change: both new routes self-register with real defaults inside
   `registerChartroomRoutes`, which the station already calls. Verified live via the acceptance hull.
4. Apply executes `chartroom-init` LAST within a batch (results returned in request order):
   claude-md-section may create CLAUDE.md in the same batch, and init must id/index it for one-pass
   convergence — found by the idempotency test, not visible in the plan.
5. Human-item audits are best-effort repo-file reads: plugin-install via `enabledPlugins` in
   `.claude/settings.json`; marketplace-add inferred from that; mcp-* via project `.mcp.json`
   (user/local-scope registrations are honestly reported as not verifiable in `detail`).
6. All four routes require `x-ship-deck` incl. GETs, per plan §API header note — FE confirmed
   (coordinator alignment #1); run route returns bare `{ ok: true }` (alignment #3).
7. `chartroom-init` apply reports `ok: false` when a foreign pre-commit hook forces a refusal
   (ids/index still written; detail says to chain manually) — refusals are per-item errors, never crashes.
