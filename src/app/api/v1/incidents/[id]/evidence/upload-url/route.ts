import { z } from "zod";
import { evidenceUploadSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { AppError } from "@/server/http/errors";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";
import { createEvidenceUploadUrl } from "@/server/services/safety-evidence";

// POST /api/v1/incidents/{id}/evidence/upload-url — the person who raised the SOS adds a photo, PDF, audio or video.
// The server fixes the object path; the client uploads straight to storage with the signed URL, then calls /complete.
export const POST = apiRoute({ roles: ["passenger", "driver"], rateLimit: "upload", idempotent: true }, async ({ auth, requestId, params, body }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND");
  const input = body(evidenceUploadSchema);
  const reserved = z.object({ path: z.string() }).parse(
    await rpcOrThrow(auth.supabase.schema("api").rpc("start_evidence_upload", { p_incident_id: id.data, p_content_type: input.content_type })),
  );
  const upload = await createEvidenceUploadUrl(auth.supabase, reserved.path);
  return ok({ upload_url: upload.uploadUrl, token: upload.token, path: upload.path, content_type: input.content_type }, requestId, { status: 201 });
});
