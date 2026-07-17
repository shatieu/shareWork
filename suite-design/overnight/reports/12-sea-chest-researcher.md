---
id: sea-chest-researcher-report-plugin-marketplace-facts
---

# 12-sea-chest Researcher Report — Claude Code plugin marketplace facts

Package: 12-sea-chest (Locker_Spec.md). Purpose: verify facts gating phase-2 design
(serving a user's locker as a private token-authed marketplace, §2.1/§7 build order
item 2). All facts below verified live against https://code.claude.com/docs on
2026-07-06 via WebFetch (full page text captured), plus one WebSearch/WebFetch to
GitHub for an auth feature-request issue. No training-data facts used unmarked.

Sources fetched in full:
- https://code.claude.com/docs/en/plugin-marketplaces ("Create and distribute a plugin marketplace")
- https://code.claude.com/docs/en/plugins-reference ("Plugins reference")
- https://code.claude.com/docs/en/plugins ("Create plugins")
- https://code.claude.com/docs/en/discover-plugins ("Discover and install prebuilt plugins through marketplaces")
- https://github.com/anthropics/claude-code/issues/9756 (closed feature request, "Support Auth on Private Marketplaces and Plugins")

---

## R1 — Marketplace manifest schema (`.claude-plugin/marketplace.json`)

**VERIFIED.** Source: https://code.claude.com/docs/en/plugin-marketplaces, "Marketplace schema" section.

### Top-level required fields
| Field | Type | Notes |
|---|---|---|
| `name` | string | kebab-case, public-facing (`/plugin install x@name`). Reserved names blocked (list of ~14 official ones). |
| `owner` | object | `{name (required), email (optional)}` |
| `plugins` | array | list of plugin entries |

### Top-level optional fields
`$schema`, `description`, `version`, `metadata.pluginRoot` (base dir prepended to relative sources), `allowCrossMarketplaceDependenciesOn` (array), `renames` (object, map old-name→new-name-or-null, requires v2.1.193+). `description`/`version` also accepted nested under `metadata` for back-compat.

### Per-plugin-entry fields
Required: `name` (string), `source` (string|object).
Optional: `displayName`, `description`, `version`, `author`, `homepage`, `repository`, `license`, `keywords`, `category`, `tags`, `strict` (bool, default true — controls whether `plugin.json` or the marketplace entry is authoritative for components), `relevance` (object, v2.1.152+), `defaultEnabled` (bool, v2.1.154+), plus component-override fields `skills`, `commands`, `agents`, `hooks`, `mcpServers`, `lspServers` (string|array|object).

### ALL supported `source` types (exact JSON shapes)
Quote: "| Source | Type | Fields | Notes |" table, plugin-marketplaces doc, "Plugin sources" section:

1. **Relative path** — `"source": "./my-plugin"` (bare string, must start with `./`). "Local directory within the marketplace repo... Resolved relative to the marketplace root, not the `.claude-plugin/` directory." No `../`. Only works when the *marketplace* itself was added from git or a local dir — **does not work for URL-added marketplaces** (see R2).
2. **`github`** — object: `{"source":"github","repo":"owner/plugin-repo","ref?":"v2.0.0","sha?":"<40-char sha>"}`. `repo` required (`owner/repo`); `ref` optional (branch/tag); `sha` optional, pins exact commit.
3. **`url`** (git URL, NOT a generic HTTP file source) — object: `{"source":"url","url":"https://gitlab.com/team/plugin.git","ref?":"main","sha?":"<sha>"}`. `url` required, full git repo URL (`https://` or `git@`), `.git` suffix optional.
4. **`git-subdir`** — object: `{"source":"git-subdir","url":"...","path":"tools/claude-plugin","ref?":"...","sha?":"..."}`. Sparse/partial clone of a subdirectory in a monorepo; `url` also accepts GitHub `owner/repo` shorthand or SSH form.
5. **`npm`** — object: `{"source":"npm","package":"@acme/claude-plugin","version?":"2.1.0","registry?":"https://npm.example.com"}`. Installed via `npm install`; any public or private registry.

There is **no plain "http/https URL to an archive or directory" plugin-source type** distinct from the git-URL `url` source. The only URL-shaped source Claude Code clones via git protocol (`url`, `git-subdir`); there is no documented "download this .zip/tarball of a plugin from an arbitrary HTTP endpoint" source for marketplace-installed plugins. (The separate `--plugin-url` *session flag* does fetch a `.zip` over HTTP, but that is a CLI dev/test flag, not a marketplace `source` type — see R4.)

