---
id: deck-onboarding-wizard-inspector-evidence-2026-07-09
---

# Deck onboarding wizard — inspector evidence (2026-07-09)

Verdict: **PASS**. Scope: chartroom setup module + fs-browse/repo-setup routes + scheduler dep;
chartroom-ui FolderPickerModal/SetupWizard/entry points; ship acceptance setup-wizard.mjs.
Plan: `.claude/plans/deck-onboarding-wizard.md`. All commands below run BY THE INSPECTOR this session.

## 1. Gates (all rerun, all green)

| Gate | Result |
| --- | --- |
| `pnpm --filter chartroom build` | clean tsc |
| `pnpm --filter chartroom test` | 40 files / 294 tests passed |
| `pnpm --filter chartroom lint` | clean |
| `pnpm --filter chartroom-ui build` | clean (tsc + vite) |
| `pnpm --filter chartroom-ui lint` | clean |
| `pnpm --filter chartroom-ui test` | 33 files / 267 tests passed |
| `pnpm --filter reset-detector test` | 7 files passed (regression clean) |
| `pnpm --filter scheduler test` | 6 files / 41 tests passed (new chartroom dep regression clean) |
| `pnpm --filter ship build` + `build:ui-bundle` | clean |
| `pnpm --filter ship test:acceptance` | deck-boot, add-repo-ui, setup-wizard: all assertions passed |

## 2. Integrated live smoke (inspector's OWN hull, port 4617, scratch HOME — live Deck on 4317 untouched)

Script + log: scratchpad `inspector-smoke.mjs` / `inspector-smoke.log`. 45/46 asserts green:

- (a) `GET /` serves `/assets/index-U_szbvKI.js`; served JS carries `Set up this repo`,
  `setup/run`, `folder-picker__crumb` — fresh wizard bundle confirmed.
- (b) fs/list roots → `path:null, parent:null`, non-empty entries with `{name,path,isGitRepo}`;
  descend `C:\` (parent null at root) then one deeper (parent non-null); 403 without
  `x-ship-deck`; 404 on a file path.
- (c) scratch git repo registered live; audit → canonical 12 items in plan order, sane states,
  human items carry `claude ...` commands.
- (d) apply all 8 auto → all `ok:true`, results in requested order; re-audit → all auto
  `present`; re-apply → idempotent all ok.
- (e) human id in apply → 400. (f) setup/run unknown id → 400, AUTO id → 400 (no live terminal
  spawned; successful-run path verified via unit tests' SpawnLike seam: `{ ok: true }` body,
  server-generated argv only, body-injected `command: 'rm -rf /'` ignored, sync spawn failure →
  readable 500 — repo-setup.test.ts:332-418, ran green in gate).

The one smoke "FAIL" was the inspector's own over-strict assertion ("all 8 auto missing on a
bare repo"): live registration itself builds `.docs/index.json`, so `chartroom-init` correctly
audits `partial` with the honest detail "index present; 1 of 1 doc(s) missing ids; hook not
installed" (reproduced in isolation via probe-states.mjs). Correct behavior, not a defect.

## 3. FE↔BE contract conformance

FE local interfaces (`chartroom-ui/src/api/client.ts:411-508`) diffed against live BE responses:
`FsListResponse` path/parent nullability matches (null/null on roots, parent null at a drive
root); `RepoSetupItem` `{id,label,state,kind,detail,command?}` matches; apply
`{results:[{id,ok,detail}]}` matches; run `{ ok: true }` matches (seam test). Deck header rides
all four calls incl. GETs — BE 403s headerless GETs (verified live), so the FE's plan-over-
dispatch call was required, not just harmless.

## 4. Named risks — all attacked, all held

- r1: relative nonexistent, `..\..\..`, `Q:\nope`, UNC `\\localhost\no-such-share-xyz`,
  `C:\Windows\<>|?*` → all 404, hull alive after. Relative paths resolve against daemon cwd
  (`fs-browse.ts:98`) — see nit 2.
- r2: GET/POST setup + setup/run on unregistered repo id → 404 on all three (guard before any FS action).
- r3: two GET audits on an untouched registered repo → recursive sha256 tree snapshot
  byte-identical. Audit is a pure read.
- r4: foreign `.git/hooks/pre-commit` → chartroom-init `ok:false` ("left untouched; chain it
  manually"), foreign hook bytes intact, other 7 items all applied `ok:true`, ids/index still
  written. Per-item isolation holds.
- r5: CLAUDE.md created by claude-md-section in the SAME batch ends up with a frontmatter `id:`
  and appears in `.docs/index.json` (init-last ordering, repo-setup.ts:642, works live).
- r6: `.ship/lookout/config.json` written in the TARGET repo with a minted sessionId; daemon cwd
  got NO `.ship` dir; sessionIds differ across repos.

## 5. Plan/skill consistency

`SETUP_ITEMS` (repo-setup.ts:490-593) = plan's canonical list exactly (8 auto + 4 human, same
ids, same order). `plugins/crew/skills/setup/SKILL.md` Mode A checklist agrees item-for-item;
its extra entries (repo registration — the wizard's own precondition; mission scaffold —
explicitly "only when missions will run here"; resume-prompt editing) are out of wizard scope
by design, no contradiction. Acceptance script's ALL_ITEM_IDS matches. Deviations 1-7 in the BE
report all check out in source (server.ts pass-through, marker exports, station.ts untouched,
init-last ordering, best-effort human audits, `{ok:true}` run body, refusal discipline).

## Non-blocking nits

1. Re-apply of `chartroom-init` rewrites `.docs/index.json` (fresh `generatedAt` timestamp,
   index-schema.ts:72) — semantic no-op, but "second apply is a true no-op" is not byte-true
   for the index. Audits stay pure (r3).
2. `fs/list?path=<relative>` resolves against the daemon cwd (`resolve(path.trim())`): an
   existing relative name would 200 with a cwd-relative listing rather than 400. Endpoint
   intentionally browses the whole FS behind the CSRF header, so no boundary is crossed; still,
   rejecting non-absolute paths would be tighter. Nonexistent ones 404 cleanly (tested).
3. `packages/ship/dist/public/assets/` accumulates stale hashed chunks from prior builds;
   index.html references only the fresh one (verified served), but a clean step would avoid
   confusion.
