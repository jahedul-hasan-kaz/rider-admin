import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { serverEnv } from "@/server/env";
import { log } from "@/server/log";
import { runNotifyJob } from "@/server/services/notify";
import { runArchiveExport, runExportUpload } from "@/server/services/storage-exports";
import { runStoragePurge } from "@/server/services/storage-purge";

// POST /api/internal/jobs/notify — delivers queued email, SMS and push messages (spec 04 §14). Triggered by the host's
// cron every minute. Protected by a bearer secret (compared in constant time) and an optional IP allow-list, and
// idempotent: messages are claimed with row locks, so overlapping runs never send the same message twice.
export async function POST(request: Request) {
  const env = serverEnv();
  if (!env.INTERNAL_JOBS_SECRET) return NextResponse.json({ error: "jobs are not configured" }, { status: 503 });

  const given = Buffer.from((request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(env.INTERNAL_JOBS_SECRET);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    log.warn("internal job call rejected: bad secret");
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const allowed = env.INTERNAL_JOBS_ALLOWED_IPS?.split(",").map((x) => x.trim()).filter(Boolean) ?? [];
  if (allowed.length > 0) {
    const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim();
    if (!ip || !allowed.includes(ip)) {
      log.warn({ ip }, "internal job call rejected: ip not allowed");
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }
  const result = await runNotifyJob(50, { ...process.env });
  const purge = await runStoragePurge(50).catch((err) => {
    log.error({ err }, "storage purge failed");
    return { purged: 0 };
  });
  const exported = await runExportUpload(5).catch((err) => {
    log.error({ err }, "export upload failed");
    return { uploaded: 0 };
  });
  const archived = await runArchiveExport(2).catch((err) => {
    log.error({ err }, "archive export failed");
    return { archived: 0 };
  });
  return NextResponse.json({ ...result, ...purge, ...exported, ...archived }, { headers: { "Cache-Control": "no-store" } });
}
