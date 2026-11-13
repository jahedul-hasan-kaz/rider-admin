"use server";

import { z } from "zod";
import { runAdminAction } from "@/server/actions/run";
import { fromPostgrestError } from "@/server/http/errors";

// Server-side autocomplete for pickers (supabase/migrations/20261113090000_search_options.sql).

export type OptionKind = "zones" | "categories" | "passengers" | "drivers" | "admins";

const inputSchema = z.strictObject({
  kind: z.enum(["zones", "categories", "passengers", "drivers", "admins"]),
  query: z.string().trim().max(60),
});
const optionSchema = z.object({
  value: z.string(),
  label: z.string(),
  hint: z.string().nullable().optional(),
  category_id: z.string().nullable().optional(),
});
export type SearchOption = z.infer<typeof optionSchema>;

export async function searchOptions(input: unknown) {
  return runAdminAction(null, inputSchema, input, async (ctx, d) => {
    const { data, error } = await ctx.supabase.schema("api").rpc("search_options", { p_kind: d.kind, p_query: d.query, p_limit: 20 });
    if (error) throw fromPostgrestError(error);
    return z.array(optionSchema).parse(data);
  });
}