For git-based sources (`github`, `url`, `git-subdir`, and relative-path-in-git-marketplace): "When both `ref` and `sha` are set... the `sha` is the effective pin." Version resolution order: `plugin.json` version → marketplace-entry version → git commit SHA → (`unknown` for npm/non-git local dirs).

---

## R2 — `claude plugin marketplace add <arg>` argument forms and URL-hosted marketplace behavior

**VERIFIED.** Source: https://code.claude.com/docs/en/discover-plugins ("Add marketplaces") and https://code.claude.com/docs/en/plugin-marketplaces ("Manage marketplaces from the CLI").

### Accepted argument forms
Quote: "* **GitHub repositories**: `owner/repo` format... * **Git URLs**: any git repository URL... * **Local paths**: directories or direct paths to `marketplace.json` files * **Remote URLs**: direct URLs to hosted `marketplace.json` files"

- `owner/repo` GitHub shorthand, optionally `@ref` to pin branch/tag (e.g. `acme-corp/claude-plugins@v2.0`).
- Any git URL (`https://...git` or `git@...`), optionally `#ref` to pin (e.g. `.../plugins.git#v1.0.0`). Must include `.git` suffix or Claude Code may instead try to treat it as a direct marketplace.json URL; must include `https://` scheme (v2.1.196+ rejects bare hosts).
- Local directory or direct path to a `marketplace.json` file.
- **Direct HTTPS URL to a hosted `marketplace.json` file** — confirmed supported: `claude plugin marketplace add https://example.com/marketplace.json`.

### R2(a) — relative plugin `source` paths for a URL-hosted marketplace
**VERIFIED: unsupported.** Direct quote from plugin-marketplaces doc, "Plugins with relative paths fail in URL-based marketplaces": "URL-based marketplaces only download the `marketplace.json` file itself. They don't download plugin files from the server. Relative paths in the marketplace entry reference files on the remote server that were not downloaded." And from the "Relative paths" section: "Relative paths resolve against a local copy of the marketplace, so they work when users add your marketplace from a git source or a local directory. If users add your marketplace via a direct URL to the `marketplace.json` file, relative paths won't resolve, because only that file is downloaded. For URL-based distribution, use GitHub, npm, or git URL sources instead."
→ For a token-authed HTTP marketplace endpoint, every plugin entry's `source` MUST be `github`, `url` (git), `git-subdir`, or `npm` — never a relative path — because only the manifest JSON itself is fetched over plain HTTP.

### R2(b) — query string preservation on `/plugin update` / refresh
**UNRESOLVED — docs silent.** No page found that documents whether a query string on the marketplace-add URL (e.g. `?token=...`) is preserved verbatim on `/plugin marketplace update`/auto-refresh, or is stripped/re-derived. The docs only say marketplace state is "stored once per user in `~/.claude/plugins/known_marketplaces.json`" and that `/plugin marketplace list --json` echoes back `name`, `source`, and source-specific fields (`repo`/`url`/`path`, plus `ref` when pinned) — it does not show whether the exact original URL string (with query) is what's stored/reused, versus a normalized URL. Best evidence: since the URL is the entire addressing mechanism for a "remote URL" source (there is no separate `ref`/`token` field documented for URL-type marketplace sources, only for git-shaped `github`/`url`/`git-subdir` plugin sources), the whole string including any query is almost certainly stored as `source.url` and re-sent verbatim as a plain HTTP GET on refresh — but this is inference, not a documented guarantee. Recommend empirical verification (add a marketplace with a `?token=` URL, inspect `~/.claude/plugins/known_marketplaces.json`, then run `/plugin marketplace update` while watching the request) before relying on it in the phase-2 design.

