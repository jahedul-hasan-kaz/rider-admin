"use server";

import { z } from "zod";
import { runAdminAction } from "@/server/actions/run";
import { fromPostgrestError } from "@/server/http/errors";
import { api, call } from "@/server/queries/rpc";

// Saved list views: a name plus the URL query of the filters. The query is stored as text and only ever re-applied as
// a link on the same page, so it cannot do anything a person could not already do by typing the filters.

const page = z.enum(["trips", "requests", "payments", "support", "drivers", "passengers", "documents", "vehicles", "refunds", "ratings", "safety", "audit"]);

const viewSchema = z.object({ id: z.uuid(), name: z.string(), query: z.string(), is_shared: z.boolean(), mine: z.boolean(), owner_name: z.string().nullable() });
export type SavedView = z.infer<typeof viewSchema>;

export async function loadSavedViews(input: unknown) {
  return runAdminAction(null, z.strictObject({ page }), input, (ctx, d) => call(api(ctx).rpc("list_saved_views", { p_page: d.page }), z.array(viewSchema)));
}

export async function saveView(input: unknown) {
  return runAdminAction(
    null,
    z.strictObject({ page, name: z.string().trim().min(1).max(60), query: z.string().max(500).refine((q) => !/[<>"]/.test(q)), shared: z.boolean() }),
    input,
    async (ctx, d) => {
      const { error } = await ctx.supabase.schema("api").rpc("save_view", { p_page: d.page, p_name: d.name, p_query: d.query, p_shared: d.shared });
      if (error) throw fromPostgrestError(error);
    },
  );
}

export async function deleteSavedView(input: unknown) {
  return runAdminAction(null, z.strictObject({ id: z.uuid() }), input, async (ctx, d) => {
    const { error } = await ctx.supabase.schema("api").rpc("delete_view", { p_id: d.id });
    if (error) throw fromPostgrestError(error);
  });
}
