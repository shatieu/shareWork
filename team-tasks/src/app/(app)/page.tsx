import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentTeam } from "@/lib/team";
import { STATUS_META, BOARD_COLUMNS } from "@/lib/status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plug, Plus, ArrowRight } from "lucide-react";
import type { TaskStatus } from "@/lib/database.types";

export default async function DashboardPage() {
  const { team } = await requireCurrentTeam();
  const supabase = await createClient();

  const [{ data: tasks }, { count: projectCount }] = await Promise.all([
    supabase
      .from("tasks")
      .select("id, title, status, updated_at")
      .eq("team_id", team.id)
      .order("updated_at", { ascending: false }),
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("team_id", team.id),
  ]);

  const all = tasks ?? [];
  const counts = BOARD_COLUMNS.reduce<Record<string, number>>((acc, s) => {
    acc[s] = all.filter((t) => t.status === s).length;
    return acc;
  }, {});
  const openCount = counts["open"] ?? 0;
  const activeCount = (counts["claimed"] ?? 0) + (counts["in_progress"] ?? 0);
  const reviewCount = counts["in_review"] ?? 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{team.name}</h1>
          <p className="text-muted-foreground">
            {all.length} task{all.length === 1 ? "" : "s"} ·{" "}
            {projectCount ?? 0} project{projectCount === 1 ? "" : "s"}
          </p>
        </div>
        <Button asChild>
          <Link href="/tasks/new">
            <Plus /> New task
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Open" value={openCount} tone="text-slate-600" />
        <StatCard label="In flight" value={activeCount} tone="text-blue-600" />
        <StatCard label="Awaiting review" value={reviewCount} tone="text-violet-600" />
      </div>

      {/* Connect Claude CTA */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div className="flex items-start gap-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Plug className="size-5" />
            </div>
            <div>
              <p className="font-medium">Connect your Claude Code</p>
              <p className="text-sm text-muted-foreground">
                Generate a token and hand tasks to your agent over MCP.
              </p>
            </div>
          </div>
          <Button asChild variant="outline">
            <Link href="/settings">
              Set up <ArrowRight />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Board summary</CardTitle>
            <Link
              href="/board"
              className="text-sm text-primary hover:underline"
            >
              Open board
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {BOARD_COLUMNS.map((s) => (
              <div key={s} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span
                    className={`size-2 rounded-full ${STATUS_META[s as TaskStatus].dot}`}
                  />
                  {STATUS_META[s as TaskStatus].label}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {counts[s] ?? 0}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent tasks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {all.slice(0, 6).map((t) => (
              <Link
                key={t.id}
                href={`/tasks/${t.id}`}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm hover:bg-accent"
              >
                <span className="truncate">{t.title}</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_META[t.status as TaskStatus].badge}`}
                >
                  {STATUS_META[t.status as TaskStatus].label}
                </span>
              </Link>
            ))}
            {all.length === 0 && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                No tasks yet. Create your first one.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`mt-1 text-3xl font-semibold tabular-nums ${tone}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
