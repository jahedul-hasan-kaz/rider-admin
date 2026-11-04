import "server-only";
import { z } from "zod";
import type { AdminContext } from "@/server/auth/context";
import { fromPostgrestError } from "@/server/http/errors";
import type { Json } from "@/types/database";

const json = z.custom<Json>(() => true);

export const auditRowSchema = z.object({
  id: z.number(),
  created_at: z.string(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string().nullable(),
  admin_id: z.string().nullable(),
  admin_name: z.string().nullable(),
  reason: z.string().nullable(),
  before: json.nullable(),
  after: json.nullable(),
  ip: z.string().nullable(),
  request_id: z.string().nullable(),
});
export type AuditRow = z.infer<typeof auditRowSchema>;

export const changeRowSchema = z.object({
  id: z.number(),
  created_at: z.string(),
  table_name: z.string(),
  record_id: z.string().nullable(),
  op: z.enum(["INSERT", "UPDATE", "DELETE"]),
  changed_cols: z.array(z.string()).nullable(),
  old_row: json.nullable(),
  new_row: json.nullable(),
  actor_id: z.string().nullable(),
  actor_name: z.string().nullable(),
  request_id: z.string().nullable(),
});
export type ChangeRow = z.infer<typeof changeRowSchema>;

const page = <T extends z.ZodType>(row: T) =>
  z.object({ rows: z.array(row), next_cursor: z.number().nullable().optional() });

const cursor = (value?: string) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
};

export async function listAuditLogs(
  ctx: AdminContext,
  f: { adminId?: string; entityId?: string; action?: string; cursor?: string; limit?: number },
) {
  const { data, error } = await ctx.supabase.schema("api").rpc("list_admin_audit_logs", {
    p_admin_id: f.adminId,
    p_entity_id: f.entityId,
    p_action: f.action,
    p_limit: f.limit ?? 50,
    p_cursor: cursor(f.cursor),
  });
  if (error) throw fromPostgrestError(error);
  return page(auditRowSchema).parse(data);
}

export async function listChangeLog(ctx: AdminContext, f: { table?: string; recordId?: string; cursor?: string }) {
  const { data, error } = await ctx.supabase.schema("api").rpc("list_change_log", {
    p_table: f.table,
    p_record_id: f.recordId,
    p_limit: 50,
    p_cursor: cursor(f.cursor),
  });
  if (error) throw fromPostgrestError(error);
  return page(changeRowSchema).parse(data);
}
