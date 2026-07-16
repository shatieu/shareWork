---
id: suite-modularization-plan-package-g
---

# Suite Modularization Plan (Package G)

Status: PLAN ONLY -- research by navigator, no edits made. Every claim carries a `file:line`
pointer (paths relative to repo root `C:\thisismydesign\shareWork`).

Question answered: **can someone adopt only SOME features (just Chart Room docs, just the crew
plugin, just the Lookout)?** Short answer: the architecture was built for exactly this -- the
station contract forbids inter-station imports (`packages/suite-conventions/src/station.ts:11-13`)
and every hook fails open -- but *publishing* status blocks it: only `chartroom` is
npm-publishable today; every other package is `"private": true`.

---

## 1. Dependency map

### 1.1 Workspace members
`pnpm-workspace.yaml:1-3` -- `packages/*` + `plugins/*`. **`team-tasks/` is NOT a workspace
member**: it has its own `team-tasks/package-lock.json` (npm, not pnpm) and no workspace deps
(`team-tasks/package.json:11-26` -- no `sea-chest`, no `suite-conventions`).

### 1.2 Runtime workspace dependency edges (from package.json `dependencies` only)

```
suite-conventions ── (zod only; no workspace deps)        suite-conventions/package.json:38-40
reset-detector ───── (zero deps)                          reset-detector/package.json (no deps key)
scheduler ────────── reset-detector                       scheduler/package.json:36-38
chartroom ────────── scheduler, suite-conventions         chartroom/package.json:57,58
chartroom-ui ─────── chartroom (runtime + types)          chartroom-ui/package.json:15
sea-chest ────────── suite-conventions                    sea-chest/package.json:47
settings-manager ─── suite-conventions                    settings-manager/package.json:36
ship-console ─────── suite-conventions                    ship-console/package.json:27
ship-inbox ───────── suite-conventions                    ship-inbox/package.json:32
ship-ledger ──────── suite-conventions                    ship-ledger/package.json:33
ship-log ─────────── suite-conventions                    ship-log/package.json:33
ship-voice ───────── suite-conventions                    ship-voice/package.json:26
skill-analytics ──── suite-conventions                    skill-analytics/package.json:29
ship (hull) ──────── chartroom, settings-manager, ship-console, ship-inbox, ship-ledger,
                     ship-log, ship-voice, skill-analytics, suite-conventions
                                                          ship/package.json:32-45
plugins/crew ─────── ZERO runtime deps (devDeps only)     plugins/crew/package.json:12-17
```

Notable non-edges:
- Stations never depend on each other at runtime. `ship-voice`'s deps on ship-inbox/ledger/log are
  **devDependencies** (types only) -- `ship-voice/package.json:33-40`. Cross-station data flows
  through `HostContext.getContract` at runtime (`suite-conventions/src/station.ts:20`), and every
  standalone CLI stubs it with `getContract: () => undefined` (`ship-inbox/src/cli.ts:41`,
  `ship-log/src/cli.ts:138`, `ship-ledger/src/cli.ts:60`, `chartroom/src/commands/serve.ts:63`).
- `chartroom -> scheduler` is a single import used only by the setup wizard:
  `chartroom/src/setup/repo-setup.ts:4` (`initConfig` + `DEFAULT_STATE_DIR` from `scheduler`).
- Only the hull imports stations: `ship/src/commands/serve.ts:5-12` (the eight
  `create*Station()` imports), assembled at `ship/src/commands/serve.ts:91-94`.

### 1.3 The one shared UI (the "Deck" app)
`chartroom-ui` is one React SPA containing ALL tabs -- docs, console, inbox, ship-inbox,
settings, chapel, voyage, skill-analytics, setup (`chartroom-ui/src/App.tsx:25-36`; dirs at
`chartroom-ui/src/`: `console/ inbox/ shipinbox/ settings/ chapel/ voyage/ skillanalytics/
setup/`). It is private/build-only (`chartroom-ui/package.json:6`) and its built `dist/` is
copied into TWO packages: `packages/chartroom/dist/public` (`chartroom/scripts/copy-ui-dist.mjs:1-12`,
so a published `npx chartroom serve` is self-contained) and `packages/ship/dist/public`
(`ship/scripts/copy-ui-dist.mjs:2-6`); wired in `turbo.json:8-15`.

