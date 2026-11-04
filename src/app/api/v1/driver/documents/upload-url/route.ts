import { z } from "zod";
import { uploadUrlSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { apiRoute, orNull, rpcOrThrow } from "@/server/http/handler";
import { createUploadUrl } from "@/server/services/driver-documents";

const reservation = z.object({ document_id: z.uuid(), storage_path: z.string() });

// POST /api/v1/driver/documents/upload-url — reserves a document and returns a
// signed upload URL for a path fixed by the server (docs/spec/05-api.md §2.4).
export const POST = apiRoute({ roles: ["driver"], rateLimit: "upload", idempotent: true }, async ({ auth, requestId, body }) => {
  const input = body(uploadUrlSchema);
  const reserved = reservation.parse(
    await rpcOrThrow(
      auth.supabase.schema("api").rpc("driver_create_document", {
        p_document_type: input.document_type,
        p_vehicle_id: orNull(input.vehicle_id),
        p_content_type: input.content_type,
        p_size_bytes: input.size,
      }),
    ),
  );
  const upload = await createUploadUrl(auth.supabase, reserved.storage_path);
  return ok(
    {
      document_id: reserved.document_id,
      upload_url: upload.uploadUrl,
      token: upload.token,
      path: upload.path,
      content_type: input.content_type,
      max_bytes: input.size,
    },
    requestId,
    { status: 201 },
  );
});
