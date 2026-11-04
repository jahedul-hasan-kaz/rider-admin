"use server";

import { z } from "zod";
import { reasonSchema } from "@/lib/schemas/admins";
import { runAdminAction } from "@/server/actions/run";
import type { AdminContext } from "@/server/auth/context";
import { fromPostgrestError } from "@/server/http/errors";
import { orNull } from "@/server/http/handler";
import { getSettingHistory } from "@/server/queries/insight";

// M4 admin actions: permission → Zod → one RPC. Validation ranges for settings live in SQL, next to the data.

type RpcResult = { data: unknown; error: unknown };
async function rpc(promise: PromiseLike<RpcResult>) {
  const { data, error } = await promise;
  if (error) throw fromPostgrestError(error as Parameters<typeof fromPostgrestError>[0]);
  return data;
}
const api = (ctx: AdminContext) => ctx.supabase.schema("api");

const uuid = z.uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function updateSetting(input: unknown) {
  return runAdminAction(
    "settings.manage",
    z.strictObject({ key: z.string().min(3).max(80), value: z.unknown(), expectedVersion: z.number().int().positive().nullable(), reason: reasonSchema }),
    input,
    async (ctx, d) => {
      await rpc(api(ctx).rpc("update_setting", { p_key: d.key, p_value: d.value as never, p_expected_version: orNull(d.expectedVersion ?? undefined), p_reason: d.reason }));
    },
  );
}

export async function loadSettingHistory(input: unknown) {
  return runAdminAction("settings.view", z.strictObject({ key: z.string().min(3).max(80) }), input, (ctx, d) => getSettingHistory(ctx, d.key));
}

export async function setFlag(input: unknown) {
  return runAdminAction(
    "settings.manage",
    z.strictObject({
      key: z.string().min(3).max(41),
      enabled: z.boolean(),
      rules: z.strictObject({
        zone_ids: z.array(uuid).max(50).optional(),
        category_ids: z.array(uuid).max(20).optional(),
        percentage: z.number().min(0).max(100).optional(),
      }),
      expectedVersion: z.number().int().positive().nullable(),
      reason: reasonSchema,
    }),
    input,
    async (ctx, d) => {
      await rpc(api(ctx).rpc("set_flag", { p_key: d.key, p_enabled: d.enabled, p_rules: d.rules, p_expected_version: orNull(d.expectedVersion ?? undefined), p_reason: d.reason }));
    },
  );
}

export async function requestExport(input: unknown) {
  return runAdminAction(
    "analytics.export",
    z.strictObject({ kind: z.enum(["trips", "payments", "ledger", "tickets", "drivers"]), from: isoDate, to: isoDate }),
    input,
    async (ctx, d) => {
      const data = z.object({ id: uuid, status: z.string() }).parse(await rpc(api(ctx).rpc("request_export", { p_kind: d.kind, p_from: d.from, p_to: d.to })));
      return data;
    },
  );
}

export async function acknowledgeAlert(input: unknown) {
  return runAdminAction(null, z.strictObject({ id: uuid, note: reasonSchema }), input, async (ctx, d) => {
    await rpc(api(ctx).rpc("acknowledge_alert", { p_id: d.id, p_note: d.note }));
  });
}
