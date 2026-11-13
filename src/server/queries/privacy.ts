import "server-only";
import { z } from "zod";
import type { AdminContext } from "@/server/auth/context";
import { api, call } from "@/server/queries/rpc";

export const deletionRequestSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  role: z.string(),
  name: z.string(),
  reason: z.string().nullable(),
  status: z.enum(["pending", "restored", "completed"]),
  requested_at: z.string(),
  anonymise_after: z.string(),
  completed_at: z.string().nullable(),
  restored_at: z.string().nullable(),
  can_restore: z.boolean(),
});
export type DeletionRequest = z.infer<typeof deletionRequestSchema>;

export const listDeletionRequests = (ctx: AdminContext, status: "pending" | null) =>
  call(api(ctx).rpc("list_deletion_requests", { p_status: status ?? undefined }), z.array(deletionRequestSchema));
