import { createClient } from "@/lib/supabase/server";
import { requireCurrentTeam, requireUser } from "@/lib/team";
import { getProfilesByIds, displayName } from "@/lib/profiles";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TokenSection } from "./token-section";

export default async function SettingsPage() {
  const user = await requireUser();
  const { team } = await requireCurrentTeam();
  const supabase = await createClient();

  const [{ data: members }, { data: tokens }] = await Promise.all([
    supabase
      .from("team_members")
      .select("user_id, role, created_at")
      .eq("team_id", team.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("access_tokens")
      .select("*")
      .eq("team_id", team.id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
  ]);

  const allMembers = members ?? [];
  const profiles = await getProfilesByIds(allMembers.map((m) => m.user_id));
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">{team.name}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invite teammates</CardTitle>
          <CardDescription>
            Share this join code — anyone who enters it on the onboarding screen joins {team.name}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <code className="rounded-md border bg-muted px-3 py-2 text-sm">
            {team.join_code}
          </code>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {allMembers.map((m) => (
            <div
              key={m.user_id}
              className="flex items-center justify-between text-sm"
            >
              <span>{displayName(profiles.get(m.user_id), m.user_id)}</span>
              <Badge variant="muted" className="capitalize">
                {m.role}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Connect Claude Code</CardTitle>
          <CardDescription>
            Generate a personal token, then run the command it gives you to connect your
            Claude Code to this team over MCP.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TokenSection tokens={tokens ?? []} appUrl={appUrl} />
        </CardContent>
      </Card>
    </div>
  );
}
