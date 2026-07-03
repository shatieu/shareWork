import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentTeam } from "@/lib/team";
import { getProfilesByIds, displayName } from "@/lib/profiles";
import { TaskDetailClient, type TaskEventView } from "./task-detail-client";

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { team } = await requireCurrentTeam();
  const supabase = await createClient();

  const [{ data: task }, { data: events }] = await Promise.all([
    supabase
      .from("tasks")
      .select("*, projects(name)")
      .eq("id", id)
      .eq("team_id", team.id)
      .single(),
    supabase
      .from("task_events")
      .select("*")
      .eq("task_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (!task) notFound();

  const { projects: project, ...taskRow } = task as typeof task & {
    projects: { name: string } | null;
  };
  const allEvents = events ?? [];

  const profiles = await getProfilesByIds([
    taskRow.assignee_id,
    taskRow.created_by,
    ...allEvents.map((e) => e.actor_id),
  ]);

  const eventViews: TaskEventView[] = allEvents.map((e) => ({
    id: e.id,
    type: e.type,
    message: e.message,
    payload: e.payload,
    created_at: e.created_at,
    actorName: e.actor_id ? displayName(profiles.get(e.actor_id), e.actor_id) : null,
  }));

  return (
    <TaskDetailClient
      task={taskRow}
      projectName={project?.name ?? "Unknown project"}
      assigneeName={
        taskRow.assignee_id
          ? displayName(profiles.get(taskRow.assignee_id), taskRow.assignee_id)
          : null
      }
      definerName={
        taskRow.created_by
          ? displayName(profiles.get(taskRow.created_by), taskRow.created_by)
          : null
      }
      events={eventViews}
    />
  );
}
