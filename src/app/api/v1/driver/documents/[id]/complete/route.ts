import { z } from "zod";
import { completeDocumentSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { AppError } from "@/server/http/errors";
import { apiRoute, orNull, rpcOrThrow } from "@/server/http/handler";
import { verifyUploadedDocument } from "@/server/services/driver-documents";

const docRow = z.object({ storage_path: z.string(), content_type: z.string(), size_bytes: z.number().nullable() });

// POST /api/v1/driver/documents/{id}/complete — the server reads the uploaded
// file, checks its real type and computes the checksum, then queues it for review.
export const POST = apiRoute({ roles: ["driver"], rateLimit: "upload", idempotent: true }, async ({ auth, requestId, params, body }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND");
  const input = body(completeDocumentSchema);

  // RLS: a driver can only read their own document rows.
  const { data: row, error } = await auth.supabase
    .from("driver_documents")
    .select("storage_path, content_type, size_bytes")
    .eq("id", id.data)
    .maybeSingle();
  if (error || !row) throw new AppError("NOT_FOUND");
  const doc = docRow.parse(row);

  const verified = await verifyUploadedDocument(doc.storage_path, doc.content_type, doc.size_bytes ?? 10 * 1024 * 1024);
  const data = await rpcOrThrow(
    auth.supabase.schema("api").rpc("driver_complete_document", {
      p_document_id: id.data,
      p_sha256: verified.sha256,
      p_size_bytes: verified.size,
      p_document_number: orNull(input.document_number),
      p_issued_at: orNull(input.issued_at),
      p_expires_at: orNull(input.expires_at),
    }),
  );
  return ok(data, requestId);
});