Crucially the SPA **degrades by feature-probing, not by build variant**: it calls
`GET /api/hull/stations` and falls back to Docs-only when that 404s under standalone
`chartroom serve` (`chartroom-ui/src/App.tsx:155-189`, comment at 155 and catch at 183-185);
Voyage/Chapel tabs appear only when their probes resolve (`App.tsx:166-181`). Tab bar is built
from the hull's station list (`ship/src/hull.ts:101-103`).

### 1.4 Crew plugin coupling (plugins/crew)
Plain plugin payload, no build, no workspace deps (`plugins/crew/package.json:2-17`). All four
hooks are **stdlib-only by hard charter** because a marketplace-distributed plugin cannot resolve
workspace packages (`plugins/crew/hooks/emit.mjs:8-10`; scrutiny/stop-gate import only node:fs/os/
path -- `scrutiny.mjs:21-23`, `stop-gate.mjs:24-26`). Bridge coupling is discovery + fail-open:
- `emit.mjs` finds the hull via `~/.suite/services.json` (`emit.mjs:38-55`) and on any failure
  spools to `~/.ship/spool/events.jsonl` (`emit.mjs:42-44`); always exits 0 (`emit.mjs:11-13`).
- `permission.mjs` long-polls ship-inbox, prints nothing on timeout so the native dialog proceeds
  (`permission.mjs:4-9`).
- Soft (documented, not linked) deps: `graceful-pause` skill drives the `lookout` bin
  (`plugins/crew/skills/graceful-pause/SKILL.md:9-11`), `setup` skill drives `chartroom` +
  `lookout` CLIs (`skills/setup/SKILL.md:21-27,42-43`), quartermaster agent needs ship-ledger/
  ship-log MCP servers (`plugins/crew/agents/quartermaster.md:22-23`).
So: **crew plugin installs and works alone**; Bridge-fed features silently no-op without the suite.

### 1.5 Sea Chest / team-tasks (Harbor)
`sea-chest` is code-complete **to a seam**: framework-agnostic handlers + store interface +
migration files, deliberately zero live-platform wiring (`packages/sea-chest/README.md:6-14`);
mount steps are a human checklist (`README.md:52+`). team-tasks contains no sea-chest reference
today (grep for `sea-chest|seachest|locker` over `team-tasks/` -- zero matches). Only dep:
`suite-conventions` (`sea-chest/package.json:47`).

### 1.6 Shared conventions kernel
`suite-conventions` = services.json discovery (`src/services-json.ts:31,85`), station contract
(`src/station.ts:30-47`), hook-event shapes (`src/events.ts`), security helpers (`src/security.ts`,
e.g. `x-ship-deck` header literal duplicated into crew hooks -- `emit.mjs:31-34`). Zod is its only
dependency (`suite-conventions/package.json:38-40`).

---

## 2. Standalone today (works alone from this repo; own bin/CLI/MCP)

| Feature | Package | Standalone surface | Pointer |
|---|---|---|---|
| Chart Room docs | `chartroom` | bin `chartroom` (serve/register/init/resolve/check/fix-links/mcp/open/associate/install-skill/install-agent-hook/llms-txt); self-contained UI bundle; MCP server (`src/mcp/server.ts`) | `chartroom/package.json:8-10`; `src/commands/` listing; `scripts/copy-ui-dist.mjs:3-6` |
| Lookout | `scheduler` | bin `lookout` (init/watch/wait/lock/guard/status), only dep = `reset-detector` | `scheduler/package.json:9-11,36-38` |
| Crew plugin | `plugins/crew` | Claude Code plugin payload; hooks stdlib-only, fail-open | `plugins/crew/package.json:4`; `hooks/emit.mjs:8-13` |
| Changelog service | `ship-log` | bin `ship-log` + MCP (`src/mcp.ts`); "standalone bin for degraded/offline use" | `ship-log/package.json:4,8-10` |
| Ledger | `ship-ledger` | bin `ship-ledger` + MCP | `ship-ledger/package.json:4,8-10` |
| Human inbox | `ship-inbox` | bin `ship-inbox` | `ship-inbox/package.json:4,8-10` |
| Settings manager | `settings-manager` | bin `settings-manager` | `settings-manager/package.json:4,10-12` |
| Skill analytics | `skill-analytics` | bin `skill-analytics` (CLI table/JSON) | `skill-analytics/package.json:4,8-10` |
| Sea Chest dev | `sea-chest` | bin `sea-chest` (`serve-local` memory-store harness) | `sea-chest/package.json:11-13`; `README.md:29` |

