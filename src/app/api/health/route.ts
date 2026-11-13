import { NextResponse } from "next/server";

// Liveness: no dependencies (docs/spec/05-api.md §2.7).
export function GET() {
  return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
