import type { TaskStatus, TaskPriority } from "@/lib/database.types";

export const STATUS_META: Record<
  TaskStatus,
  { label: string; dot: string; badge: string }
> = {
  open: {
    label: "Open",
    dot: "bg-slate-400",
    badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  },
  claimed: {
    label: "Claimed",
    dot: "bg-amber-400",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  in_progress: {
    label: "In progress",
    dot: "bg-blue-500",
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  },
  in_review: {
    label: "In review",
    dot: "bg-violet-500",
    badge:
      "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  },
  changes_requested: {
    label: "Changes requested",
    dot: "bg-orange-500",
    badge:
      "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  },
  done: {
    label: "Done",
    dot: "bg-emerald-500",
    badge:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  blocked: {
    label: "Blocked",
    dot: "bg-red-500",
    badge: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  },
};

/** Column order for the kanban board. */
export const BOARD_COLUMNS: TaskStatus[] = [
  "open",
  "claimed",
  "in_progress",
  "in_review",
  "changes_requested",
  "done",
];

export const ALL_STATUSES: TaskStatus[] = [
  ...BOARD_COLUMNS,
  "blocked",
];

export const PRIORITY_META: Record<
  TaskPriority,
  { label: string; className: string }
> = {
  low: { label: "Low", className: "text-muted-foreground" },
  normal: { label: "Normal", className: "text-foreground" },
  high: { label: "High", className: "text-red-600 dark:text-red-400 font-medium" },
};

export const EVENT_LABEL: Record<string, string> = {
  created: "created the task",
  claimed: "claimed the task",
  progress: "reported progress",
  submitted: "submitted for review",
  approved: "approved",
  changes_requested: "requested changes",
  blocked: "marked blocked",
  comment: "commented",
  reopened: "reopened",
};
