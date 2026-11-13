import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import type { Permission } from "@/lib/permissions";
import { getAdminContext, requirePermission, type AdminContext } from "@/server/auth/context";
import { AppError, fromZodError, type ErrorCode } from "@/server/http/errors";
import { log } from "@/server/log";

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details: Record<string, unknown> } };

/**
 * The shape of every admin Server Action (docs/spec/05-api.md §3):
 * permission check → Zod → handler (one RPC) → typed result. Never throws to the client.
 * `permission: null` means any active MFA-verified admin; the RPC then decides
 * which permission applies (e.g. PII reveal depends on the subject's role).
 */
export async function runAdminAction<S extends z.ZodType, T>(
  permission: Permission | null,
  schema: S,
  input: unknown,
  handler: (ctx: AdminContext, data: z.infer<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const ctx = permission ? await requirePermission(permission) : await getAdminContext();
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw fromZodError(parsed.error);
    return { ok: true, data: await handler(ctx, parsed.data) };
  } catch (error) {
    unstable_rethrow(error); // let redirect()/notFound() through
    if (error instanceof AppError && error.code !== "INTERNAL") {
      return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
    }
    log.error({ err: error, permission }, "admin action failed");
    return { ok: false, error: { code: "INTERNAL", message: "Something went wrong.", details: {} } };
  }
}
