import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Team, TeamRole } from "@/lib/database.types";

export const TEAM_COOKIE = "tt_team";

export type MyTeam = Team & { role: TeamRole };

/** The signed-in user, or redirect to /login. */
export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return user;
}

/** All teams the current user belongs to, with their role. */
export async function getMyTeams(): Promise<MyTeam[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("team_members")
    .select("role, teams(*)")
    .order("created_at", { ascending: true });

  return (data ?? [])
    .filter((r) => r.teams)
    .map((r) => ({ ...(r.teams as Team), role: r.role as TeamRole }));
}

/**
 * The current team from the cookie (validated against membership),
 * falling back to the first team. Redirects to /onboarding if none.
 */
export async function requireCurrentTeam(): Promise<{
  team: MyTeam;
  teams: MyTeam[];
}> {
  const teams = await getMyTeams();
  if (teams.length === 0) redirect("/onboarding");

  const cookieStore = await cookies();
  const selected = cookieStore.get(TEAM_COOKIE)?.value;
  const team = teams.find((t) => t.id === selected) ?? teams[0];
  return { team, teams };
}
