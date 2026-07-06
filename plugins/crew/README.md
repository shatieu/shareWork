---
id: crew-plugin-readme
---

# ship-crew (Crew plugin) — phase 1

The Crew plugin's phase-1 payload: http hooks that feed `ship-log`'s changelog capture
(Ship_Spec §7, §2 one-hull revision; `suite-design/overnight/plans/04-bridge-phase1-plan.md`).
No roles, scrutiny presets, or FO orchestration yet — those are Bridge phase 4 (package 8);
`agents/` and `skills/` are seam stubs.

## What's here

- `.claude-plugin/plugin.json` — plugin manifest (`name: ship-crew`).
- `hooks/hooks.json` — registers `SessionStart`, `Stop`, `SessionEnd`, `Notification`,
  `TaskCreated`, `TaskCompleted` against `hooks/emit.mjs`. **`PermissionRequest` is deliberately
  NOT registered** — it needs a *blocking* emitter variant (stdout resolves the prompt
  synchronously); that's package 6's job (`emit-blocking.mjs` seam). Registering it here with the
  fire-and-forget `emit.mjs` would silently ignore the one event that actually needs a response.
- `hooks/emit.mjs` — the http-hook emitter. Stdlib-only, always exits 0 (fail-open — a logging
  hook must never block or degrade a session). Tries to POST the hook envelope to a running hull
  (`~/.suite/services.json` discovery, 700ms timeout — see
  `suite-design/overnight/reports/04-bridge-phase1-researcher.md` R3 for why 700ms, not the
  originally-planned 1.5s: a `-p` session's SessionEnd hooks only get ~1.3-1.5s of exit grace
  before Claude Code cancels them outright). On any failure (no hull, refused, timeout, non-2xx)
  it appends the envelope as one JSONL line to `~/.ship/spool/events.jsonl` instead — nothing is
  lost, just delayed until the next `ship serve` (or `ship-log serve`) drains the spool.

## Install (local, this machine — no marketplace distribution yet)

Two supported mechanisms (report 04 R2, empirically verified):

**A. Session-only (fastest to try):**
```
claude --plugin-dir <path-to-this-directory>
```

**B. Persistent, project-scoped (what the scratch-repo test recipe and dogfood use):**
```
claude plugin marketplace add <path-to-shareWork-repo-or-this-plugin-dir>
claude plugin install ship-crew --scope project
```
This writes `enabledPlugins` into that project's `.claude/settings.json` (shared, committed) —
or `--scope local` for a gitignored per-user variant.

Hook changes need `/reload-plugins` or a fresh `claude` invocation to take effect.

## Scratch-repo test recipe (used by the live acceptance proof)

1. `mkdir` a throwaway git repo, `git init`, one commit.
2. Install the plugin per (B) above, scoped to that repo.
3. Start the hull: `ship serve` (or point `--voyage` wherever) from *this* monorepo, or
   `ship-log serve` standalone for a hull-less run.
4. Run `claude -p "<a tiny prompt>" --model haiku --allowedTools "Read"` **from inside the
   scratch repo** (cwd matters — project-scoped hooks fire based on cwd).
5. Look for `<scratch-repo>/changelog/entries/<date>--...--<session8>.md` and a SQLite row in
   `~/.ship/log.db` (or whatever `--homeDir` override the harness used).

Do this twice, in two different scratch repos, then `POST /api/ship-log/rollup/<date>` to get a
digest covering both — the literal Ship_Spec §9.1 acceptance line.

## Dogfood recipe (this repo, authorized by the package-4 dispatch)

Same as (B) above, scoped to `shareWork` itself (`claude plugin install ship-crew --scope
project` from the repo root) — every real session here from then on produces
`changelog/entries/<date>--...--<session8>.md` fragments at the repo root (product fragments;
**distinct from** `suite-design/overnight/changelog/entries/`, the mission's own hand-written
tracking convention — the two never collide, different directories, different authorship).
Per DECISIONS-NEEDED.md "Package 4" #3, the default is that these fragments get committed (they
are the product's shareable form and Chart Room renders `changelog/entries/` like any other doc
directory) — flip to gitignored if the Captain would rather this repo's history stay quiet.

## Failure modes are all fail-open

- Hull down / `~/.suite/services.json` missing or stale → spool, drained on the next `ship serve`
  start (or `ship-log rollup`, which drains before building).
- `claude` itself times out mid-hook → `emit.mjs` still exits 0 (Claude Code cancels it anyway
  past ~1.3-1.5s; the short fetch timeout keeps the emitter's own logic from being the slow part).
- Malformed/unknown hook JSON → `emit.mjs` exits 0 silently; a malformed *spooled* line lands in
  `~/.ship/events-unknown.jsonl` on drain (ship-log's problem, not the emitter's).
