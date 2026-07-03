"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/markdown";
import { ClarificationForm } from "@/components/clarification-form";
import { STATUS_META, PRIORITY_META, EVENT_LABEL } from "@/lib/status";
import { timeAgo } from "@/lib/utils";
import {
  toggleAcceptance,
  approveTask,
  requestChanges,
  reopenTask,
  addComment,
} from "@/app/actions/tasks";
import {
  asClarificationRequest,
  asClarificationAnswer,
  type ClarificationRequestPayload,
} from "@/lib/clarification";
import type { AcceptanceItem, Task } from "@/lib/database.types";
import {
  Check,
  Loader2,
  RotateCcw,
  ExternalLink,
  MessageSquare,
} from "lucide-react";

export type TaskEventView = {
  id: string;
  type: string;
  message: string | null;
  payload: unknown;
  created_at: string;
  actorName: string | null;
};

/** Clarification requests (from the MCP `request_clarification` tool) that have no matching answer yet. */
function getPendingClarifications(
  events: TaskEventView[]
): { event: TaskEventView; request: ClarificationRequestPayload }[] {
  const answeredRequestIds = new Set(
    events
      .map((e) => asClarificationAnswer(e.payload))
      .filter((a) => a !== null)
      .map((a) => a.request_event_id)
  );
  const pending: { event: TaskEventView; request: ClarificationRequestPayload }[] = [];
  for (const event of events) {
    const request = asClarificationRequest(event.payload);
    if (request && !answeredRequestIds.has(event.id)) pending.push({ event, request });
  }
  return pending;
}

export function TaskDetailClient({
  task,
  projectName,
  assigneeName,
  definerName,
  events,
}: {
  task: Task;
  projectName: string;
  assigneeName: string | null;
  definerName: string | null;
  events: TaskEventView[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [comment, setComment] = useState("");
  const [changesComment, setChangesComment] = useState("");
  const acceptance = (task.acceptance as AcceptanceItem[]) ?? [];
  const pendingClarifications = getPendingClarifications(events);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`task-${task.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `id=eq.${task.id}` },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_events", filter: `task_id=eq.${task.id}` },
        () => router.refresh()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [task.id, router]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={STATUS_META[task.status].badge}>
              {STATUS_META[task.status].label}
            </Badge>
            <span className={`text-sm ${PRIORITY_META[task.priority].className}`}>
              {PRIORITY_META[task.priority].label} priority
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{task.title}</h1>
          <p className="text-sm text-muted-foreground">
            {projectName} · {assigneeName ?? "Unassigned"}
          </p>
        </div>

        {pendingClarifications.map(({ event, request }) => (
          <ClarificationForm
            key={event.id}
            taskId={task.id}
            requestId={event.id}
            questions={request.questions}
            definerName={definerName}
            askedBy={event.actorName}
          />
        ))}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Spec</CardTitle>
          </CardHeader>
          <CardContent>
            {task.spec_md ? (
              <Markdown>{task.spec_md}</Markdown>
            ) : (
              <p className="text-sm text-muted-foreground">No spec written.</p>
            )}
          </CardContent>
        </Card>

        {acceptance.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Acceptance criteria</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {acceptance.map((item, i) => (
                <label
                  key={i}
                  className="flex cursor-pointer items-start gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={item.done}
                    disabled={pending}
                    onChange={() =>
                      startTransition(() => {
                        toggleAcceptance(task.id, i);
                      })
                    }
                    className="mt-0.5 size-4 rounded border-input"
                  />
                  <span className={item.done ? "text-muted-foreground line-through" : ""}>
                    {item.text}
                  </span>
                </label>
              ))}
            </CardContent>
          </Card>
        )}

        {(task.pr_url || task.handover_md) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Handover</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {task.pr_url && (
                <a
                  href={task.pr_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  {task.pr_url} <ExternalLink className="size-3.5" />
                </a>
              )}
              {task.handover_md && <Markdown>{task.handover_md}</Markdown>}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {events.length === 0 && (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            )}
            {events.map((e) => (
              <div key={e.id} className="flex gap-3 text-sm">
                <div className="mt-1 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-medium">{e.actorName ?? "Someone"}</span>{" "}
                    <span className="text-muted-foreground">
                      {EVENT_LABEL[e.type] ?? e.type}
                    </span>
                  </p>
                  {e.message && <p className="text-muted-foreground">{e.message}</p>}
                  <p className="text-xs text-muted-foreground">{timeAgo(e.created_at)}</p>
                </div>
              </div>
            ))}

            <div className="space-y-2 border-t pt-4">
              <Textarea
                rows={2}
                placeholder="Add a comment…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || !comment.trim()}
                onClick={() =>
                  startTransition(async () => {
                    await addComment(task.id, comment);
                    setComment("");
                  })
                }
              >
                {pending ? <Loader2 className="animate-spin" /> : <MessageSquare />}
                Comment
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Review</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {task.status === "in_review" && (
              <>
                <Button
                  className="w-full"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await approveTask(task.id);
                    })
                  }
                >
                  <Check /> Approve
                </Button>
                <Textarea
                  rows={2}
                  placeholder="What needs to change?"
                  value={changesComment}
                  onChange={(e) => setChangesComment(e.target.value)}
                />
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await requestChanges(task.id, changesComment);
                      setChangesComment("");
                    })
                  }
                >
                  Request changes
                </Button>
              </>
            )}
            {["done", "blocked", "changes_requested"].includes(task.status) && (
              <Button
                variant="outline"
                className="w-full"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await reopenTask(task.id);
                  })
                }
              >
                <RotateCcw /> Reopen
              </Button>
            )}
            {task.status === "open" && (
              <p className="text-sm text-muted-foreground">
                Waiting for a teammate&apos;s Claude to claim this.
              </p>
            )}
            {["claimed", "in_progress"].includes(task.status) && (
              <p className="text-sm text-muted-foreground">
                In progress — review actions unlock once it&apos;s submitted.
              </p>
            )}
          </CardContent>
        </Card>

        {task.branch && (
          <Card>
            <CardContent className="p-4 text-sm">
              <p className="text-muted-foreground">Branch</p>
              <p className="font-mono">{task.branch}</p>
            </CardContent>
          </Card>
        )}

        {task.env_required.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Env required</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {task.env_required.map((name) => (
                <Badge key={name} variant="muted" className="font-mono">
                  {name}
                </Badge>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