**BUT: "standalone" currently means "from a monorepo checkout".** Only `chartroom` lacks
`"private": true` (its package.json has no private field; contrast `scheduler/package.json:7`,
`ship-log/package.json:6`, etc.). Nobody can `npm i -g ship-log` today. Also the standalone bins
of stations serve APIs without the Deck UI (only `chartroom` and `ship` embed `dist/public`).

Not standalone (headless stations, no bin): `ship-voice` (`ship-voice/package.json` -- no bin key)
and `ship-console` (`ship-console/package.json` -- no bin key; "most sherlockable module" per its
own description, line 4).

## 3. Separable with bounded work

| Item | Work | Effort |
|---|---|---|
| Publish `scheduler` (+`reset-detector`) to npm | drop `private`, pick npm names (both generic names are surely taken -- `scheduler`/`reset-detector`), scope e.g. `@ship-suite/lookout`; `reset-detector` can be inlined or published alongside | S |
| Publish station packages (`ship-log`, `ship-ledger`, `ship-inbox`, `settings-manager`, `skill-analytics`) | drop `private`, rename (npm collisions likely), keep `suite-conventions` as published dep; bins already stub `getContract` | S-M each |
| Break `chartroom -> scheduler` edge | single import (`chartroom/src/setup/repo-setup.ts:4`) used only by setup wizard; make it optional (dynamic import / peer) or move lookout-init out of chartroom's wizard | S |
| Distribute crew plugin via marketplace | already payload-shaped and stdlib-only; needs a marketplace entry / git source; the `.ship-crew/` exchange dirs and scrutiny settings are per-repo conventions, no code dep | S |
| Modular hull: choose stations per install | station list is hardcoded (`ship/src/commands/serve.ts:71-92`); add config (`~/.suite/` or flags) + optional peer deps so `ship serve --stations chartroom,ship-log` works without installing all eight | M |
| `chartroom-ui` tab-splitting (see §5 "hard couplings") | UI already runtime-degrades (`App.tsx:155-189`), so splitting is optional; if desired, per-station UI chunks lazy-loaded from station packages | L |
| Sea Chest into a host platform | seam is designed; work = follow mount checklist (`sea-chest/README.md:52+`) in the host app; flagged unproven: npm-registry plugin install end-to-end (`README.md:47-50`) | M (human steps included) |

## 4. Core / inseparable (and why)

- **`suite-conventions`** -- the kernel every station and the hull share (station contract,
  services.json, security). Cannot be removed from any multi-piece install; smallest possible
  surface (zod-only, `suite-conventions/package.json:38-40`). Must be published first under a real
  npm name (its own description flags naming as a Captain decision, line 3).
- **`ship` (hull)** -- inseparable *as the composer*: it is the only package allowed to import
  stations (`suite-conventions/src/station.ts:13`), owns `/api/hull/*`, chapel (always mounted,
  `ship/src/hull.ts:123-124`), voyage, and the services.json registration
  (`ship/src/hull.ts:140-148`). You only need it when you want the one-port Deck.
- **`chartroom-ui`** -- build-time core for any UI-bearing install: it is THE Deck app for both
  `chartroom serve` and `ship serve` (`chartroom-ui/package.json:5`; copy scripts §1.3). Never
  installed by users; ships inside publishers' dist.
- **`reset-detector`** -- core of the Lookout only (`scheduler/package.json:37`); pure library,
  no reason to use alone except as a lib.
- **Cross-station glue that is contract-shaped, not import-shaped** -- hook-event fan-out
  (`suite-conventions/src/station.ts:55-68`), chartroom `listInbox`/`spawnTerminal` contracts
  (`ship-inbox/src/station.ts:308`, `ship/src/chapel.ts:143`), ship-voice `fleetSource`
  (`ship-console/src/station.ts:117`). These are already "absent = feature unavailable, never an
  error" (`station.ts:18-20`) -- keep, do not break.

## 5. Hard couplings worth breaking

1. **Hardcoded station roster in `ship serve`** (`ship/src/commands/serve.ts:71-94`): all eight
   stations are unconditional imports + hard deps (`ship/package.json:32-45`), so "the suite
   minus voice" is impossible without a fork. Break with a station registry/config + optional
   peers. Highest-leverage change for partial adoption.
