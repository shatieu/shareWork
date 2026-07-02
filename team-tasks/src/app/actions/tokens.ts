"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentTeam } from "@/lib/team";
import { generateToken } from "@/lib/tokens";

/**
 * Create a personal access token for the current team.
 * Returns the raw token exactly once — only its hash is stored.
 */
export async function createAccessToken(
  name: string
): Promise<{ token?: string; error?: string }> {
  const clean = name.trim() || "Claude Code";
  const { team } = await requireCurrentTeam();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { token, hash } = generateToken();
  const { error } = await supabase.from("access_tokens").insert({
    user_id: user.id,
    team_id: team.id,
    name: clean,
    token_hash: hash,
  });
  if (error) return { error: error.message };

  revalidatePath("/settings");
  return { token };
}

export async function revokeToken(tokenId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("access_tokens")
    .delete()
    .eq("id", tokenId);
  if (error) return { error: error.message };
  revalidatePath("/settings");
  return { ok: true };
}
