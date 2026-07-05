# MISSION CONTEXT - Ship Marathon Crew Brief

Read this first. Dispatches assume you know everything below.

## 1. Repo layout
- Monorepo: pnpm workspaces + turborepo. Workspace globs: `packages/*`, `plugins/*`.
  Root scripts: build/lint/test/dev via turbo. Node >=20, pnpm 10. Shared `tsconfig.base.json`.
- `packages/chartroom` - Chart Room core: markdown indexer, id-based link resolver,
  CLI, daemon/server, pre-commit link-repair hook. Ships the UI bundle in its dist.
- `packages/chartroom-ui` - Chart Room frontend (React + Vite + Milkdown), private,
  build-only; its dist is copied into chartroom's dist/public.
- `plugins/` - Claude Code plugins land here (currently only a README).
- `team-tasks/` - the Captain's separate Next.js app. UNTOUCHABLE. Never edit, build,
  or refactor anything under it.
- `suite-design/` - all specs, kickoff prompts, the Lookout, and `overnight/` tracking.

## 2. Spec map (which spec governs which package)
- `suite-design/ChartRoom_Spec.md` - Chart Room. Sections 1-10; build order in sec 8
  (phases 8.1 indexer/CLI, 8.2 viewer, 8.3 editor, 8.4 blocks+inbox, 8.5 agent surface).
- `suite-design/Ship_Spec.md` - The Bridge / Crew / hull / Captain's Deck. Sections:
  3 Ledger (ship-ledger), 4 Changelog (ship-log), 5 Inbox (ship-inbox),
  6 Console (ship-console), 7 Crew plugin (ship-crew), 9 build order.
- `suite-design/Trio_Specs.md` - sec A Skill Analytics, sec B Settings Manager,
  sec C Scheduler (the Lookout's product cousin). Cross-trio build order at end.
- `suite-design/Locker_Spec.md` - the Sea Chest (formerly "Locker"). Secs 1-8;
  build order sec 7.
- `suite-design/VoiceBridge_Spec.md` - the Comm (formerly "Voice Bridge"). Secs 1-11.
- `suite-design/Suite-Architecture_and_Website_Spec.md` - canonical naming (sec 1),
  system map (sec 2), monorepo conventions (sec 3), Harbor/website (secs 4-5),
  suite-wide sequencing (sec 6). Consult for names and conventions before coining any.

## 3. Tracking files (all under suite-design/overnight/)
- `PLAN.md` - package queue and current positions. Source of truth for what is next.
- `STATUS.md` - running decision log; append, never rewrite history.
- `DECISIONS-NEEDED.md` - questions parked for the Captain.
- `REMOVALS.md` - log any file you would have deleted (deleting is banned; see sec 7).
- `CAPTAIN-INBOX.md` - Captain's orders; FO reads at every package boundary.
- `CAPTAIN-TODO.md` - parked human-only integration steps (see sec 6).
- `plans/` - one plan per package. `reports/` - crew evidence reports.
- `changelog/` - per-package changelog fragments.

## 4. Branch model
- Integration branch: `ship-wave1`. One feature branch per package, named
  `ship-wave1-<package-slug>`, cut fresh from up-to-date `ship-wave1`.
- Only the First Officer merges (after Reviewer PASS) and pushes. Crew never merges.
- Small conventional commits (feat/fix/chore/docs, scoped). No AI attribution of any
  kind in commit messages.

## 5. The Lookout
- Usage sensor script: `suite-design/lookout/lookout.ps1`. Signals live in
  `suite-design/lookout/state/`: `usage.json`, plus `ALERT` and `PAUSE` marker files.
- Crew agents ignore it entirely. The First Officer watches it and throttles work.

## 6. Parking protocol (work needing credentials / live infra / a human)
- Build to the seam: real code + tests + migration files + a README with the exact
  human steps to finish the hookup. Log the steps as an entry in CAPTAIN-TODO.md.
- A properly parked package counts as FINISHED. Never fake a credential, stub around
  a missing secret in a way that lies, or deploy anything to get past the seam.

## 7. Quality bar - no half-delivered anything
- Every package: compiles, lints clean, tests pass, and the spec's acceptance line is
  demonstrably true (show evidence in the crew report).
- Deleting files is banned. If something must go, leave it and log it in REMOVALS.md.
- No deployments. No live database changes - migration files only.
- `team-tasks/` stays untouched, always.
