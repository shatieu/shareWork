"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TEAM_COOKIE } from "@/lib/team";

export async function createTeam(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Team name is required" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_team", { _name: name });
  if (error) return { error: error.message };

  const cookieStore = await cookies();
  cookieStore.set(TEAM_COOKIE, data.id, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/");
}

export async function joinTeam(formData: FormData) {
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "Join code is required" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("join_team", { _code: code });
  if (error) return { error: "Invalid join code" };

  const cookieStore = await cookies();
  cookieStore.set(TEAM_COOKIE, data.id, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/");
}

export async function switchTeam(teamId: string) {
  const cookieStore = await cookies();
  cookieStore.set(TEAM_COOKIE, teamId, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
