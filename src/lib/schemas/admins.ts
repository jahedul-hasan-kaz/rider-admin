import { z } from "zod";
import { PERMISSIONS } from "@/lib/permissions";

// Shared by admin forms and Server Actions (docs/spec/02-roles-permissions.md §5).

/** Trim and lowercase first, then validate (Zod checks formats before transforms). */
export const emailInput = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const reasonSchema = z.string().trim().min(5, "Give a reason of at least 5 characters.").max(1000);

const uuid = z.uuid();
const permission = z.enum(PERMISSIONS);

export const inviteAdminSchema = z.strictObject({
  email: emailInput,
  fullName: z.string().trim().min(1).max(120),
  templateIds: z.array(uuid).max(10).default([]),
  reason: reasonSchema,
});

export const cancelInvitationSchema = z.strictObject({ invitationId: uuid, reason: reasonSchema });

export const templateAssignmentSchema = z.strictObject({
  adminId: uuid,
  templateId: uuid,
  reason: reasonSchema,
});

export const permissionOverrideSchema = z.strictObject({
  adminId: uuid,
  permission,
  effect: z.enum(["grant", "deny"]),
  reason: reasonSchema,
});

export const clearOverrideSchema = z.strictObject({ adminId: uuid, permission, reason: reasonSchema });

/** One save from the permission editor: applied atomically in a single RPC. */
export const applyPermissionChangesSchema = z
  .strictObject({
    adminId: uuid,
    addTemplates: z.array(uuid).max(20),
    removeTemplates: z.array(uuid).max(20),
    overrides: z.array(z.strictObject({ permission, effect: z.enum(["grant", "deny", "clear"]) })).max(PERMISSIONS.length),
    reason: reasonSchema,
  })
  .refine((v) => v.addTemplates.length + v.removeTemplates.length + v.overrides.length > 0, {
    path: ["overrides"],
    message: "Nothing to save.",
  });

export const adminStatusSchema = z.strictObject({ adminId: uuid, reason: reasonSchema });

export const createTemplateSchema = z.strictObject({
  code: z.string().trim().regex(/^[a-z][a-z0-9_]{2,40}$/, "Use 3–41 lowercase letters, digits or underscores."),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(permission).max(PERMISSIONS.length),
  reason: reasonSchema,
});

export const setTemplatePermissionsSchema = z.strictObject({
  templateId: uuid,
  permissions: z.array(permission).max(PERMISSIONS.length),
  reason: reasonSchema,
});

export const deleteTemplateSchema = z.strictObject({ templateId: uuid, reason: reasonSchema });
