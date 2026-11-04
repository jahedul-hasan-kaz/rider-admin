import "server-only";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { z } from "zod";
import { log } from "@/server/log";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";

// Moves finished exports and archived partitions into private Storage buckets (docs/spec/08 §4).
// Database holds the working copy only until the file is safely stored.

const exportsSchema = z.array(z.object({ id: z.uuid(), requested_by: z.uuid(), kind: z.string(), content: z.string() }));
const archiveSchema = z.array(z.object({ id: z.number(), source: z.string(), partition: z.string(), row_count: z.number() }));
const chunkSchema = z.object({ rows: z.array(z.unknown()), next_after: z.number().nullable() });

/** Uploads ready exports to the `exports` bucket and clears the CSV from the table. */
export async function runExportUpload(limit = 5): Promise<{ uploaded: number }> {
  const admin = createSupabaseAdminClient("job.run");
  const { data, error } = await admin.schema("api").rpc("claim_exports_for_storage", { p_limit: limit });
  if (error) throw new Error("claim exports failed");
  let uploaded = 0;
  for (const job of exportsSchema.parse(data)) {
    const path = `${job.requested_by}/${job.id}.csv`;
    const up = await admin.storage.from("exports").upload(path, new Blob([job.content], { type: "text/csv" }), { contentType: "text/csv", upsert: true });
    if (up.error) {
      log.warn({ id: job.id, err: up.error.message }, "export upload failed");
      continue;
    }
    await admin.schema("api").rpc("finish_export_storage", { p_id: job.id, p_path: path });
    uploaded += 1;
  }
  return { uploaded };
}

const PAGE = 2000;

/** Exports archived partitions as gzip NDJSON, checks the row count against the archive log, and records the checksum. */
export async function runArchiveExport(limit = 2): Promise<{ archived: number }> {
  const admin = createSupabaseAdminClient("job.run");
  const { data, error } = await admin.schema("api").rpc("claim_archive_exports", { p_limit: limit });
  if (error) throw new Error("claim archive failed");
  let archived = 0;
  for (const run of archiveSchema.parse(data)) {
    const lines: string[] = [];
    // Keyset paging by physical row position (no OFFSET): each chunk returns where the next one starts.
    let after: number | null = null;
    do {
      const chunk = await admin.schema("api").rpc("read_archive_chunk", { p_run_id: run.id, p_after: after ?? undefined, p_limit: PAGE });
      if (chunk.error) throw new Error("read archive chunk failed");
      const page = chunkSchema.parse(chunk.data);
      for (const row of page.rows) lines.push(JSON.stringify(row));
      after = page.next_after;
    } while (after !== null);
    const body = gzipSync(Buffer.from(lines.join("\n")));
    const sha256 = createHash("sha256").update(body).digest("hex");
    const path = `${run.source.replace(/[^a-z0-9_.]/gi, "_")}/${run.partition}.ndjson.gz`;
    const up = await admin.storage.from("archive").upload(path, body, { contentType: "application/gzip", upsert: true });
    if (up.error) {
      log.warn({ run: run.id, err: up.error.message }, "archive upload failed");
      continue;
    }
    // The database refuses the record if the row count differs from what was archived.
    const done = await admin.schema("api").rpc("finish_archive_export", { p_run_id: run.id, p_path: path, p_sha256: sha256, p_bytes: body.length, p_rows: lines.length });
    if (done.error) log.error({ run: run.id, err: done.error.message }, "archive export did not verify");
    else archived += 1;
  }
  return { archived };
}

/** Reads a stored export back (the bucket has no client access). Call only after the caller's permissions are checked. */
export async function readStoredExport(path: string): Promise<string | null> {
  const stored = await createSupabaseAdminClient("storage.verify").storage.from("exports").download(path);
  if (stored.error || !stored.data) return null;
  return stored.data.text();
}
