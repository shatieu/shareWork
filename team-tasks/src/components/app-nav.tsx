"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { switchTeam } from "@/app/actions/teams";
import type { MyTeam } from "@/lib/team";
import {
  LayoutDashboard,
  KanbanSquare,
  FolderGit2,
  Plus,
  Settings,
  LogOut,
  Check,
  ChevronsUpDown,
  CheckSquare,
} from "lucide-react";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/board", label: "Board", icon: KanbanSquare },
  { href: "/projects", label: "Projects", icon: FolderGit2 },
  { href: "/tasks/new", label: "New task", icon: Plus },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppNav({
  teams,
  currentTeam,
  userLabel,
}: {
  teams: MyTeam[];
  currentTeam: MyTeam;
  userLabel: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <aside className="flex h-full w-full flex-col gap-4 border-r bg-card/50 p-4 md:w-64">
      <div className="flex items-center gap-2 px-2 pt-1">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <CheckSquare className="size-5" />
        </div>
        <span className="text-lg font-semibold tracking-tight">Team Tasks</span>
      </div>

      {/* Team switcher */}
      <div className="relative px-1">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-lg border bg-background px-3 py-2 text-sm hover:bg-accent"
        >
          <span className="flex min-w-0 flex-col items-start">
            <span className="truncate font-medium">{currentTeam.name}</span>
            <span className="text-xs capitalize text-muted-foreground">
              {currentTeam.role}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
        {open && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-md">
            {teams.map((t) => (
              <button
                key={t.id}
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  if (t.id !== currentTeam.id)
                    startTransition(() => switchTeam(t.id));
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent"
              >
                <span className="truncate">{t.name}</span>
                {t.id === currentTeam.id && <Check className="size-4" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {NAV.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t pt-3">
        <div className="mb-2 truncate px-3 text-xs text-muted-foreground">
          {userLabel}
        </div>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
