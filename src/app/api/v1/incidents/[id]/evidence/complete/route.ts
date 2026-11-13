import { z } from "zod";
import { evidenceCompleteSchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { AppError } from "@/server/http/errors";
import { apiRoute, orNull, rpcOrThrow } from "@/server/http/handler";
import { verifyEvidence } from "@/server/services/safety-evidence";

// POST /api/v1/incidents/{id}/evidence/complete — the server reads the uploaded file, checks its real type, stores its
// checksum and adds it to the incident timeline for the safety team.
export const POST = apiRoute({ roles: ["passenger", "driver"], rateLimit: "upload", idempotent: true }, async ({ auth, requestId, params, body }) => {
  const id = z.uuid().safeParse(params.id);
  if (!id.success) throw new AppError("NOT_FOUND");
  const input = body(evidenceCompleteSchema);
  const verified = await verifyEvidence(input.path, input.content_type);
  const data = await rpcOrThrow(
    auth.supabase.schema("api").rpc("complete_evidence_upload", {
      p_incident_id: id.data,
      p_path: input.path,
      p_content_type: input.content_type,
      p_size: verified.size,
      p_sha256: verified.sha256,
      p_description: orNull(input.description),
    }),
  );
  return ok(data, requestId, { status: 201 });
});
