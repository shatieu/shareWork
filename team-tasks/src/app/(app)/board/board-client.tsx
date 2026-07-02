"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { STATUS_META, PRIORITY_META, BOARD_COLUMNS } from "@/lib/status";
import { timeAgo } from "@/lib/utils";
import type { Task, TaskStatus } from "@/lib/database.types";

export type BoardTask = Task & {
  projectName: string;
  assigneeName: string | null;
};

export function BoardClient({
  teamId,
  tasks,
  projects,
}: {
  teamId: string;
  tasks: BoardTask[];
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [projectFilter, setProjectFilter] = useState("all");

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`board-${teamId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `team_id=eq.${teamId}` },
        () => router.refresh()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [teamId, router]);

  const filtered = useMemo(
    () =>
      projectFilter === "all"
        ? tasks
        : tasks.filter((t) => t.project_id === projectFilter),
    [tasks, projectFilter]
  );

  const byStatus = useMemo(() => {
    const map = new Map<TaskStatus, BoardTask[]>();
    for (const status of BOARD_COLUMNS) map.set(status, []);
    for (const task of filtered) {
      map.get(task.status)?.push(task);
    }
    return map;
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Board</h1>
        <Select
          className="w-56"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
        >
          <option value="all">All projects</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2">
        {BOARD_COLUMNS.map((status) => {
          const columnTasks = byStatus.get(status) ?? [];
          return (
            <div key={status} className="w-72 shrink-0 space-y-3">
              <div className="flex items-center gap-2 px-1">
                <span className={`size-2 rounded-full ${STATUS_META[status].dot}`} />
                <span className="text-sm font-medium">{STATUS_META[status].label}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {columnTasks.length}
                </span>
              </div>
              <div className="space-y-2">
                {columnTasks.map((task) => (
                  <Link key={task.id} href={`/tasks/${task.id}`}>
                    <Card className="transition-colors hover:border-primary/40">
                      <CardContent className="space-y-2 p-4">
                        <p className="line-clamp-2 text-sm font-medium">{task.title}</p>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="truncate">{task.projectName}</span>
                          <span className={PRIORITY_META[task.priority].className}>
                            {PRIORITY_META[task.priority].label}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="truncate">
                            {task.assigneeName ?? "Unassigned"}
                          </span>
                          <span>{timeAgo(task.updated_at)}</span>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
                {columnTasks.length === 0 && (
                  <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
                    Nothing here
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
