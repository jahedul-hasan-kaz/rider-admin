"use server";

import { z } from "zod";
import { getAdminContext } from "@/server/auth/context";
import { AppError, fromPostgrestError, fromZodError } from "@/server/http/errors";
import type { ActionResult } from "@/server/actions/run";

const markReadSchema = z.strictObject({ ids: z.array(z.uuid()).max(200).optional() });

const notificationSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  link: z.string().nullable(),
  read_at: z.string().nullable(),
  created_at: z.string(),
});
const listSchema = z.object({ unread: z.number(), items: z.array(notificationSchema) });
export type NotificationList = z.infer<typeof listSchema>;

/** The signed-in admin's latest notifications and unread count. */
export async function getMyNotifications(): Promise<NotificationList> {
  const ctx = await getAdminContext();
  const { data, error } = await ctx.supabase.schema("api").rpc("list_my_notifications", { p_limit: 20 });
  if (error) throw fromPostgrestError(error);
  return listSchema.parse(data);
}

/** Marks the signed-in admin's notifications read (all when no ids are given). */
export async function markNotificationsRead(input: unknown): Promise<ActionResult<{ updated: number }>> {
  const parsed = markReadSchema.safeParse(input);
  if (!parsed.success) {
    const err = fromZodError(parsed.error);
    return { ok: false, error: { code: err.code, message: err.message, details: err.details } };
  }

  const ctx = await getAdminContext();
  const { data, error } = await ctx.supabase.schema("api").rpc("mark_notifications_read", {
    p_ids: parsed.data.ids,
  });
  if (error) {
    const err = fromPostgrestError(error);
    return { ok: false, error: { code: err.code, message: err.message, details: err.details } };
  }
  if (typeof data !== "number") throw new AppError("INTERNAL");
  return { ok: true, data: { updated: data } };
}
