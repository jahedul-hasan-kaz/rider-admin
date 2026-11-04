import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env.public";
import { REQUEST_ID_HEADER } from "@/server/http/request-id";
import type { Database } from "@/types/database";

/**
 * Supabase client for the mobile REST API, acting as the caller identified by
 * the bearer token. No cookies, no session persistence. RLS always applies.
 */
export function createSupabaseBearerClient(accessToken: string, requestId: string) {
  return createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      // x-request-id is read by audit triggers to join DB changes to app logs.
      global: { headers: { Authorization: `Bearer ${accessToken}`, [REQUEST_ID_HEADER]: requestId } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );
}
