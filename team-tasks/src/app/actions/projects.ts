"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentTeam } from "@/lib/team";
import type { SetupProfile } from "@/lib/database.types";

const PROFILES: SetupProfile[] = [
  "nextjs-supabase-vercel",
  "python-service",
  "minimal",
];

export async function createProject(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const repo_url = String(formData.get("repo_url") ?? "").trim() || null;
  const default_branch =
    String(formData.get("default_branch") ?? "").trim() || "main";
  const setup_profile = String(
    formData.get("setup_profile") ?? "nextjs-supabase-vercel"
  ) as SetupProfile;

  if (!name) return { error: "Project name is required" };
  if (!PROFILES.includes(setup_profile))
    return { error: "Invalid setup profile" };

  const { team } = await requireCurrentTeam();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { error } = await supabase.from("projects").insert({
    team_id: team.id,
    name,
    repo_url,
    default_branch,
    setup_profile,
    created_by: user.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/projects");
  return { ok: true };
}

export async function deleteProject(projectId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("projects").delete().eq("id", projectId);
  if (error) return { error: error.message };
  revalidatePath("/projects");
  return { ok: true };
}
