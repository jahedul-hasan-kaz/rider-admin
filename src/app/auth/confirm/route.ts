import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/server/proxy/routes";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

const TYPES = new Set<EmailOtpType>(["invite", "recovery", "email", "email_change"]);

/**
 * Landing page for links in Supabase emails (invite, password recovery).
 * The email templates send token_hash here (supabase/templates/*.html), so the
 * session is created server-side with cookies.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const fallback = type === "invite" ? "/reset-password?mode=invite" : "/reset-password";
  const next = safeNextPath(url.searchParams.get("next"), fallback);

  if (tokenHash && type && TYPES.has(type)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      const target = new URL(next, url.origin);
      if (type === "invite") target.searchParams.set("mode", "invite");
      return NextResponse.redirect(target);
    }
  }

  return NextResponse.redirect(new URL("/login?error=link_expired", url.origin));
}
