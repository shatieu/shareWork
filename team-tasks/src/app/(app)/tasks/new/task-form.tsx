"use client";

import { useActionState } from "react";
import { createTask, type TaskFormState } from "@/app/actions/tasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus } from "lucide-react";

const initialState: TaskFormState = {};

export function TaskForm({
  projects,
}: {
  projects: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(createTask, initialState);

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required placeholder="Add health check endpoint" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="project_id">Project</Label>
          <Select id="project_id" name="project_id" required defaultValue="">
            <option value="" disabled>
              Select a project
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="priority">Priority</Label>
          <Select id="priority" name="priority" defaultValue="normal">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="spec_md">Spec (markdown)</Label>
        <Textarea
          id="spec_md"
          name="spec_md"
          rows={8}
          placeholder={"## Goal\n\nWhat should exist when this is done.\n\n## Notes\n\nRepo pointers, constraints, links."}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="acceptance">Acceptance criteria (one per line)</Label>
        <Textarea
          id="acceptance"
          name="acceptance"
          rows={4}
          placeholder={"GET /health returns 200\nResponse includes a version field"}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="branch">Branch (optional)</Label>
          <Input id="branch" name="branch" placeholder="task/0001-healthcheck" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="env_required">Env vars needed (comma or newline separated)</Label>
          <Input id="env_required" name="env_required" placeholder="DATABASE_URL, API_KEY" />
        </div>
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Plus />}
        Create task
      </Button>
    </form>
  );
}
