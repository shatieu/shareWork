import { createClient } from "@/lib/supabase/server";
import { requireCurrentTeam } from "@/lib/team";
import { getProfilesByIds, displayName } from "@/lib/profiles";
import { BoardClient, type BoardTask } from "./board-client";

export default async function BoardPage() {
  const { team } = await requireCurrentTeam();
  const supabase = await createClient();

  const [{ data: tasks }, { data: projects }] = await Promise.all([
    supabase
      .from("tasks")
      .select("*, projects(name)")
      .eq("team_id", team.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("projects")
      .select("id, name")
      .eq("team_id", team.id)
      .order("name", { ascending: true }),
  ]);

  const all = tasks ?? [];
  const profiles = await getProfilesByIds(all.map((t) => t.assignee_id));

  const boardTasks: BoardTask[] = all.map((t) => {
    const { projects: project, ...task } = t as typeof t & {
      projects: { name: string } | null;
    };
    return {
      ...task,
      projectName: project?.name ?? "Unknown project",
      assigneeName: task.assignee_id
        ? displayName(profiles.get(task.assignee_id), task.assignee_id)
        : null,
    };
  });

  return (
    <BoardClient teamId={team.id} tasks={boardTasks} projects={projects ?? []} />
  );
}
