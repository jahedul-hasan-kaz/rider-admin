import { z } from "zod";
import { getAdminContext } from "@/server/auth/context";
import { fromPostgrestError } from "@/server/http/errors";
import { readStoredExport } from "@/server/services/storage-exports";

// GET /api/exports/{id} — downloads a finished export as CSV. Only the admin who requested it (with analytics.export
// and the permission for the data) can download; each download is written to the audit log by the database function.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return new Response("Not found", { status: 404 });

  const ctx = await getAdminContext(); // redirects to sign-in or 2FA when needed
  if (!ctx.permissions.has("analytics.export")) return new Response("Forbidden", { status: 403 });

  const { data, error } = await ctx.supabase.schema("api").rpc("get_export_content", { p_id: parsed.data });
  if (error) {
    const err = fromPostgrestError(error);
    const status = err.code === "NOT_FOUND" ? 404 : err.code === "FORBIDDEN" ? 403 : err.code === "INVALID_STATE_TRANSITION" ? 410 : 500;
    return new Response(status === 410 ? "This export has expired." : "Unavailable", { status });
  }
  const file = z.object({ filename: z.string().regex(/^[a-z0-9_.-]+$/i), content: z.string().nullable(), storage_path: z.string().nullable() }).parse(data);

  // Once the job has moved the file to Storage the table no longer holds it: read it back with the server's own key
  // (the bucket has no client access) after the permission checks above and the audit entry written by the database.
  let csv = file.content;
  if (csv === null && file.storage_path) {
    csv = await readStoredExport(file.storage_path);
    if (csv === null) return new Response("Unavailable", { status: 503 });
  }
  if (csv === null) return new Response("This export has expired.", { status: 410 });

  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
