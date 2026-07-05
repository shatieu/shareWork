---
id: team-tasks-mvp-product-spec-the-real-thing-vercel-supabase-fe-mcp
---

# Team Tasks — MVP Product Spec (the real thing: Vercel + Supabase + FE + MCP)

**Prepared for:** Ondřej · **Date:** 30 June 2026
**This supersedes** the git-native slice in `TeamTasks_MVP-Spec.md`. That was too thin. This is
the shippable MVP **product**: a deployed web app with a full frontend and a hosted MCP server
that teammates' Claude Code connects to. Deeper design rationale lives in
`Coworking-Platform_Research-and-Architecture.md`.

> **"Don't overcomplicate" means exactly one thing here:** don't stand up a heavy secrets vault.
> Everything else is just code — build it.

---

## 1. What we're building

A web app where one person writes a task (a spec against a repo), and a teammate's Claude Code
**connects to our hosted MCP server**, picks up the task, works on it locally, and reports
progress + hands over a result — all visible live in the web UI.

**The core loop the MVP must deliver end-to-end:**
1. Definer signs in, creates a **project** (points at a git repo) and a **task** (spec +
   acceptance criteria) in the FE.
2. Teammate connects their Claude Code to our MCP server once (URL + a personal token from the
   app's Settings page).
3. Teammate says *"help out"* → their Claude calls the MCP tools: lists open tasks, **claims**
   one, gets the spec + repo info, sets up the repo locally (clone + install skills via
   sharpSoftAIBase), works on a branch, **reports progress**, and **submits** a result (PR link
   + handover note).
4. Definer watches status + progress update **live** on the board, reviews the handover, and
   marks it **done** or **changes requested**.

---

## 2. Scope — in vs out (be strict)

**In (build now):**
- Email + GitHub sign-in; teams; create project; create/edit task; task board; task detail with
  live progress; review (approve / request changes); Settings page to connect Claude.
- Hosted **MCP server** with the worker tools below, authenticated by a per-user token.
- Live board updates (Supabase Realtime).
- Deploy to Vercel + Supabase.

**Out (deferred — keep the seam, don't build):**
- **Secure env/secret sharing** (vault + short-lived tokens). Tasks keep an `env_required`
  field (names only); the worker provides values locally. No vault now.
- Public projects, reviewer quorum, reputation, billing/SSO.
- Anything that runs the teammate's agent for them — the agent runs on their machine; we only
  broker tasks/results.

---

## 3. Stack

- **Next.js (App Router, TypeScript)** on **Vercel**. Tailwind + **shadcn/ui** for a clean FE.
- **Supabase**: Postgres, Auth (email + GitHub OAuth), **Row Level Security**, **Realtime**.
- **MCP server**: `mcp-handler` on a Next.js route (`app/api/mcp/[transport]/route.ts`),
  **Streamable HTTP**, wrapped with token auth. Pin `@modelcontextprotocol/sdk` ≥ 1.26.0.
- Data access: Supabase JS client; `@supabase/ssr` for cookie-based auth in the App Router.

(If you'd rather match getBetter's Neon+Drizzle, you can — but Supabase gives Auth + RLS +
Realtime out of the box and is the faster path to this multi-user app. Default to Supabase.)

---

## 4. Data model (Postgres, RLS on every table)

- **profiles** — `id` (=`auth.users.id`), `display_name`, `avatar_url`.
- **teams** — `id`, `name`, `created_by`.
- **team_members** — `team_id`, `user_id`, `role` (`owner|admin|member`). Drives RLS.
- **projects** — `id`, `team_id`, `name`, `repo_url`, `setup_profile`
  (`nextjs-supabase-vercel|python-service|minimal`), `default_branch`.
- **tasks** — `id`, `team_id`, `project_id`, `title`, `spec_md`, `acceptance` (jsonb: list of
  `{text, done}`), `status` (`open|claimed|in_progress|in_review|changes_requested|done|blocked`),
  `priority`, `assignee_id`, `branch`, `env_required` (text[]), `pr_url`, `handover_md`,
  `created_by`, `created_at`, `updated_at`.
- **task_events** — `id`, `task_id`, `actor_id`, `actor_kind` (`human|agent`), `type`
  (`created|claimed|progress|submitted|approved|changes_requested|blocked|comment`), `message`,
  `payload` (jsonb), `created_at`. **Append-only — this is the progress log + audit trail.**
- **access_tokens** — `id`, `user_id`, `team_id`, `name`, `token_hash`, `last_used_at`,
  `created_at`. Personal tokens for the MCP server (store only a hash).

RLS: every row scoped by `team_id`; a user sees rows for teams they're a member of. Put
`team_ids` in the JWT via a Supabase auth hook for fast policies, and index `team_id`.

---

## 5. Auth

- **Humans (FE):** Supabase Auth (email magic-link + GitHub OAuth). RLS enforces team isolation.
- **Agents (MCP):** a **personal access token** the user generates on the Settings page (shown
  once, stored hashed). The teammate adds it to Claude Code as a bearer header. The MCP server
  verifies the token (`withMcpAuth` → hash lookup), resolves `user_id` + `team_id`, and scopes
  every query to that team. This is the simple, fully-buildable MVP path — **no OAuth dance**.
  (Upgrade path later: Supabase's OAuth 2.1 server so agents "sign in with the app." Not now.)

---

## 6. The MCP server (worker-facing tools)

Hosted at `https://<app>/api/mcp`. All tools authenticated + team-scoped. Tool set:

- `list_projects()` → projects in the user's team(s).
- `list_available_tasks(project_id?, status="open")` → claimable tasks.
- `get_task(task_id)` → full spec, acceptance criteria, project repo info, `env_required`.
- `claim_task(task_id)` → set `claimed` + `assignee`; writes a `claimed` event; returns the task
  + repo url/profile/branch so the agent can set up locally. Rejects if already claimed.
- `report_progress(task_id, message, checklist?, status?)` → appends a `progress` event, may
  flip acceptance items, sets `in_progress`. This is what makes the board move live.
- `submit_result(task_id, pr_url, handover_md)` → set `in_review`, store PR + handover, write a
  `submitted` event.
- `get_review_feedback(task_id)` → returns review comments if `changes_requested`.
- `request_clarification(task_id, questions)` → posts one or more structured questions (choice,
  free text, rating, ranking, comparison — same schema as the standalone `ask-human` skill) as an
  interactive form on the task's page; writes a `comment` event carrying the questions in
  `payload`, no schema change needed. Returns a `request_event_id`.
- `get_clarification_answers(task_id, request_event_id)` → `{ answered: false }` until the
  definer submits the form, then `{ answered: true, answers }`. Not meant to be polled in a tight
  loop — the agent checks back when told to, or before it needs the answer.

Scopes/permissions: a token can read/claim/submit within its team only. Keep tool descriptions
crisp so Claude uses them well.

---

## 7. Frontend (pages)

- `/login`, `/signup` — Supabase auth.
- `/` — dashboard: your team(s), quick board, "Connect your Claude" CTA.
- `/projects` — list + create (name, repo_url, setup_profile, default_branch).
- `/board` — **kanban by status**, filter by project, shows assignee + last progress; **updates
  live** (Realtime). The "who's working on what" view.
- `/tasks/new` — create task: title, project, spec (markdown editor), acceptance criteria
  (checklist), priority, `env_required`.
- `/tasks/[id]` — detail: spec, status, assignee, **progress timeline** (from `task_events`),
  handover + PR link, acceptance checklist; buttons: **Approve** / **Request changes** / Reopen.
  Any unanswered `request_clarification` shows as an inline interactive form at the top of the
  page — the definer answers there, no separate tool needed.
- `/settings` — team + members (invite by email/join code); **generate MCP token**; show the
  exact `claude mcp add` command + endpoint so a teammate can connect in one copy-paste.

Keep it clean and minimal but real — shadcn components, responsive, dark-mode optional.

---

## 8. Realtime / presence

Subscribe the board and task-detail pages to Supabase Realtime on `tasks` + `task_events` so a
claim or progress update from a teammate's agent appears without refresh. (Presence of *live*
agents is nice-to-have; status+assignee+latest-event is enough for the MVP.)

---

## 9. The worker side (how a teammate's Claude actually does it)

- **Connect once:** Settings page gives the MCP URL + token + the `claude mcp add --transport
  http ...` command (with the bearer header). After that, the tools are available in Claude Code.
- **The `teamwork` skill** (rewrite of the scaffolded one) now calls the **MCP tools** instead of
  editing markdown: list → claim → get_task → set up repo → work → report_progress → submit. The
  "set up repo" step still **reuses sharpSoftAIBase** (`sync.mjs`) to clone + install skills/hooks
  locally. Ship this skill in the repo (and optionally as a Claude plugin) so "help out" works.
- **Repo setup / "download skills":** `get_task`/`claim_task` return `repo_url` + `setup_profile`;
  the agent clones if missing and runs sharpSoftAIBase to install the per-project skills/config.

---

## 10. Build order (phases, each shippable)

1. **Scaffold + auth + schema (day 1).** Next.js on Vercel, Supabase project, tables + RLS, email/
   GitHub login, team creation. Deploy a hello-world to Vercel early.
2. **Core FE (day 1–2).** Projects CRUD, task create/edit, board, task detail with timeline.
   Acceptance: a human can create a project + task and move it across statuses in the UI.
3. **MCP server + tokens (day 2–3).** `/api/mcp` with the 7 tools, PAT auth, team scoping;
   Settings page token generation + connect instructions. Acceptance: connect Claude Code, run
   `list_available_tasks` and `claim_task` from a real session.
4. **End-to-end loop + Realtime (day 3).** A teammate's Claude claims → progresses → submits, and
   the board updates live; definer approves/requests changes. Acceptance: the full §1 loop works.
5. **The teamwork skill + sharpSoftAIBase wiring (day 3–4).** "Help out" drives the loop and sets
   up the target repo. Acceptance: a teammate goes from "help out" to an open PR with minimal help.

---

## 11. Deploy

- **Supabase:** create project; run migrations (SQL or Supabase CLI); enable email + GitHub auth;
  set the JWT team-claim hook.
- **Vercel:** connect the repo; set env (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL`); deploy. Mark the service-role key **sensitive**.
- The MCP endpoint is just a route on the same deployment.

---

## 12. Definition of done (MVP)

- Deployed on Vercel, backed by Supabase, reachable by the team.
- A definer can create a project + task in the UI.
- A teammate connects Claude Code via the Settings token and, from "help out," claims → works →
  reports → submits a PR, with the board updating live.
- The definer reviews and marks done / requests changes.
- `env_required` is captured but values stay local (no vault). Secret broker, public projects,
  and OAuth-for-MCP are clean future add-ons, not blockers.
