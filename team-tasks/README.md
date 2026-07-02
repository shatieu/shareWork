# Team Tasks

A definer writes a task (spec + acceptance criteria) against a repo. A teammate connects their
Claude Code to this app's hosted MCP server, claims the task, works it locally on a branch, and
reports progress + hands over a PR — all visible live on the board. See
`../TeamTasks_MVP-Product-Spec.md` for the full product spec.

## Stack

Next.js 16 (App Router, Turbopack) · Supabase (Postgres, Auth, RLS, Realtime) · `mcp-handler`
for the hosted MCP server · Tailwind v4.

## Local setup

1. **Install deps**
   ```bash
   npm install
   ```
2. **Environment** — copy `.env.example` to `.env.local` and fill in the four values from your
   Supabase project (Settings → API):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` — **server-only, never expose to the client.** Used exclusively
     by the MCP server (`src/lib/supabase/service.ts`), which bypasses RLS and scopes every
     query to the caller's team in code.
   - `NEXT_PUBLIC_APP_URL` — defaults to `http://localhost:3000`.
3. **Database** — the schema (tables, enums, RLS policies, RPCs, Realtime) lives in Supabase
   migrations for the `team-tasks` project. If you're pointing at a fresh project instead,
   apply the migrations there (`supabase db push` or the Supabase MCP `apply_migration` tool)
   before running the app. After any schema change, regenerate `src/lib/database.types.ts` from
   the live project so `Relationships` stay accurate — a stale, hand-edited types file with
   empty `Relationships` is what causes join queries like `team_members.select("role, teams(*)")`
   to fail typechecking.
4. **Auth providers** — enable email (magic link) in Supabase Auth. For "Continue with GitHub",
   create a GitHub OAuth App and add its client id/secret under Supabase Auth → Providers →
   GitHub, with callback URL `<NEXT_PUBLIC_APP_URL>/auth/callback`.
5. **Run it**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000 — you'll be redirected to `/login`.

## Connecting a teammate's Claude Code

Sign in → **Settings** → generate a token → run the `claude mcp add --transport http ...`
command it shows you. That's it — the `teamwork` skill (`.claude/skills/teamwork/SKILL.md`)
then drives list → claim → work → report → submit against the MCP tools at `/api/mcp`.

## Deploy

Connect the repo to Vercel, set the four env vars above (mark `SUPABASE_SERVICE_ROLE_KEY` as
sensitive), and deploy. The MCP endpoint ships as part of the same deployment — no separate
service to run.
