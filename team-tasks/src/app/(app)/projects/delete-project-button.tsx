"use client";

import { useTransition } from "react";
import { deleteProject } from "@/app/actions/projects";
import { Button } from "@/components/ui/button";
import { Loader2, Trash2 } from "lucide-react";

export function DeleteProjectButton({ projectId }: { projectId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={pending}
      onClick={() => {
        if (!confirm("Delete this project? This cannot be undone.")) return;
        startTransition(() => {
          deleteProject(projectId);
        });
      }}
    >
      {pending ? <Loader2 className="animate-spin" /> : <Trash2 className="text-destructive" />}
    </Button>
  );
}
