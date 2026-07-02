"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentTeam } from "@/lib/team";
import type { AcceptanceItem, TaskPriority } from "@/lib/database.types";

function parseAcceptance(raw: string): AcceptanceItem[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((text) => ({ text, done: false }));
}

function parseList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createTask(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const project_id = String(formData.get("project_id") ?? "");
  const spec_md = String(formData.get("spec_md") ?? "");
  const priority = String(formData.get("priority") ?? "normal") as TaskPriority;
  const branch = String(formData.get("branch") ?? "").trim() || null;
  const acceptance = parseAcceptance(String(formData.get("acceptance") ?? ""));
  const env_required = parseList(String(formData.get("env_required") ?? ""));

  if (!title) return { error: "Title is required" };
  if (!project_id) return { error: "Pick a project" };

  const { team } = await requireCurrentTeam();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      team_id: team.id,
      project_id,
      title,
      spec_md,
      acceptance,
      priority,
      branch,
      env_required,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Could not create task" };

  await supabase.from("task_events").insert({
    task_id: data.id,
    team_id: team.id,
    actor_id: user.id,
    actor_kind: "human",
    type: "created",
    message: title,
  });

  redirect(`/tasks/${data.id}`);
}

export async function updateTaskSpec(taskId: string, formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const spec_md = String(formData.get("spec_md") ?? "");
  const priority = String(formData.get("priority") ?? "normal") as TaskPriority;
  const acceptance = parseAcceptance(String(formData.get("acceptance") ?? ""));
  const env_required = parseList(String(formData.get("env_required") ?? ""));

  const supabase = await createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ title, spec_md, priority, acceptance, env_required })
    .eq("id", taskId);
  if (error) return { error: error.message };

  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

/** Flip a single acceptance checklist item (human edit from the UI). */
export async function toggleAcceptance(taskId: string, index: number) {
  const supabase = await createClient();
  const { data: task } = await supabase
    .from("tasks")
    .select("acceptance")
    .eq("id", taskId)
    .single();
  if (!task) return { error: "Task not found" };

  const items = (task.acceptance as AcceptanceItem[]) ?? [];
  if (!items[index]) return { error: "No such item" };
  items[index] = { ...items[index], done: !items[index].done };

  const { error } = await supabase
    .from("tasks")
    .update({ acceptance: items })
    .eq("id", taskId);
  if (error) return { error: error.message };
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

async function writeReview(
  taskId: string,
  type: "approved" | "changes_requested" | "reopened" | "comment",
  status: string | null,
  message: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: task } = await supabase
    .from("tasks")
    .select("team_id")
    .eq("id", taskId)
    .single();
  if (!task) return { error: "Task not found" };

  if (status) {
    const { error } = await supabase
      .from("tasks")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ status: status as any })
      .eq("id", taskId);
    if (error) return { error: error.message };
  }

  await supabase.from("task_events").insert({
    task_id: taskId,
    team_id: task.team_id,
    actor_id: user.id,
    actor_kind: "human",
    type,
    message,
  });

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/board");
  return { ok: true };
}

export async function approveTask(taskId: string) {
  return writeReview(taskId, "approved", "done", "Approved — task marked done.");
}

export async function requestChanges(taskId: string, comment: string) {
  return writeReview(
    taskId,
    "changes_requested",
    "changes_requested",
    comment || "Changes requested."
  );
}

export async function reopenTask(taskId: string) {
  return writeReview(taskId, "reopened", "open", "Reopened for pickup.");
}

export async function addComment(taskId: string, comment: string) {
  if (!comment.trim()) return { error: "Empty comment" };
  return writeReview(taskId, "comment", null, comment.trim());
}
