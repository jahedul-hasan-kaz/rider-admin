import "server-only";
import { z } from "zod";
import type { AdminContext } from "@/server/auth/context";
import { fromPostgrestError } from "@/server/http/errors";

// Typed readers for the admin RPCs (one round trip each, permission-checked in SQL).

const templateRef = z.object({ id: z.uuid(), code: z.string(), name: z.string() });

export const adminRowSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  email: z.string().nullable(),
  status: z.enum(["active", "suspended", "deactivated"]),
  created_at: z.string(),
  mfa_enrolled_at: z.string().nullable(),
  last_login_at: z.string().nullable(),
  templates: z.array(templateRef),
  override_count: z.number(),
});
export type AdminRow = z.infer<typeof adminRowSchema>;

export const adminDetailSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  email: z.string().nullable(),
  status: z.enum(["active", "suspended", "deactivated"]),
  suspended_reason: z.string().nullable(),
  created_at: z.string(),
  version: z.number(),
  title: z.string().nullable(),
  department: z.string().nullable(),
  mfa_enrolled_at: z.string().nullable(),
  last_login_at: z.string().nullable(),
  must_change_password: z.boolean(),
  is_super_admin: z.boolean(),
  templates: z.array(
    templateRef.extend({ assigned_at: z.string(), reason: z.string(), assigned_by: z.string().nullable() }),
  ),
  overrides: z.array(
    z.object({
      permission: z.string(),
      effect: z.enum(["grant", "deny"]),
      reason: z.string(),
      created_at: z.string(),
      granted_by: z.string().nullable(),
    }),
  ),
  permissions: z.array(z.string()),
});
export type AdminDetail = z.infer<typeof adminDetailSchema>;

export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  full_name: z.string(),
  status: z.enum(["pending", "accepted", "cancelled", "expired"]),
  expires_at: z.string(),
  created_at: z.string(),
  reason: z.string(),
  invited_by: z.string().nullable(),
  templates: z.array(z.string()),
});
export type Invitation = z.infer<typeof invitationSchema>;

export const catalogueSchema = z.object({
  permissions: z.array(
    z.object({ code: z.string(), module: z.string(), description: z.string(), is_high_impact: z.boolean() }),
  ),
  templates: z.array(
    z.object({
      id: z.uuid(),
      code: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      is_builtin: z.boolean(),
      permissions: z.array(z.string()),
      admin_count: z.number(),
    }),
  ),
});
export type Catalogue = z.infer<typeof catalogueSchema>;
export type CataloguePermission = Catalogue["permissions"][number];
export type CatalogueTemplate = Catalogue["templates"][number];

export async function listAdmins(ctx: AdminContext, filters: { q?: string; status?: string }) {
  const { data, error } = await ctx.supabase.schema("api").rpc("list_admins", {
    p_search: filters.q,
    p_status: filters.status,
  });
  if (error) throw fromPostgrestError(error);
  return z.array(adminRowSchema).parse(data);
}

export async function getAdmin(ctx: AdminContext, id: string) {
  const { data, error } = await ctx.supabase.schema("api").rpc("get_admin", { p_admin_id: id });
  if (error) throw fromPostgrestError(error);
  return adminDetailSchema.parse(data);
}

export async function listInvitations(ctx: AdminContext) {
  const { data, error } = await ctx.supabase.schema("api").rpc("list_admin_invitations");
  if (error) throw fromPostgrestError(error);
  return z.array(invitationSchema).parse(data);
}

export async function getCatalogue(ctx: AdminContext) {
  const { data, error } = await ctx.supabase.schema("api").rpc("list_permission_catalogue");
  if (error) throw fromPostgrestError(error);
  return catalogueSchema.parse(data);
}