### R2(c) — auth mechanism for private URL-hosted marketplaces
**VERIFIED for git-based sources; UNRESOLVED/apparently unsupported for plain-HTTP `marketplace.json` URL sources.**
- For git-based marketplace/plugin sources, docs give an explicit, documented mechanism (plugin-marketplaces doc, "Private repositories"): manual install/update uses existing git credential helpers (`gh auth login`, macOS Keychain, `git-credential-store`, SSH agent + known_hosts). For **background auto-updates** (which run without interactive credential prompts), set an env var:
  | Provider | Env vars |
  |---|---|
  | GitHub | `GITHUB_TOKEN` or `GH_TOKEN` |
  | GitLab | `GITLAB_TOKEN` or `GL_TOKEN` |
  | Bitbucket | `BITBUCKET_TOKEN` |

  These are consumed by git itself (via credential helper/env), not by Claude Code's marketplace-URL fetch path.
- For a marketplace added as a **plain HTTPS URL to `marketplace.json`** (the "remote URL" source, not git), no header/token/env-var auth mechanism is documented anywhere in plugin-marketplaces.md or discover-plugins.md. Confirmed by a closed upstream feature request, https://github.com/anthropics/claude-code/issues/9756, "[FEATURE] Support Auth on Private Marketplaces and Plugins": a user requested exactly this (private GitLab-hosted marketplaces for 200+ devs; proposed either git-auth reuse or "if it is a gitlab link AND `GITLAB_TOKEN` is present then use basic auth in the fetch"). The issue is **closed** but no maintainer resolution text was retrievable from the fetch (worth a manual look at the issue thread/linked PR before assuming it shipped as a real feature — closed ≠ confirmed-implemented). No current doc page describes header-based or bearer-token auth for the plain-URL marketplace source.
  → **Practical implication for the Sea Chest**: a query-string token (`?token=...`) embedded directly in the marketplace URL is the only mechanism with any documented support surface (since the URL is just fetched by whatever HTTP client Claude Code uses) — but there's no confirmation this is officially sanctioned/stable behavior, no documented way to rotate/expire it cleanly via the client, and R2(b) above (persistence across refresh) is unconfirmed.

---

## R3 — Plugin bundle layout

**VERIFIED.** Source: https://code.claude.com/docs/en/plugins-reference, "Plugin directory structure" and "Plugin manifest schema".

Exact expected root layout (quote, "Standard plugin layout"):
```
enterprise-plugin/
├── .claude-plugin/           # ONLY plugin.json goes here
│   └── plugin.json
├── skills/                   # <name>/SKILL.md dirs
├── commands/                 # flat .md files (legacy; skills/ preferred)
├── agents/                   # subagent .md files
├── output-styles/
├── themes/
├── monitors/
│   └── monitors.json
├── hooks/
│   └── hooks.json            # main hook config
├── bin/                      # added to Bash tool PATH
├── settings.json             # only `agent` + `subagentStatusLine` keys supported
├── .mcp.json                 # MCP server definitions
├── .lsp.json                 # LSP server configs
```
Explicit warning quoted: "Don't put `commands/`, `agents/`, `skills/`, or `hooks/` inside the `.claude-plugin/` directory. Only `plugin.json` goes inside `.claude-plugin/`. All other directories must be at the plugin root level."

`plugin.json` full schema (all fields, only `name` required if manifest present at all):
`name` (required, kebab-case), `displayName`, `version`, `description`, `author {name,email,url}`, `homepage`, `repository`, `license`, `keywords[]`, `skills` (string|array, adds to default), `commands` (string|array, replaces default), `agents` (string|array, replaces default), `hooks` (string|array|object), `mcpServers` (string|array|object), `outputStyles`, `lspServers`, `experimental.{themes,monitors}`, `dependencies[]`, `userConfig{}` (prompted-for values, supports `sensitive` for keychain storage), `channels[]`, `defaultEnabled` (bool). Manifest itself is **optional** — Claude Code auto-discovers components in default locations and derives the plugin name from the directory name if omitted.

File-locations table (exact paths Claude Code expects):
- Manifest: `.claude-plugin/plugin.json`
- Skills: `skills/<name>/SKILL.md`
- Commands: `commands/*.md`
- Agents: `agents/*.md`
- Hooks: `hooks/hooks.json`
- MCP: `.mcp.json` (plugin root, NOT inside `.claude-plugin/`)
- LSP: `.lsp.json`
- Monitors: `monitors/monitors.json`
- Executables: `bin/`
- Settings: `settings.json`

Important caching caveat directly relevant to Sea Chest's "plugin-shaped bundle projection" plan: "Claude Code copies *marketplace* plugins to the user's local plugin cache (`~/.claude/plugins/cache`)... Installed plugins cannot reference files outside their directory" — no `../shared-utils` references; use symlinks only within the same marketplace (dereferenced on copy) or within the plugin itself (preserved as relative symlink).

