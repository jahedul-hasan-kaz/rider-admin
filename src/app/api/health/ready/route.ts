import { NextResponse } from "next/server";
import { publicEnv } from "@/lib/env.public";

const TIMEOUT_MS = 1000;

async function check(path: string): Promise<boolean> {
  try {
    const res = await fetch(`${publicEnv.NEXT_PUBLIC_SUPABASE_URL}${path}`, {
      headers: { apikey: publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    // Any non-5xx answer means the service is up (REST's root may require a secret key).
    return res.status < 500;
  } catch {
    return false;
  }
}

// Readiness: Supabase Auth and the REST API answer within 1 s.
export async function GET() {
  const [auth, rest] = await Promise.all([check("/auth/v1/health"), check("/rest/v1/")]);
  const ready = auth && rest;
  return NextResponse.json(
    { status: ready ? "ready" : "degraded", checks: { auth, rest } },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
