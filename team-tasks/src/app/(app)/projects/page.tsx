import { createClient } from "@/lib/supabase/server";
import { requireCurrentTeam } from "@/lib/team";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FolderGit2 } from "lucide-react";
import { ProjectForm } from "./project-form";
import { DeleteProjectButton } from "./delete-project-button";

export default async function ProjectsPage() {
  const { team } = await requireCurrentTeam();
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, repo_url, setup_profile, default_branch")
    .eq("team_id", team.id)
    .order("name", { ascending: true });

  const all = projects ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-muted-foreground">
            Repos your team&apos;s tasks point at.
          </p>
        </div>

        {all.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
              <FolderGit2 className="size-8" />
              <p>No projects yet. Add the first repo your team works in.</p>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {all.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div className="min-w-0">
                  <p className="truncate font-medium">{p.name}</p>
                  {p.repo_url && (
                    <a
                      href={p.repo_url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-sm text-primary hover:underline"
                    >
                      {p.repo_url}
                    </a>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant="muted">{p.setup_profile}</Badge>
                    <Badge variant="outline">{p.default_branch}</Badge>
                  </div>
                </div>
                <DeleteProjectButton projectId={p.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Add a project</CardTitle>
        </CardHeader>
        <CardContent>
          <ProjectForm />
        </CardContent>
      </Card>
    </div>
  );
}
