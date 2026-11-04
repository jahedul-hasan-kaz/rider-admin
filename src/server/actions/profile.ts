"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { LOCALE_COOKIE } from "@/i18n/request";
import type { ActionResult } from "@/server/actions/run";
import { getAdminContext } from "@/server/auth/context";
import { AppError, fromPostgrestError, fromZodError } from "@/server/http/errors";

const schema = z.strictObject({
  fullName: z.string().trim().min(1).max(120),
  preferredLanguage: z.enum(["en", "bn"]),
  expectedVersion: z.number().int().positive(),
});

/** Updates the signed-in admin's own name and language (optimistic concurrency). */
export async function updateOwnProfile(input: unknown): Promise<ActionResult<{ version: number }>> {
  try {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw fromZodError(parsed.error);
    const ctx = await getAdminContext();
    const { data, error } = await ctx.supabase.schema("api").rpc("update_own_profile", {
      p_full_name: parsed.data.fullName,
      p_preferred_language: parsed.data.preferredLanguage,
      p_expected_version: parsed.data.expectedVersion,
    });
    if (error) throw fromPostgrestError(error);
    (await cookies()).set(LOCALE_COOKIE, parsed.data.preferredLanguage, {
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV !== "development",
      maxAge: 60 * 60 * 24 * 365,
    });
    return { ok: true, data: z.object({ version: z.number() }).parse(data) };
  } catch (error) {
    const e = error instanceof AppError ? error : new AppError("INTERNAL");
    return { ok: false, error: { code: e.code, message: e.message, details: e.details } };
  }
}
