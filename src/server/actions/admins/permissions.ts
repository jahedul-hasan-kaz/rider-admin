"use server";

import { updateTag } from "next/cache";
import {
  applyPermissionChangesSchema,
  clearOverrideSchema,
  createTemplateSchema,
  deleteTemplateSchema,
  permissionOverrideSchema,
  setTemplatePermissionsSchema,
  templateAssignmentSchema,
} from "@/lib/schemas/admins";
import { runAdminAction } from "@/server/actions/run";
import { fromPostgrestError } from "@/server/http/errors";

// Every guardrail (no self-escalation, last super admin, self-lockout, reason,
// audit, notification) is enforced inside the RPCs; these actions only
// validate input and map errors.

export async function assignPermissionTemplate(input: unknown) {
  return runAdminAction("admins.manage_permissions", templateAssignmentSchema, input, async (ctx, data) => {
    const { error } = await ctx.supabase.schema("api").rpc("assign_permission_template", {
      p_admin_id: data.adminId,
      p_template_id: data.templateId,
      p_reason: data.reason,
    });
    if (error) throw fromPostgrestError(error);
    updateTag(`admin:${data.adminId}`);
  });
}

export async function revokePermissionTemplate(input: unknown) {
  return runAdminAction("admins.manage_permissions", templateAssignmentSchema, input, async (ctx, data) => {
    const { error } = await ctx.supabase.schema("api").rpc("revoke_permission_template", {
      p_admin_id: data.adminId,
      p_template_id: data.templateId,
      p_reason: data.reason,
    });
    if (error) throw fromPostgrestError(error);
    updateTag(`admin:${data.adminId}`);
  });
}

export async function setPermissionOverride(input: unknown) {
  return runAdminAction("admins.manage_permissions", permissionOverrideSchema, input, async (ctx, data) => {
    const { error } = await ctx.supabase.schema("api").rpc("set_permission_override", {
      p_admin_id: data.adminId,
      p_permission: data.permission,
      p_effect: data.effect,
      p_reason: data.reason,
    });
    if (error) throw fromPostgrestError(error);
    updateTag(`admin:${data.adminId}`);
  });
}

export async function clearPermissionOverride(input: unknown) {
  return runAdminAction("admins.manage_permissions", clearOverrideSchema, input, async (ctx, data) => {
    const { error } = await ctx.supabase.schema("api").rpc("clear_permission_override", {
      p_admin_id: data.adminId,
      p_permission: data.permission,
      p_reason: data.reason,
    });
    if (error) throw fromPostgrestError(error);
    updateTag(`admin:${data.adminId}`);
  });
}

export async function applyPermissionChanges(input: unknown) {
  return runAdminAction("admins.manage_permissions", applyPermissionChangesSchema, input, async (ctx, data) => {
    const { error } = await ctx.supabase.schema("api").rpc("apply_admin_permission_changes", {
      p_admin_id: data.adminId,
      p_add_templates: data.addTemplates,
      p_remove_templates: data.removeTemplates,
      p_overrides: data.overrides,
      p_reason: data.reason,
    });
    if (error) throw fromPostgrestError(error);
    updateTag(`admin:${data.adminId}`);
  });
}

// Template management: the RPCs additionally require the super_admin template.

export async function createPermissionTemplate(input: unknown) {
  return runAdminAction("admins.manage_permissions", createTemplateSchema, input, async (ctx, data) => {
    const { data: templateId, error } = await ctx.supabase.schema("api").rpc("create_permission_template", {
      p_code: data.code,
      p_name: data.name,
      p_description: data.description ?? "",
      p_permissions: data.permissions,
      p_reason: data.reason,
    });
    if (error) throw fromPostgrestError(error);
    updateTag("permission-templates");
    return { templateId };
  });
}

export async function setTemplatePermissions(input: unknown) {
  return runAdminAction("admins.manage_permissions", setTemplatePermissionsSchema, input, async (ctx, data) => {
    const { data: affectedAdmins, error } = await ctx.supabase.schema("api").rpc("set_template_permissions", {
      p_template_id: data.templateId,
      p_permissions: data.permissions,
      p_reason: data.reason,
    });
    if (error) throw fromPostgrestError(error);
    updateTag("permission-templates");
    updateTag("admins");
    return { affectedAdmins };
  });
}

export async function deletePermissionTemplate(input: unknown) {
  return runAdminAction("admins.manage_permissions", deleteTemplateSchema, input, async (ctx, data) => {
    const { error } = await ctx.supabase.schema("api").rpc("delete_permission_template", {
      p_template_id: data.templateId,
      p_reason: data.reason,
    });
    if (error) throw fromPostgrestError(error);
    updateTag("permission-templates");
  });
}
