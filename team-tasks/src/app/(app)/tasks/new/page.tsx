import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentTeam } from "@/lib/team";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TaskForm } from "./task-form";

export default async function NewTaskPage() {
  const { team } = await requireCurrentTeam();
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("team_id", team.id)
    .order("name", { ascending: true });

  const all = projects ?? [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New task</h1>
        <p className="text-muted-foreground">
          Write the spec a teammate&apos;s Claude will work from.
        </p>
      </div>

      {all.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 p-6 text-center">
            <p className="text-muted-foreground">
              Add a project before creating a task.
            </p>
            <Button asChild>
              <Link href="/projects">Add a project</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6">
            <TaskForm projects={all} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
