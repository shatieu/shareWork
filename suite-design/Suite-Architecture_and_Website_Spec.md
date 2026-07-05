# The Ship — Suite Architecture, Hosting & Website Spec

**Prepared for:** Ondřej · **Date:** 4 July 2026
**Status:** decision-complete. This is the tie-together doc — read it first; per-product specs live beside it in `suite-design/`.

---

## 1. Canonical naming (locked)

**The Ship** = the whole suite. One Ship, many stations:

| Name | What it is | Spec |
|---|---|---|
| **The Ship** | The suite / umbrella brand | this doc |
| **Captain's Deck** | The hull's UI: ONE local app where every locally hosted station renders as a tab — Chart Room, inbox, settings manager, console, analytics, and anything else displayable. Keep it all simple: if it runs locally and has output, it shows on the Deck. | `Ship_Spec.md` §2 (hull revision) |
| **Chart Room** | MD management: browser edit, interactive blocks, self-healing ID links, MCP — first tab on the Deck | `ChartRoom_Spec.md` |
| **Bridge** | Fleet glue + console: ledger, changelog, human-action inbox, fleet view | `Ship_Spec.md` (product renamed Bridge; `ship-*` service names kept) |
| **Crew** | The Claude Code plugin: First Officer + crew subagents, scrutiny presets, hooks | `Ship_Spec.md` §7 |
| **Comm** | Voice fleet control from the phone (Council/Direct modes) | `VoiceBridge_Spec.md` |
| **Sea Chest** | Your hosted Claude identity: skills/agents/settings + marketplace + secrets seam | `Locker_Spec.md` |
| **Harbor** | The hosted platform: Team Tasks, Sea Chest, Comm relay, website | this doc §4 |
| **Quartermaster / Navigator / Shipwright / Inspector / Devil's Advocate** | Crew roles | `Ship_Spec.md` §7 |
| Settings manager · Skill analytics · Scheduler | Auxiliary tools (nautical names when they ship) | `Trio_Specs.md` |

"Team Tasks" stops being a standalone brand — it's Harbor's team-work feature. claude-peers (adopted OSS) becomes the Bridge's messaging substrate.

## 2. The system map — what runs where

**Local (npx; everything works with zero cloud) — REVISED 5 July 2026 to ONE HULL:**
One local process (`ship serve`), one port, one UI shell with tabs — Chart Room's daemon is the host; ship-ledger, ship-log, ship-inbox, ship-console, settings manager mount as encapsulated Fastify plugins. Each remains an independent package with its own storage and standalone `bin`; modules communicate only through the host's typed contracts. ship-voice, skill-analytics CLI, scheduler/Lookout remain separate processes by nature (voice daemon, CLI, sensor). See Ship_Spec §2 for the revision rationale.

**Plugin-distributed (native Claude Code marketplace rail):**
Crew plugin (subagents, skills, http hooks, presets) · chart-room skill · permission template packs. Distributed from Harbor's marketplace endpoints — suite-official packs and users' own Sea Chest items ride the same rail.

**Hosted (Harbor — ONE Next.js + Supabase deployment on Vercel; open source, self-hostable):**
Team Tasks (multiplayer work) · Sea Chest + community marketplace · Comm relay (WSS; if Vercel WSS is awkward, a small Fly.io sidecar for the relay only) · the website itself (§5).

**Mobile:** Comm Flutter app (App Store / Play).

**Cloud spine pattern:** local is truth for live state; Harbor is the sync/handoff layer — ledger items promote/pull across your computers (personal team), Sea Chest carries your identity, relay carries your voice. No local feature ever *requires* Harbor.

## 3. Monorepo (fresh repo, named after the suite — decision)

