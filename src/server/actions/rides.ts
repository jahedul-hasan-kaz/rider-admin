"use server";

import { z } from "zod";
import {
  discardDraftSchema,
  publishFareSchema,
  requestReasonSchema,
  retireFareSchema,
  ruleIdSchema,
  saveFareDraftSchema,
  simulateFareSchema,
  tripNoteSchema,
  tripReasonSchema,
} from "@/lib/schemas/rides";
import { runAdminAction } from "@/server/actions/run";
import type { AdminContext } from "@/server/auth/context";
import { fromPostgrestError } from "@/server/http/errors";
import { orNull } from "@/server/http/handler";
import { breakdownSchema, getOpsSnapshot, type OpsSnapshot } from "@/server/queries/rides";

// M2 admin actions: permission → Zod → one RPC. Rules, audit and state checks live in SQL.

type RpcResult = { data: unknown; error: unknown };
async function rpc(promise: PromiseLike<RpcResult>) {
  const { data, error } = await promise;
  if (error) throw fromPostgrestError(error as Parameters<typeof fromPostgrestError>[0]);
  return data;
}
const api = (ctx: AdminContext) => ctx.supabase.schema("api");

// --- Fare rules ---------------------------------------------------------------

export async function saveFareDraft(input: unknown) {
  return runAdminAction("fares.manage", saveFareDraftSchema, input, async (ctx, d) => {
    const id = await rpc(
      api(ctx).rpc("save_fare_draft", {
        p_id: orNull(d.id ?? undefined),
        p_category_id: d.categoryId,
        p_zone_id: orNull(d.zoneId ?? undefined),
        p_values: d.values,
        p_change_note: orNull(d.changeNote),
        p_expected_version: orNull(d.expectedVersion ?? undefined),
      }),
    );
    return { id: z.uuid().parse(id) };
  });
}

export async function cloneFareRule(input: unknown) {
  return runAdminAction("fares.manage", ruleIdSchema, input, async (ctx, d) => {
    const id = await rpc(api(ctx).rpc("clone_fare_rule", { p_rule_id: d.ruleId }));
    return { id: z.uuid().parse(id) };
  });
}

export async function discardFareDraft(input: unknown) {
  return runAdminAction("fares.manage", discardDraftSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("discard_fare_draft", { p_rule_id: d.ruleId, p_reason: d.reason }));
  });
}

export async function publishFareRule(input: unknown) {
  return runAdminAction("fares.publish", publishFareSchema, input, async (ctx, d) => {
    await rpc(
      api(ctx).rpc("publish_fare_rule", {
        p_rule_id: d.ruleId,
        p_effective_from: orNull(d.effectiveFrom ?? undefined),
        p_reason: d.reason,
      }),
    );
  });
}

export async function retireFareRule(input: unknown) {
  return runAdminAction("fares.publish", retireFareSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("retire_fare_rule", { p_rule_id: d.ruleId, p_reason: d.reason }));
  });
}

const simulationSchema = z.object({
  breakdown: breakdownSchema.passthrough(),
  compare: breakdownSchema.passthrough().optional(),
});

/** Prices unsaved draft values (or compares with a stored rule) through the same SQL engine as real quotes. */
export async function simulateFare(input: unknown) {
  return runAdminAction("fares.view", simulateFareSchema, input, async (ctx, d) => {
    const data = await rpc(
      api(ctx).rpc("simulate_fare", {
        p_values: d.values,
        p_distance_m: d.distanceM,
        p_duration_s: d.durationS,
        p_waiting_s: d.waitingS,
        p_surge: d.surge,
        p_compare_rule_id: orNull(d.compareRuleId ?? undefined),
      }),
    );
    return simulationSchema.parse(data);
  });
}

// --- Dispatch and trips ---------------------------------------------------------

export async function redispatchRequest(input: unknown) {
  return runAdminAction("dispatch.intervene", requestReasonSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("redispatch_request", { p_request_id: d.requestId, p_reason: d.reason }));
  });
}

export async function expireRequest(input: unknown) {
  return runAdminAction("dispatch.intervene", requestReasonSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("expire_request", { p_request_id: d.requestId, p_reason: d.reason }));
  });
}

export async function cancelTrip(input: unknown) {
  return runAdminAction("trips.cancel", tripReasonSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("admin_cancel_trip", { p_trip_id: d.tripId, p_reason: d.reason }));
  });
}

export async function resolveTripFailed(input: unknown) {
  return runAdminAction("trips.resolve", tripReasonSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("resolve_trip_failed", { p_trip_id: d.tripId, p_reason: d.reason }));
  });
}

export async function addTripNote(input: unknown) {
  return runAdminAction("trips.note", tripNoteSchema, input, async (ctx, d) => {
    await rpc(api(ctx).rpc("add_trip_note", { p_trip_id: d.tripId, p_body: d.body }));
  });
}

// --- Live ops -------------------------------------------------------------------

/** Polled by the live map every 5 s (cheaper than streaming every driver position). */
export async function loadOpsSnapshot() {
  return runAdminAction("dispatch.view", z.object({}), {}, async (ctx): Promise<OpsSnapshot> => getOpsSnapshot(ctx));
}
