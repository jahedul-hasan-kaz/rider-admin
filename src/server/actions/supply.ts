"use server";

import { z } from "zod";
import {
  categorySchema,
  driverDecisionSchema,
  driverReasonSchema,
  openDocumentSchema,
  passengerStatusSchema,
  reorderCategoriesSchema,
  reviewDocumentSchema,
  revealPiiSchema,
  saveZoneSchema,
  setCurrentVehicleSchema,
  updateDriverSchema,
  updatePassengerSchema,
  vehicleDecisionSchema,
  vehicleReasonSchema,
} from "@/lib/schemas/supply";
import { runAdminAction } from "@/server/actions/run";
import { AppError, fromPostgrestError } from "@/server/http/errors";
import { orNull } from "@/server/http/handler";
import { createReadUrl } from "@/server/services/driver-documents";

// M1 admin actions. Each is: permission → Zod → one RPC (rules, audit and
// state checks live in SQL) → typed result.

type RpcResult = { data: unknown; error: unknown };
async function rpc(promise: PromiseLike<RpcResult>) {
  const { data, error } = await promise;
  if (error) throw fromPostgrestError(error as Parameters<typeof fromPostgrestError>[0]);
  return data;
}

// --- Documents ---------------------------------------------------------------

export async function reviewDocument(input: unknown) {
  return runAdminAction("documents.review", reviewDocumentSchema, input, async (ctx, d) => {
    await rpc(
      ctx.supabase.schema("api").rpc("review_driver_document", {
        p_document_id: d.documentId,
        p_decision: d.decision,
        p_reason: orNull(d.reason),
        p_expected_version: d.expectedVersion,
      }),
    );
  });
}

/** Logs the access in SQL, then returns a 60-second signed URL. */
export async function openDocument(input: unknown) {
  return runAdminAction("documents.view", openDocumentSchema, input, async (ctx, d) => {
    const meta = z
      .object({ storage_path: z.string(), content_type: z.string() })
      .parse(await rpc(ctx.supabase.schema("api").rpc("open_driver_document", { p_document_id: d.documentId })));
    return { url: await createReadUrl(ctx.supabase, meta.storage_path), contentType: meta.content_type };
  });
}

// --- Drivers -----------------------------------------------------------------

export async function approveDriver(input: unknown) {
  return runAdminAction("drivers.approve", driverDecisionSchema, input, async (ctx, d) => {
    await rpc(ctx.supabase.schema("api").rpc("approve_driver", { p_driver_id: d.driverId, p_reason: orNull(d.reason) }));
  });
}

export async function rejectDriver(input: unknown) {
  return runAdminAction("drivers.approve", driverReasonSchema, input, async (ctx, d) => {
    await rpc(ctx.supabase.schema("api").rpc("reject_driver", { p_driver_id: d.driverId, p_reason: d.reason }));
  });
}

export async function suspendDriver(input: unknown) {
  return runAdminAction("drivers.suspend", driverReasonSchema, input, async (ctx, d) => {
    await rpc(ctx.supabase.schema("api").rpc("suspend_driver", { p_driver_id: d.driverId, p_reason: d.reason }));
  });
}

export async function reactivateDriver(input: unknown) {
  return runAdminAction("drivers.suspend", driverReasonSchema, input, async (ctx, d) => {
    await rpc(ctx.supabase.schema("api").rpc("reactivate_driver", { p_driver_id: d.driverId, p_reason: d.reason }));
  });
}

export async function forceDriverOffline(input: unknown) {
  return runAdminAction("dispatch.intervene", driverReasonSchema, input, async (ctx, d) => {
    await rpc(ctx.supabase.schema("api").rpc("force_driver_offline", { p_driver_id: d.driverId, p_reason: d.reason }));
  });
}

export async function updateDriver(input: unknown) {
  return runAdminAction("drivers.update", updateDriverSchema, input, async (ctx, d) => {
    await rpc(
      ctx.supabase.schema("api").rpc("update_driver", {
        p_driver_id: d.driverId,
        p_home_zone_id: orNull(d.homeZoneId ?? undefined),
        p_expected_version: d.expectedVersion,
      }),
    );
  });
}

// --- Vehicles ----------------------------------------------------------------

