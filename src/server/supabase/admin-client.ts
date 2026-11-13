import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env.public";
import { serverEnv } from "@/server/env";
import { log } from "@/server/log";
import type { Database } from "@/types/database";

/**
 * Allowed reasons for using the secret (service-role) key. Bypasses RLS, so
 * every new purpose needs a security review (docs/spec/07-security.md §3).
 */
export type AdminClientPurpose =
  | "admin.invite"
  | "admin.revoke_sessions"
  | "storage.verify"
  | "webhook.process"
  | "job.run"
  | "seed.demo"
  | "admin.create_user"
  // Public trip share page: calls only api.get_shared_trip with an unguessable token (no other reads).
  | "share.read";

/** Secret-key client. Never import from client components (enforced by ESLint). */
export function createSupabaseAdminClient(purpose: AdminClientPurpose) {
  log.info({ purpose }, "supabase admin client used");

  return createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, serverEnv().SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