---

## R4 — File transfer mechanism for a URL-hosted marketplace install; what a server must serve

**VERIFIED — this is the load-bearing finding for phase-2.**

1. **The marketplace catalog itself**, when added via a plain HTTPS URL (`/plugin marketplace add https://.../marketplace.json`), is fetched with a single plain HTTP GET of that JSON file only. Quote (repeated across both marketplace docs and troubleshooting section): "URL-based marketplaces only download the `marketplace.json` file itself. They don't download plugin files from the server."
2. **Each individual plugin's files** are transferred strictly by one of the two mechanisms tied to its `source` type — there is no generic "serve plugin files over HTTP" path for marketplace-installed plugins:
   - `github` / `url` (git) / `git-subdir` → **git clone** (full or sparse-partial for `git-subdir`) of the pinned `ref`/`sha`.
   - `npm` → **`npm install`** of the named package/version from the (optionally private) registry.
   - Relative-path (`"./plugins/x"`) source → a **local filesystem copy** from the already-cloned/local marketplace working copy — only valid when the marketplace itself was added via git or a local directory, not via a plain URL (R2a).
   - After clone/npm-install/local-copy, Claude Code **always copies the result into `~/.claude/plugins/cache`** before use — this copy step happens regardless of source type.
3. There is a separate, session-only escape hatch — `--plugin-url` (CLI flag, not a marketplace mechanism): "fetches the archive at startup and loads it for that session only," accepting one or more `.zip` URLs, no persistence, no marketplace registration, no install/update lifecycle. Quote: "Claude Code fetches the archive at startup and loads it for that session only. If the fetch fails or the archive is invalid, Claude Code reports a plugin load error." Not usable for `/plugin install` or persistent installs — dev/test/CI-artifact use case only.

### What the Sea Chest server must actually serve for native `/plugin install` with zero custom client
- Serve `marketplace.json` at a stable HTTPS URL (optionally with a query-string token appended by the client at add-time — see R2b/R2c caveats on persistence/auth).
- Every plugin entry's `source` in that JSON must point to something **git-clonable** (a real git remote, e.g. `github` shorthand pointing at a repo Claude Code's user can auth to, or `url`/`git-subdir` pointing at an arbitrary git URL) or **npm-installable**. **A plain "GET this directory of files over HTTPS" projection of a locker item is NOT a supported plugin source** — this directly contradicts the Locker_Spec §2.1 framing of "serving is a projection, not a conversion" if the intended mechanism was a flat HTTP file server. To satisfy native `/plugin install`, the Sea Chest's per-item projection must expose (or proxy) a **git-speaking endpoint** per plugin bundle (e.g. a synthetic git remote/smart-HTTP git server serving each locker item as a repo, or push mirroring to a real git host) — not just an HTTP directory listing.
- Corollary: relative-path plugin sources (`"./plugins/x"`) cannot be used if the marketplace is added by URL — every entry needs a `github`/`url`/`git-subdir`/`npm` source, meaning the Sea Chest needs either (a) one git-clonable location per locker item, or (b) to publish locker items as npm packages, for install to work through the native URL-marketplace path.

---

## Summary verdicts (see also final chat message)
- R1: Fully documented, quoted above; all 5 source shapes enumerated exactly as they appear on the live docs page (dated 2026-07-06).
- R2: add-argument forms fully documented; (a) relative-path resolution for URL marketplaces is explicitly documented as **unsupported**; (b) query-string persistence across refresh is **undocumented/unresolved**, recommend empirical test; (c) auth for git-based sources is documented (env-var tokens consumed by git); auth for plain-URL marketplace.json fetches is **undocumented**, and a matching upstream feature request exists and is closed with unclear resolution — treat as unresolved/likely unsupported pending manual issue-thread review.
- R3: Fully documented; exact plugin.json schema and directory layout quoted above.
- R4: Fully documented and is the key constraint: URL-hosted marketplace = one JSON GET only; actual plugin transfer is always git-clone or npm-install, never generic HTTP file serving. This directly constrains the Sea Chest's marketplace-projection design (needs a git-clonable or npm-installable representation per locker item, not a flat file server).
