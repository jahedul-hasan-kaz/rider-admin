"use server";

import { getAdminContext } from "@/server/auth/context";

export type NavCounts = { documents?: number; applications?: number };

/** Pending-work badges for the sidebar (polled; only for permissions held). */
export async function getNavCounts(): Promise<NavCounts> {
  const ctx = await getAdminContext();
  const api = ctx.supabase.schema("api");
  const counts: NavCounts = {};

  const [docs, drivers] = await Promise.all([
    ctx.permissions.has("documents.view") ? api.rpc("list_document_queue", { p_queue: "pending", p_limit: 1 }) : null,
    ctx.permissions.has("drivers.view") ? api.rpc("list_drivers", { p_tab: "applications", p_limit: 1 }) : null,
  ]);

  const docCounts = (docs?.data as { counts?: { pending?: number } } | null)?.counts;
  if (typeof docCounts?.pending === "number") counts.documents = docCounts.pending;
  const driverCounts = (drivers?.data as { counts?: { applications?: number } } | null)?.counts;
  if (typeof driverCounts?.applications === "number") counts.applications = driverCounts.applications;
  return counts;
}
