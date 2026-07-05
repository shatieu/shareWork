---
id: the-sea-chest-design-spec-v1-formerly-the-locker-naming-settled-see-suite-architecture-and-website-spec-md
---

# The Sea Chest — Design Spec (v1) *(formerly "the Locker"; naming settled — see Suite-Architecture_and_Website_Spec.md)*

**Prepared for:** Ondřej · **Date:** 4 July 2026
**Status:** decision-complete for v1.
**Context:** product #7 — the piece that turns the hosted app into a platform. Your entire Claude identity (skills, agents, hooks, settings templates, CLAUDE.md snippets, MCP configs, crew presets, plugin selections) stored securely outside Anthropic — on the suite's hosted instance or self-hosted — pullable to any machine/project, pushable from any session, publishable to the community.

---

## 1. Decisions (locked 4 July 2026)

- **Placement:** extends the existing hosted app (Team Tasks Next.js/Supabase — being renamed into the suite platform). New tables, new MCP tools on the existing `/api/mcp`, marketplace endpoint. One deployment, shared auth.
- **Encryption:** config items server-readable (RLS-isolated per user/team) → enables web UI, marketplace serving, search, sharing. **Secrets always E2E** (client-side encrypted, server sees ciphertext only).
- **Secrets timing:** seam in v1 (`${locker:name}` refs + local injection), vault in phase 2 — evaluate adopting Infisical (OSS, self-hostable) before writing crypto ourselves.
- **Sharing:** personal + **public publishing** — a locker item can be published to the suite's community marketplace on the landing page.

## 2. The two native rails (no custom sync protocol)

### 2.1 Your locker IS a plugin marketplace
Claude Code's native packaging for skills/agents/hooks/MCP is plugins + marketplaces. The platform serves each user's locker as a **private, token-authed marketplace endpoint**:
```
claude plugin marketplace add https://<platform>/u/<user>/marketplace?token=...
/plugin install my-crew-setup
```
Versioning, enable/disable toggles, `/plugin update` — all inherited from Claude Code. Locker items are stored as plugin-shaped bundles so this serving is a projection, not a conversion.

### 2.2 MCP for the conversational direction
New tools on the platform's existing MCP server:
- `locker_list(kind?)` — what's in my locker.
- `locker_pull(item, target_path?)` — fetch into the current project.
- `locker_push(path, name?, kind?)` — "store this skill in my locker" from inside any session; version bump on re-push.
- `locker_setup_machine(profile?)` — the one-step new-laptop flow: installs the marketplace, pulls global settings templates, registers suite services. A fresh machine becomes yours with one MCP connection + one sentence.
- `locker_diff(item)` — local copy vs locker version (feeds the config-matrix UI later).

## 3. Data model (platform Supabase, RLS on everything)

- **locker_items** — `id, user_id, team_id?, kind (skill|agent|hook|settings_template|claude_md|mcp_config|preset|plugin_bundle), name, description, content (jsonb/text), version, published (bool), created/updated`.
- **locker_versions** — append-only version history per item.
- **published_items** — projection of `published=true` into the public community marketplace (landing page browse + `claude plugin marketplace add <platform>/community`). Moderation: report + takedown, curated "verified" tier for suite-official packs (crew, permission templates).
- **secrets** (phase 2) — `user_id, name, ciphertext, key_hint`. Server never holds keys.

## 4. Secrets seam (v1) → vault (phase 2)

- **v1:** config items reference secrets by name — e.g. an MCP config stores `"token": "${locker:github_pat}"`. The suite CLI resolves refs **at injection time** from a local keystore (`~/.suite/secrets.local.json`, chmod 600) into spawned-session env / `.env.local` — never into committed files. New machine: you re-enter secret values once; everything else is one-step. This also closes Team Tasks' deferred `env_required` seam — same syntax, suite-wide.
- **Phase 2:** hosted vault — client-side encryption (libsodium; passphrase/device-key), multi-device key sync, server stores ciphertext only. Decision gate: adopt Infisical vs build. Injection path unchanged — only the source of values moves.

## 5. Web UI (on the platform)

Locker page: browse items by kind, version history, edit metadata, publish toggle, per-item install snippet. Machine profiles ("laptop-default", "work-vm") = named sets of items for `locker_setup_machine`. Published items get public pages (the landing page's community section grows out of this).

## 6. Suite integration

- **All suite modules are locker-distributable**: ship-crew plugin, chart-room skill, permission template packs — installable via the same marketplace rail users' own items use. "Install the suite" and "install your own setup" are the same gesture.
- **Ship config-matrix UI** (console, later) reads locker state to show items × projects with toggles; `locker_diff` powers drift detection.
- **Settings manager** template packs are locker items of kind `settings_template`.

## 7. Build order

1. **Tables + MCP tools** (`list/pull/push`) + RLS. Acceptance: push a skill from one machine, pull on another via MCP.
2. **Marketplace serving** (private, token-authed) + plugin-bundle projection. Acceptance: native `/plugin install` of your own locker item on a fresh machine.
3. **`locker_setup_machine` + machine profiles + web UI.** Acceptance: fresh laptop → add MCP → "set me up" → crew, skills, templates, settings live.
4. **Secrets seam:** `${locker:...}` resolution in suite CLI injection. Acceptance: an MCP config with a secret ref works after entering the value once locally.
5. **Publishing:** publish flag, community marketplace endpoint, landing-page browse. Acceptance: a stranger installs your published skill via the community marketplace URL.
6. *(Phase 2)* Hosted E2E vault.

## 8. Definition of done (v1 = phases 1–5)

- Your whole Claude setup round-trips: push from any session, pull to any machine, one-step new-machine setup minus secret values.
- Locker serves as a native plugin marketplace; zero custom client needed beyond the suite CLI conveniences.
- Secret values never touch the server or any committed file in v1; refs make configs portable anyway.
- Published items installable by anyone; RLS keeps unpublished items invisible.
- Self-hosters get identical behavior from their own instance.
