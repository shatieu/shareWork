import { createClient as createSbClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * Service-role client — bypasses RLS. SERVER ONLY.
 * Used exclusively by the MCP server, which authenticates via personal access
 * token and scopes every query to the resolved team_id in code.
 * Never import this into a client component or expose the key.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createSbClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
