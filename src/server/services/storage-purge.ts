import "server-only";
import { z } from "zod";
import { log } from "@/server/log";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";

const claimSchema = z.array(z.object({ id: z.number(), bucket: z.string(), path: z.string() }));

/** Removes the files of anonymised accounts from Storage, then marks them done. Safe to run repeatedly. */
export async function runStoragePurge(limit = 50): Promise<{ purged: number }> {
  const admin = createSupabaseAdminClient("job.run");
  const { data, error } = await admin.schema("api").rpc("claim_storage_purges", { p_limit: limit });
  if (error) {
    log.error({ err: error }, "claiming storage purges failed");
    throw new Error("claim failed");
  }
  const items = claimSchema.parse(data);
  const done: number[] = [];
  const byBucket = new Map<string, { id: number; path: string }[]>();
  for (const i of items) byBucket.set(i.bucket, [...(byBucket.get(i.bucket) ?? []), { id: i.id, path: i.path }]);
  for (const [bucket, rows] of byBucket) {
    const { error: rmError } = await admin.storage.from(bucket).remove(rows.map((r) => r.path));
    if (rmError) log.warn({ err: rmError.message, bucket }, "storage purge failed");
    else done.push(...rows.map((r) => r.id));
  }
  if (done.length > 0) await admin.schema("api").rpc("finish_storage_purge", { p_ids: done });
  return { purged: done.length };
}
