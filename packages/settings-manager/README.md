---
id: settings-manager
---

# settings-manager

Visual manager for Claude Code settings + permissions across scopes (`Trio_Specs.md` §B), mounted
into `ship serve` as the Captain's Deck **Settings** tab. Centerpiece: the **effective-permission
simulator** — load managed/local/project/user scopes, show the merged result with per-rule source
attribution, and answer *"would `Bash(rm -rf ./dist)` be allowed right now — and which rule in
which file decides?"*.

## The rails (non-negotiable, Trio_Specs §B)

Every write flows through `src/editor.ts` — there is no other write path in this package:

1. **Validate before any touch** — new content must parse and pass schema validation (unknown
   keys warn, wrong shapes on known keys block — mirroring Claude Code's own tolerant parsing).
2. **Diff preview is mandatory** — `apply` demands the `baseHash` ticket that only `preview`
   issues for the exact bytes being replaced; drift = typed `409 base-drift`, zero writes.
3. **Malformed target = typed refusal**, file byte-identical. Explicit `overwriteMalformedBase`
   exists as the documented recovery path (corrupt bytes are backed up first).
4. **Timestamped backups** under `~/.suite/settings-backups/` with `.meta.json` origin sidecars;
   never deleted. Restore = the backup's bytes through the same preview/apply gate.
5. **Atomic replace** — unique same-directory tmp file + rename (replaces on win32 too).
6. **JSON round-trip verification** before anything hits the disk.

## Simulator — provably read-only

`src/simulator.ts` / `src/merge.ts` / `src/rules.ts` never import `node:fs`; a dedicated test
scans the sources for write APIs and snapshots a scope directory (bytes + mtimes) across a
`simulate()` call. Semantics implemented from docs verified 2026-07-06 (see plan 07 §2): deny →
ask → allow first-match; permission arrays merge across scopes, scalars override by precedence
(managed → CLI → local → project → user); Bash glob/word-boundary/`:*` rules; compound-command
splitting; wrapper stripping; gitignore path anchors (`//`, `~/`, `/`=settings source, cwd);
WebFetch domain wildcards; MCP and `Tool(param:value)` rules.

**Honest limits** (surfaced as verdict `caveats`/`unevaluated`, never hidden): CLI-args scope,
PreToolUse hooks, sandbox auto-allow, the built-in read-only Bash set, workspace trust,
PowerShell alias canonicalization, symlink dual-path checks, and gitignore syntax outside the
modeled subset (`!`, `[...]`).

## Surfaces

- **Deck tab** (`ship serve` → Settings): simulator test bench, effective view, editor with
  diff-preview modal, template packs, ship-inbox "always allow" origins with one-click revoke,
  backup list + restore.
- **Station routes** `/api/settings-manager/*` — mutations require the `x-ship-deck` header, and
  project-scoped reads/writes are gated to chartroom-registered repos (`listRepoDirs` contract);
  managed and CLI scopes are never writable.
- **Standalone CLI** (read-only by design — editing lives behind the Deck's diff modal):

```sh
settings-manager effective --project .
settings-manager simulate Bash --command "rm -rf ./dist" --project .
settings-manager simulate WebFetch --url https://api.example.com
```

- **Library** (`settings-manager` / `settings-manager/station`): scopes, merge, simulate, rails
  editor, template packs.

## Template packs

`templates/*.json` — `safe-web-dev`, `read-only-audit`, `ci-headless`, `crew-defaults` — applied
additively (post-verified: original document preserved, only requested rules appended) through
the same preview/apply rails. Marketplace-repo versioning is parked in DECISIONS-NEEDED.

## Ship integration

ship-inbox exposes `alwaysAllowedRules` (every native rule its "always allow" flow wrote, with
cwd + date + backup path); this station lists them and revokes via `computeRemoveAllowRule` — a
subtractive edit post-verified to remove exactly the one rule, through the same rails.
