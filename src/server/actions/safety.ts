"use server";

import { z } from "zod";
import { EVIDENCE_CONTENT_TYPES } from "@/lib/schemas/api";
import { runAdminAction } from "@/server/actions/run";
import type { AdminContext } from "@/server/auth/context";
import { fromPostgrestError } from "@/server/http/errors";
import { orNull } from "@/server/http/handler";
import { evidenceRowSchema } from "@/server/queries/care";
import { api, call } from "@/server/queries/rpc";
import { createEvidenceUploadUrl, signedEvidenceUrl, verifyEvidence } from "@/server/services/safety-evidence";

// Safety-evidence actions for the admin: reserve a path, finish after the browser uploaded, list, and open (logged).

const uuid = z.uuid();
const contentType = z.enum(EVIDENCE_CONTENT_TYPES);

async function rpc(promise: PromiseLike<{ data: unknown; error: unknown }>) {
  const { data, error } = await promise;
  if (error) throw fromPostgrestError(error as Parameters<typeof fromPostgrestError>[0]);
  return data;
}
const rpcs = (ctx: AdminContext) => ctx.supabase.schema("api");

export async function startEvidenceUpload(input: unknown) {
  return runAdminAction("safety.manage", z.strictObject({ incidentId: uuid, contentType }), input, async (ctx, d) => {
    const reserved = z.object({ path: z.string() }).parse(await rpc(rpcs(ctx).rpc("start_evidence_upload", { p_incident_id: d.incidentId, p_content_type: d.contentType })));
    const upload = await createEvidenceUploadUrl(ctx.supabase, reserved.path);
    return { path: upload.path, token: upload.token };
  });
}

export async function completeEvidenceUpload(input: unknown) {
  return runAdminAction(
    "safety.manage",
    z.strictObject({
      incidentId: uuid,
      path: z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp|pdf|m4a|mp4)$/),
      contentType,
      description: z.string().trim().max(500).optional(),
    }),
    input,
    async (ctx, d) => {
      const verified = await verifyEvidence(d.path, d.contentType);
      await rpc(
        rpcs(ctx).rpc("complete_evidence_upload", {
          p_incident_id: d.incidentId,
          p_path: d.path,
          p_content_type: d.contentType,
          p_size: verified.size,
          p_sha256: verified.sha256,
          p_description: orNull(d.description),
        }),
      );
    },
  );
}

export async function listEvidence(input: unknown) {
  return runAdminAction("safety.view", z.strictObject({ incidentId: uuid }), input, (ctx, d) =>
    call(api(ctx).rpc("list_evidence", { p_incident_id: d.incidentId }), z.array(evidenceRowSchema)),
  );
}

/** Logs the access, then signs a 60-second URL. */
export async function openEvidence(input: unknown) {
  return runAdminAction("safety.view_evidence", z.strictObject({ id: uuid }), input, async (ctx, d) => {
    const row = z.object({ path: z.string() }).parse(await rpc(rpcs(ctx).rpc("open_evidence", { p_evidence_id: d.id })));
    return { url: await signedEvidenceUrl(ctx.supabase, row.path) };
  });
}
