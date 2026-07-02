import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/database.types";

/**
 * Look up display info for a set of user ids. `team_members`/`tasks.assignee_id`
 * reference `auth.users` directly (not `profiles`), so PostgREST can't embed
 * `profiles` on those tables — fetch them separately and merge in JS instead.
 */
export async function getProfilesByIds(
  ids: (string | null | undefined)[]
): Promise<Map<string, Profile>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  if (unique.length === 0) return new Map();

  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("*").in("id", unique);
  return new Map((data ?? []).map((p) => [p.id, p]));
}

export function displayName(profile: Profile | undefined, fallbackId: string): string {
  return profile?.display_name || `Member ${fallbackId.slice(0, 8)}`;
}
