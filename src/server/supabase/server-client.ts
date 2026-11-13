import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { publicEnv } from "@/lib/env.public";
import { REQUEST_ID_HEADER } from "@/server/http/request-id";
import type { Database } from "@/types/database";

/**
 * Supabase client for Server Components and Server Actions, acting as the
 * signed-in admin (cookie session). RLS always applies.
 */
export async function createSupabaseServerClient() {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const requestId = headerStore.get(REQUEST_ID_HEADER);

  return createServerClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      // x-request-id is read by audit triggers to join DB changes to app logs.
      global: { headers: requestId ? { [REQUEST_ID_HEADER]: requestId } : {} },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The proxy refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );
}
