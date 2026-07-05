---
id: kickoff-prompt-for-claude-code-build-the-team-tasks-product
---

# Kickoff prompt for Claude Code — build the Team Tasks product

Run Claude Code from `C:\thisismydesign\`. Paste the prompt below. It's a real, deployed product
build (Vercel + Supabase + full FE + hosted MCP), done in phases.

---

You're building **Team Tasks**, a real, deployed web product — not a prototype or a
markdown/CLI tool. Build it in phases and deploy it.

**Source of truth — read first, in order:**
1. `C:\thisismydesign\shareWork\TeamTasks_MVP-Product-Spec.md` — the scoped build spec. Follow it.
2. `C:\thisismydesign\shareWork\Coworking-Platform_Research-and-Architecture.md` — deeper rationale
   (stack choices, MCP-on-Vercel, Supabase auth/RLS/Realtime). Reference, don't build the whole vision.
3. `C:\thisismydesign\sharpSoftAIBase\SETUP.md` + `base/.claude/skills/` — our base-repo installer.
   The worker-side "set up the repo + install skills" step reuses this AS-IS. Don't modify it.
4. `C:\thisismydesign\shareWork\team-tasks-starter\` — reference only, for the task schema and the
   `teamwork` skill shape. The backend is now the web app + MCP, not markdown-in-git.

**What it is:** a definer creates a project (a git repo) and a task (spec + acceptance criteria) in
the web UI; a teammate connects their Claude Code to our hosted MCP server with a token from the
Settings page; the teammate says "help out" and their Claude lists → claims → sets up the repo
(clone + sharpSoftAIBase) → works on a branch → reports progress → submits a PR + handover; the
definer sees it update live and approves or requests changes.

**Stack (decided — don't dither):**
- Next.js (App Router, TypeScript) on Vercel; Tailwind + shadcn/ui.
- Supabase: Postgres + Auth (email magic-link + GitHub OAuth) + RLS + Realtime; `@supabase/ssr`.
- Hosted MCP server via `mcp-handler` at `app/api/mcp/[transport]/route.ts`, Streamable HTTP,
  `@modelcontextprotocol/sdk` ≥ 1.26.0.
- MCP auth = **per-user personal access token** (generated in Settings, stored hashed, sent as a
  bearer header). NOT OAuth — keep it simple. Humans use Supabase Auth.

**Scope discipline:**
- Build everything in the product spec: auth, teams, projects, tasks, board, task detail with live
  progress timeline, review (approve / request changes), Settings + token, the 7 MCP tools, Realtime.
- **Defer ONLY the secret/env vault.** Tasks keep an `env_required` field (names only); the worker
  supplies values locally. Do not build a vault. Everything else is just code — build it.
- Don't build public projects, billing, SSO, or anything that runs the teammate's agent for them.

**How to work:**
1. Read the four sources. Then ask me only the questions you truly can't proceed without:
   - Supabase: should you create a new project (I'll log in / give keys) or use one I provide?
   - Vercel: deploy under my account — confirm I'll connect it / provide a token.
   - GitHub OAuth app for sign-in: I'll create it and give client id/secret, or you guide me.
   - Where the repo lives: default `C:\thisismydesign\team-tasks` (git init there).
   Confirm the stack above (or tell me to switch to Neon+Drizzle).
2. Propose a short phase plan matching the spec's build order (scaffold+auth+schema → core FE →
   MCP+tokens → end-to-end loop + Realtime → teamwork skill). Use your todo list.
3. Build phase by phase. After each phase: run typecheck + build, fix all errors, and tell me how
   to see it working (local URL or Vercel preview). **Deploy to Vercel early** (after phase 1) so we
   always have a live URL.
4. At the MCP phase, give me the exact `claude mcp add` command + token so I can connect a real
   Claude Code session and we test `list_available_tasks` / `claim_task` for real.
5. Rewrite the `teamwork` skill (from the scaffold) to drive the MCP tools and do the repo setup via
   sharpSoftAIBase. Ship it in the repo.

**Guardrails:**
- Branch + PR; never push to `main`. Never commit secrets or `.env`; mark the Supabase service-role
  key as a sensitive env var on Vercel.
- Enable RLS on every table and verify team isolation before calling a phase done.
- Keep `env_required` as a name-only field — leave the seam for a future secret broker, but build no
  vault now.

Start by reading the four sources, asking your blocking questions, and proposing the phase plan.
Once I confirm, build phase 1 and deploy it.

---

**Shorter dive-in variant:**

> Read `C:\thisismydesign\shareWork\TeamTasks_MVP-Product-Spec.md` (and the architecture doc beside
> it). Build it for real: Next.js + Supabase + shadcn on Vercel, with a hosted `mcp-handler` MCP
> server (per-user token auth) exposing list/claim/get/report/submit task tools, full FE (board, task
> detail with live timeline, create task, review, Settings+token), Realtime board. Reuse
> `C:\thisismydesign\sharpSoftAIBase` for the worker's repo setup. Defer ONLY the secret vault
> (`env_required` is name-only). Repo at `C:\thisismydesign\team-tasks`. Ask me for Supabase/Vercel/
> GitHub-OAuth access, propose a phase plan, deploy phase 1 to Vercel early, then build through to the
> full claim→work→report→submit→review loop.