export async function verifyVehicle(input: unknown) {
  return runAdminAction("vehicles.verify", vehicleDecisionSchema, input, async (ctx, d) => {
    await rpc(ctx.supabase.schema("api").rpc("verify_vehicle", { p_vehicle_id: d.vehicleId, p_reason: orNull(d.reason) }));
  });
}

export async function suspendVehicle(input: unknown) {
  return runAdminAction("vehicles.verify", vehicleReasonSchema, input, async (ctx, d) => {
    await rpc(ctx.supabase.schema("api").rpc("suspend_vehicle", { p_vehicle_id: d.vehicleId, p_reason: d.reason }));
  });
}

export async function setCurrentVehicle(input: unknown) {
  return runAdminAction("vehicles.manage", setCurrentVehicleSchema, input, async (ctx, d) => {
    await rpc(
      ctx.supabase.schema("api").rpc("set_current_vehicle", {
        p_driver_id: d.driverId,
        p_vehicle_id: d.vehicleId,
        p_reason: orNull(d.reason),
      }),
    );
  });
}

// --- Categories --------------------------------------------------------------

export async function saveCategory(input: unknown) {
  return runAdminAction("categories.manage", categorySchema, input, async (ctx, d) => {
    const id = await rpc(
      ctx.supabase.schema("api").rpc("save_vehicle_category", {
        p_id: orNull(d.id ?? undefined),
        p_code: d.code,
        p_name: d.name,
        p_name_bn: orNull(d.nameBn),
        p_description: orNull(d.description),
        p_passenger_capacity: d.passengerCapacity,
        p_icon: d.icon,
        p_active: d.active,
        p_expected_version: orNull(d.expectedVersion ?? undefined),
      }),
    );
    return { id: z.uuid().parse(id) };
  });
}

export async function reorderCategories(input: unknown) {
  return runAdminAction("categories.manage", reorderCategoriesSchema, input, async (ctx, d) => {
    await rpc(ctx.supabase.schema("api").rpc("reorder_vehicle_categories", { p_ids: d.ids }));
  });
}

// --- Zones -------------------------------------------------------------------

const saveZoneResult = z.object({
  id: z.uuid(),
  area_km2: z.number(),
  overlaps: z.array(z.object({ id: z.uuid(), name: z.string() })),
});

export async function saveZone(input: unknown) {
  return runAdminAction("zones.manage", saveZoneSchema, input, async (ctx, d) => {
    const data = await rpc(
      ctx.supabase.schema("api").rpc("save_zone", {
        p_id: orNull(d.id ?? undefined),
        p_code: d.code,
        p_name: d.name,
        p_geojson: d.geometry,
        p_active: d.active,
        p_expected_version: orNull(d.expectedVersion ?? undefined),
        p_reason: d.reason,
      }),
    );
    return saveZoneResult.parse(data);
  });
}

// --- Passengers --------------------------------------------------------------

export async function updatePassenger(input: unknown) {
  return runAdminAction("passengers.update", updatePassengerSchema, input, async (ctx, d) => {
    await rpc(
      ctx.supabase.schema("api").rpc("update_passenger", {
        p_profile_id: d.profileId,
        p_full_name: d.fullName,
        p_preferred_language: d.preferredLanguage,
        p_expected_version: d.expectedVersion,
      }),
    );
  });
}

export async function setPassengerStatus(input: unknown) {
  return runAdminAction("passengers.suspend", passengerStatusSchema, input, async (ctx, d) => {
    await rpc(
      ctx.supabase.schema("api").rpc("set_passenger_status", {
        p_profile_id: d.profileId,
        p_status: d.status,
        p_reason: d.reason,
      }),
    );
  });
}

// --- PII ---------------------------------------------------------------------

/**
 * Reveals one PII field. The RPC picks the permission (passengers/drivers.view_pii)
 * from the subject's role and logs the access; the action only requires an admin.
 */
export async function revealPii(input: unknown) {
  return runAdminAction(null, revealPiiSchema, input, async (ctx, d) => {
    const value = await rpc(
      ctx.supabase.schema("api").rpc("reveal_pii", { p_profile_id: d.profileId, p_field: d.field, p_reason: d.reason }),
    );
    if (value !== null && typeof value !== "string") throw new AppError("INTERNAL");
    return { value };
  });
}