2. **One monolithic Deck bundle** (`chartroom-ui/src/App.tsx:25-36`): every tab's code ships to
   every install (a Docs-only `chartroom` user downloads console/inbox/settings/chapel JS).
   Runtime behavior already degrades; break only for size/ownership reasons -- per-station UI
   modules served under `/station-assets/<name>/` or lazy chunks keyed off `/api/hull/stations`.
3. **`chartroom -> scheduler`** (`chartroom/src/setup/repo-setup.ts:4`): a docs tool should not
   pull the usage-guard library into its published dependency tree. Trivial to break (§3).
4. **`private: true` everywhere but chartroom**: not a code coupling but THE adoption blocker;
   naming is already flagged as a pending Captain decision (`ship/package.json:4-5`,
   `suite-conventions/package.json:3`).
5. NOT worth breaking: crew-hook literal duplication (`emit.mjs:31-34`) -- deliberate, tested via
   compile-time cross-check in ship-log's suite (`emit.mjs:33-34`); and ship-voice's
   types-only devDeps (`ship-voice/package.json:33-40`) -- already the right shape.

## 6. Proposed modularization plan (phased)

- **Phase 0 -- naming + scope decision (Captain).** Choose an npm scope (e.g. `@ship-suite/*`);
  `ship` and `suite-conventions` names are explicitly deferred decisions
  (`ship/package.json:4-5`). No code changes.
- **Phase 1 -- independent leaves.** Publish `chartroom` (already publishable, self-contained UI);
  publish `scheduler`+`reset-detector` after breaking coupling §5.3; list crew plugin in a
  marketplace (git source works today). Delivers the three headline partial adoptions (docs only /
  lookout only / crew only) with ~zero architectural work.
- **Phase 2 -- Bridge stations à la carte.** Publish `suite-conventions`, then `ship-log`,
  `ship-ledger`, `ship-inbox`, `settings-manager`, `skill-analytics` (standalone bins + MCP
  already exist, §2). Document the degraded modes (spool drain by next `ship-log` run --
  `plugins/crew/README.md:85`).
- **Phase 3 -- configurable hull.** Make `ship`'s station roster config-driven with optional
  peers (§5.1); duplicate-tab guard already exists (`ship/src/hull.ts:71-82`), and
  `/api/hull/stations` already drives the UI, so the Deck needs no change to tolerate any subset.
- **Phase 4 (optional) -- Deck UI splitting** (§5.2), only if bundle ownership/size matters.
- **Phase 5 -- Sea Chest/Harbor** stays on its seam; separate track gated on the hosted platform
  (unproven npm-registry install path, `sea-chest/README.md:47-50`).

## 7. Partial-adoption setup guide sketch

- **Docs only (Chart Room):** `npm i -g chartroom` (post Phase 1: works from npm today only via
  repo checkout) -> `chartroom register <repo>` -> `chartroom init` -> `chartroom serve`
  (Docs-only Deck, `App.tsx:155,183-185`) -> optional `chartroom install-skill` +
  `install-agent-hook` + `chartroom mcp`. No hull, no stations, no plugin required.
- **Lookout only:** install `lookout` bin -> `lookout init` -> `lookout watch`/`wait`/`guard
  install --print` (`plugins/crew/skills/graceful-pause/SKILL.md:29-47`). Optional: crew plugin's
  graceful-pause skill for protocol guidance; no server component at all.
- **Crew plugin only:** `claude plugin install ship-crew` -> set `{ "ship": { "scrutiny": ... } }`
  (`plugins/crew/README.md:28-40`). Hooks fail open with no Bridge (`emit.mjs:11-13`); events
  spool to `~/.ship/spool/` and are simply never drained until a `ship-log`/`ship serve` appears.
- **Changelog/ledger/inbox without the Deck:** run `ship-log`/`ship-ledger`/`ship-inbox` bins;
  add MCP servers per `plugins/crew/README.md:68-71`.
- **Full suite:** install all + `ship serve` = one port, all tabs (`ship/src/commands/serve.ts:44-49`).

## Unverified / flagged

- npm name availability for every package (all descriptions defer naming; `ship` is taken --
  `ship/package.json:4`). Not checked against the live registry.
- Sea Chest's `claude plugin install` via custom npm registry end-to-end (flagged unproven by the
  package itself, `sea-chest/README.md:47-50`).
- Whether standalone station bins (`ship-inbox`, `ship-log`, ...) serve any UI at all was inferred
  from the absence of `dist/public` copy steps in their package.json scripts -- not run.
- Bundle-size cost of the monolithic Deck (§5.2) asserted from source structure, not measured.