```
ship/                       # pnpm workspaces + turborepo, MIT
  apps/
    harbor/                 # the hosted platform (migrated team-tasks app, renamed, landing+docs added)
    comm-mobile/            # Flutter app
  packages/
    chartroom/              # each independently npx-installable
    ship-ledger/  ship-log/  ship-inbox/  ship-console/  ship-voice/
    settings-manager/  skill-analytics/  scheduler/
    reset-detector/         # standalone library (scheduler core)
    suite-conventions/      # services.json, event shapes, ${locker:} resolver
  plugins/
    crew/  chart-room-skill/  template-packs/
  suite-design/             # these specs, migrated from shareWork
```
Migration: move `team-tasks` → `apps/harbor`; rename the Vercel project; shareWork repo stays as design archive. Docs in the monorepo are Chart-Room-managed from day one (ids, fragment changelog) — first dogfood.

## 4. Harbor — hosted scope & model

- **Auth:** existing Supabase auth (magic link + GitHub), one account across Team Tasks, Sea Chest, Comm pairing.
- **Positioning (decision): free while beta; self-hosting always free; everything OSS.** Monetization (storage/relay-minutes/team tiers) decided later with real usage data. No billing code in v1.
- **Self-host story is a feature, not an afterthought:** one Supabase project + one Vercel/Node deployment; docs treat "our Harbor" and "your Harbor" as equal peers (the Sea Chest MCP URL and marketplace URLs are just different hosts).

## 5. The website (decision: one app — landing + platform together in `apps/harbor`)

**IA:**
- `/` — the story. Lead with the pain, not the tech: *"Run many Claudes without losing the plot — docs that don't rot, a fleet you can hear, a setup you own."* One command / one MCP-add quickstart above the fold. Product cards → station pages.
- `/stations/*` — one page per product (Chart Room, Bridge, Crew, Comm, Sea Chest): what it does, 30-second demo GIF, `npx` install, GitHub link.
- `/docs` — **rendered by Chart Room itself** (dogfood #1): the monorepo's MD docs served through the Chart Room engine — id links, collapsing, `:::llm` blocks visible in the wild.
- `/changelog` — **compiled from our own ship-log fragments** (dogfood #2): the public build-in-the-open feed.
- `/marketplace` — community browse: published Sea Chest items + suite-official packs; every item shows its `claude plugin marketplace add` one-liner.
- `/app/*` — signed-in Harbor: Team Tasks boards, Sea Chest management, Comm pairing, tokens/settings.
- Open-source-first presentation: GitHub stars/links prominent, self-host guide top-level in docs, "hosted or self-hosted" toggle on every setup snippet.

**Launch content:** landing + Chart Room station page + docs + changelog can go live as soon as Chart Room phase 2 exists (it renders its own docs) — the site grows a station page per shipped product rather than waiting for the whole fleet.

## 6. Build sequencing across the suite (consolidated from all specs)

**Wave 1:** Chart Room (phases 1–5) · Bridge phases 1–3 (plugin+hooks+log → ledger → inbox) · settings manager (pulled forward — simulator → editor-with-rails → packs) · Harbor rename/migration + landing skeleton.
**Wave 2:** Crew (Bridge phase 4) · Bridge console + Team-Tasks sync (phase 5) · Sea Chest phases 1–3 (MCP tools → marketplace serving → setup_machine + web UI).
**Wave 3:** Comm (phases 1–4: laptop service → browser client → relay → Flutter) · Sea Chest publishing + secrets seam · marketplace on the website.
**Wave 4:** skill analytics · scheduler (detector + queue) · config-matrix UI in console · Sea Chest E2E vault (adopt-vs-build: Infisical).

Each wave leaves the previous shippable; every product remains standalone-useful (a Chart-Room-only user or Crew-only user is a fully supported persona).

## 7. Definition of done — suite launch (end of wave 3)

- A stranger lands on the website, understands the Ship in one screen, and gets one station running in under 5 minutes without an account.
- With an account: Sea Chest holds their setup; a second machine becomes theirs via one MCP connection; ledger items follow them across computers.
- Our own development runs on the Ship: docs in Chart Room, changelog from fragments, crew presets in every suite repo, permission requests answered from the inbox (or by voice).
- Harbor self-hosts from the README alone.
