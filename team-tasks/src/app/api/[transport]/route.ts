import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";
import { hashToken } from "@/lib/tokens";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { TablesUpdate } from "@/lib/database.types";
import {
  clarificationQuestionSchema,
  asClarificationAnswer,
  type ClarificationRequestPayload,
} from "@/lib/clarification";

/**
 * Hosted at /api/mcp (Streamable HTTP) and /api/sse. This is the product's core
 * differentiator: a teammate's Claude Code connects here (Settings page gives the
 * URL + a personal access token) and drives the whole claim -> work -> submit loop
 * without ever touching the web UI.
 */

type TeamAuth = { userId: string; teamId: string; tokenId: string };

function teamAuth(authInfo: AuthInfo | undefined): TeamAuth {
  const extra = authInfo?.extra as TeamAuth | undefined;
  if (!extra) throw new Error("Missing team-tasks auth context");
  return extra;
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

const TASK_STATUSES = [
  "open",
  "claimed",
  "in_progress",
  "in_review",
  "changes_requested",
  "done",
  "blocked",
] as const;

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "list_projects",
      {
        title: "List projects",
        description: "List the projects (repos) available to your team.",
        inputSchema: {},
      },
      async (_args, extra) => {
        const { teamId } = teamAuth(extra.authInfo);
        const supabase = createServiceClient();
        const { data, error } = await supabase
          .from("projects")
          .select("id, name, repo_url, setup_profile, default_branch")
          .eq("team_id", teamId)
          .order("name", { ascending: true });
        if (error) throw new Error(error.message);
        return textResult(data);
      }
    );

    server.registerTool(
      "list_available_tasks",
      {
        title: "List available tasks",
        description:
          "List claimable tasks for your team, optionally scoped to one project. Defaults to open tasks.",
        inputSchema: {
          project_id: z.string().uuid().optional(),
          status: z.enum(TASK_STATUSES).optional().default("open"),
        },
      },
      async ({ project_id, status }, extra) => {
        const { teamId } = teamAuth(extra.authInfo);
        const supabase = createServiceClient();
        let query = supabase
          .from("tasks")
          .select("id, title, status, priority, project_id, spec_md, env_required, created_at")
          .eq("team_id", teamId)
          .eq("status", status)
          .order("created_at", { ascending: true });
        if (project_id) query = query.eq("project_id", project_id);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        return textResult(data);
      }
    );

    server.registerTool(
      "get_task",
      {
        title: "Get task",
        description:
          "Get the full spec, acceptance criteria, and project repo info for a task.",
        inputSchema: { task_id: z.string().uuid() },
      },
      async ({ task_id }, extra) => {
        const { teamId } = teamAuth(extra.authInfo);
        const supabase = createServiceClient();
        const { data: task, error } = await supabase
          .from("tasks")
          .select("*, projects(id, name, repo_url, setup_profile, default_branch)")
          .eq("id", task_id)
          .eq("team_id", teamId)
          .single();
        if (error || !task) throw new Error(error?.message ?? "Task not found");
        return textResult(task);
      }
    );

    server.registerTool(
      "claim_task",
      {
        title: "Claim task",
        description:
          "Claim an open task for yourself. Returns the task plus repo url/profile/branch so you can set up locally. Rejects if it's already claimed.",
        inputSchema: { task_id: z.string().uuid() },
      },
      async ({ task_id }, extra) => {
        const { teamId, userId } = teamAuth(extra.authInfo);
        const supabase = createServiceClient();

        const { data: current } = await supabase
          .from("tasks")
          .select("status, team_id")
          .eq("id", task_id)
          .maybeSingle();
        if (!current || current.team_id !== teamId) throw new Error("Task not found");
        if (current.status !== "open") throw new Error(`Task is already ${current.status}`);

        const { data: task, error } = await supabase
          .from("tasks")
          .update({ status: "claimed", assignee_id: userId })
          .eq("id", task_id)
          .eq("status", "open")
          .select("*, projects(id, name, repo_url, setup_profile, default_branch)")
          .single();
        if (error || !task)
          throw new Error(error?.message ?? "Task was just claimed by someone else");

        await supabase.from("task_events").insert({
          task_id,
          team_id: teamId,
          actor_id: userId,
          actor_kind: "agent",
          type: "claimed",
          message: "Claimed via MCP",
        });

        return textResult(task);
      }
    );

    server.registerTool(
      "report_progress",
      {
        title: "Report progress",
        description:
          "Report progress on a task you've claimed. Moves it to in_progress and may update the acceptance checklist. This is what makes the board move live for the definer.",
        inputSchema: {
          task_id: z.string().uuid(),
          message: z.string().min(1),
          checklist: z
            .array(z.object({ text: z.string(), done: z.boolean() }))
            .optional(),
        },
      },
      async ({ task_id, message, checklist }, extra) => {
        const { teamId, userId } = teamAuth(extra.authInfo);
        const supabase = createServiceClient();

        const { data: current } = await supabase
          .from("tasks")
          .select("team_id, status, assignee_id")
          .eq("id", task_id)
          .maybeSingle();
        if (!current || current.team_id !== teamId) throw new Error("Task not found");
        if (current.assignee_id !== userId)
          throw new Error("You have not claimed this task");

        const updates: TablesUpdate<"tasks"> = {};
        if (current.status === "claimed") updates.status = "in_progress";
        if (checklist) updates.acceptance = checklist;
        if (Object.keys(updates).length > 0) {
          await supabase.from("tasks").update(updates).eq("id", task_id);
        }

        await supabase.from("task_events").insert({
          task_id,
          team_id: teamId,
          actor_id: userId,
          actor_kind: "agent",
          type: "progress",
          message,
        });

        return textResult({ ok: true });
      }
    );

    server.registerTool(
      "submit_result",
      {
        title: "Submit result",
        description:
          "Submit a finished task for review: a PR link and a handover note. Moves the task to in_review.",
        inputSchema: {
          task_id: z.string().uuid(),
          pr_url: z.string().url(),
          handover_md: z.string().min(1),
        },
      },
      async ({ task_id, pr_url, handover_md }, extra) => {
        const { teamId, userId } = teamAuth(extra.authInfo);
        const supabase = createServiceClient();

        const { data: current } = await supabase
          .from("tasks")
          .select("team_id, assignee_id")
          .eq("id", task_id)
          .maybeSingle();
        if (!current || current.team_id !== teamId) throw new Error("Task not found");
        if (current.assignee_id !== userId)
          throw new Error("You have not claimed this task");

        const { error } = await supabase
          .from("tasks")
          .update({ status: "in_review", pr_url, handover_md })
          .eq("id", task_id);
        if (error) throw new Error(error.message);

        await supabase.from("task_events").insert({
          task_id,
          team_id: teamId,
          actor_id: userId,
          actor_kind: "agent",
          type: "submitted",
          message: pr_url,
        });

        return textResult({ ok: true });
      }
    );

    server.registerTool(
      "get_review_feedback",
      {
        title: "Get review feedback",
        description:
          "Get the task's current status and the most recent reviewer comments — use this after changes were requested.",
        inputSchema: { task_id: z.string().uuid() },
      },
      async ({ task_id }, extra) => {
        const { teamId } = teamAuth(extra.authInfo);
        const supabase = createServiceClient();

        const { data: task } = await supabase
          .from("tasks")
          .select("team_id, status")
          .eq("id", task_id)
          .maybeSingle();
        if (!task || task.team_id !== teamId) throw new Error("Task not found");

        const { data: events, error } = await supabase
          .from("task_events")
          .select("message, created_at, type")
          .eq("task_id", task_id)
          .in("type", ["changes_requested", "comment"])
          .order("created_at", { ascending: false })
          .limit(10);
        if (error) throw new Error(error.message);

        return textResult({ status: task.status, feedback: events });
      }
    );

    server.registerTool(
      "request_clarification",
      {
        title: "Request clarification",
        description:
          "Ask the task's definer (whoever created it, not you or your operator) one or more " +
          "structured questions — choices, free text, a 1-10 rating, a drag-to-rank list, or a " +
          "side-by-side comparison — instead of guessing. Shows an interactive form addressed to " +
          "the definer on the task's page. They may take a while to answer, so don't poll in a " +
          "tight loop — call get_clarification_answers again later, e.g. after the human tells " +
          "you they've answered.",
        inputSchema: {
          task_id: z.string().uuid(),
          questions: z.array(clarificationQuestionSchema).min(1),
        },
      },
      async ({ task_id, questions }, extra) => {
        const { teamId, userId } = teamAuth(extra.authInfo);
        const supabase = createServiceClient();

        const { data: current } = await supabase
          .from("tasks")
          .select("team_id")
          .eq("id", task_id)
          .maybeSingle();
        if (!current || current.team_id !== teamId) throw new Error("Task not found");

        const payload: ClarificationRequestPayload = { kind: "clarification_request", questions };
        const summary =
          questions.length === 1
            ? questions[0].prompt
            : `${questions[0].prompt} (+${questions.length - 1} more)`;

        const { data: event, error } = await supabase
          .from("task_events")
          .insert({
            task_id,
            team_id: teamId,
            actor_id: userId,
            actor_kind: "agent",
            type: "comment",
            message: `Requested clarification: ${summary}`,
            payload,
          })
          .select("id")
          .single();
        if (error || !event)
          throw new Error(error?.message ?? "Could not create clarification request");

        return textResult({ ok: true, request_event_id: event.id });
      }
    );

    server.registerTool(
      "get_clarification_answers",
      {
        title: "Get clarification answers",
        description:
          "Check whether the definer has answered a clarification request yet. Returns " +
          "{ answered: false } if they haven't gotten to it — that's normal, not an error.",
        inputSchema: {
          task_id: z.string().uuid(),
          request_event_id: z.string().uuid(),
        },
      },
      async ({ task_id, request_event_id }, extra) => {
        const { teamId } = teamAuth(extra.authInfo);
        const supabase = createServiceClient();

        const { data: task } = await supabase
          .from("tasks")
          .select("team_id")
          .eq("id", task_id)
          .maybeSingle();
        if (!task || task.team_id !== teamId) throw new Error("Task not found");

        const { data: events, error } = await supabase
          .from("task_events")
          .select("payload")
          .eq("task_id", task_id)
          .eq("type", "comment")
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) throw new Error(error.message);

        const match = (events ?? [])
          .map((e) => asClarificationAnswer(e.payload))
          .find((a) => a?.request_event_id === request_event_id);

        if (!match) return textResult({ answered: false });
        return textResult({ answered: true, answers: match.answers });
      }
    );
  },
  {},
  { basePath: "/api", maxDuration: 60 }
);

async function verifyToken(
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;

  const supabase = createServiceClient();
  const { data } = await supabase
    .from("access_tokens")
    .select("id, user_id, team_id")
    .eq("token_hash", hashToken(bearerToken))
    .maybeSingle();
  if (!data) return undefined;

  await supabase
    .from("access_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  const teamAuthExtra: TeamAuth = { userId: data.user_id, teamId: data.team_id, tokenId: data.id };
  return {
    token: bearerToken,
    clientId: data.user_id,
    scopes: ["team"],
    extra: teamAuthExtra,
  };
}

const authHandler = withMcpAuth(handler, verifyToken, { required: true });

export { authHandler as GET, authHandler as POST };
