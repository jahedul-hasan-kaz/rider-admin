"use server";

import { z } from "zod";
import {
  assignDriverSchema,
  bookRideSchema,
  cancelRequestSchema,
  confirmCashSchema,
  createAccountSchema,
  createAlertSchema,
  deleteAccountSchema,
  pickPeopleSchema,
  resolveAlertSchema,
  retireVehicleSchema,
  saveVehicleSchema,
  updateContactSchema,
  updateDocumentSchema,
  updateRefundSchema,
  updateRequestSchema,
  withdrawDocumentSchema,
} from "@/lib/schemas/admin-crud";
import { runAdminAction } from "@/server/actions/run";
import { serverEnv } from "@/server/env";
import { fromPostgrestError } from "@/server/http/errors";
import { createAccount as createAccountService } from "@/server/services/admin-accounts";
import { getRoute } from "@/server/services/routing";

// Staff create / update / delete (supabase/migrations/20261110090000_m7_admin_crud.sql). Each action: Zod → one RPC as
// the signed-in admin; the database checks the exact permission, the state and the reason, and writes the audit log.
// `permission: null` lets the RPC pick the permission when it depends on the record (passenger vs driver).

type RpcResult = { data: unknown; error: unknown };
async function rpc<T = unknown>(promise: PromiseLike<RpcResult>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw fromPostgrestError(error as Parameters<typeof fromPostgrestError>[0]);
  return data as T;
}

// --- Accounts ---------------------------------------------------------------
export async function createAccount(input: unknown) {
  return runAdminAction(null, createAccountSchema, input, (ctx, d) => createAccountService(ctx.supabase, d));
}

export async function updateContact(input: unknown) {
  return runAdminAction(null, updateContactSchema, input, (ctx, d) =>
    rpc(ctx.supabase.schema("api").rpc("admin_update_contact", { p_profile_id: d.profileId, p_full_name: d.fullName, p_phone: d.phone || (null as unknown as string), p_reason: d.reason })),
  );
}

export async function deleteAccount(input: unknown) {
  return runAdminAction(null, deleteAccountSchema, input, (ctx, d) =>
    rpc(ctx.supabase.schema("api").rpc("admin_delete_account", { p_user_id: d.profileId, p_reason: d.reason })),
  );
}

// --- Vehicles ---------------------------------------------------------------
export async function saveVehicle(input: unknown) {
  return runAdminAction("vehicles.manage", saveVehicleSchema, input, (ctx, d) =>
    rpc<{ id: string }>(
      ctx.supabase.schema("api").rpc("admin_save_vehicle", {
        p_id: d.id as string,
        p_driver_id: d.driverId as string,
        p_category_id: d.categoryId,
        p_make: d.make,
        p_model: d.model,
        p_color: d.color,
        p_registration_number: d.registrationNumber,
        p_year: d.year,
        p_reason: d.reason,
      }),
    ),
  );
}

export async function retireVehicle(input: unknown) {
  return runAdminAction("vehicles.manage", retireVehicleSchema, input, (ctx, d) =>
    rpc(ctx.supabase.schema("api").rpc("admin_retire_vehicle", { p_id: d.vehicleId, p_reason: d.reason })),
  );
}

// --- Documents --------------------------------------------------------------
export async function updateDocument(input: unknown) {
  return runAdminAction("documents.manage", updateDocumentSchema, input, (ctx, d) =>
    rpc(ctx.supabase.schema("api").rpc("admin_update_document", { p_id: d.documentId, p_issued_at: d.issuedAt as string, p_expires_at: d.expiresAt as string, p_reason: d.reason })),
  );
}

export async function withdrawDocument(input: unknown) {
  return runAdminAction("documents.manage", withdrawDocumentSchema, input, (ctx, d) =>
    rpc(ctx.supabase.schema("api").rpc("admin_withdraw_document", { p_id: d.documentId, p_reason: d.reason })),
  );
}

// --- Ride requests and trips ------------------------------------------------
export async function bookRide(input: unknown) {
  return runAdminAction("trips.create", bookRideSchema, input, async (ctx, d) => {
    const env = serverEnv();
    // Same distance and time source as the passenger app's quote.
    const route = await getRoute(d.pickup, d.destination, { provider: env.ROUTING_PROVIDER, apiKey: env.ROUTING_API_KEY });
    return rpc<{ id: string; estimated_fare: number }>(
      ctx.supabase.schema("api").rpc("admin_book_ride", {
        p_passenger_id: d.passengerId,
        p_category_id: d.categoryId,
        p_pickup_lat: d.pickup.lat,
        p_pickup_lng: d.pickup.lng,
        p_pickup_label: d.pickup.label,
        p_destination_lat: d.destination.lat,
        p_destination_lng: d.destination.lng,
        p_destination_label: d.destination.label,
        p_distance_m: route.distanceM,
        p_duration_s: route.durationS,
        p_payment_method: d.paymentMethod,
        p_pickup_note: d.pickupNote,
        p_reason: d.reason,
      }),
    );
  });
}

export async function updateRequest(input: unknown) {
  return runAdminAction("dispatch.intervene", updateRequestSchema, input, (ctx, d) =>
    rpc(ctx.supabase.schema("api").rpc("admin_update_request", { p_request_id: d.requestId, p_pickup_note: d.pickupNote, p_reason: d.reason })),
  );
}

export async function cancelRequest(input: unknown) {
  return runAdminAction("trips.cancel", cancelRequestSchema, input, (ctx, d) =>
    rpc(ctx.supabase.schema("api").rpc("admin_cancel_request", { p_request_id: d.requestId, p_reason: d.reason })),
  );
}

export async function assignDriver(input: unknown) {
  return runAdminAction("trips.create", assignDriverSchema, input, (ctx, d) =>
    rpc<{ id: string }>(ctx.supabase.schema("api").rpc("admin_assign_driver", { p_request_id: d.requestId, p_driver_id: d.driverId, p_reason: d.reason })),
  );
}

// --- Alerts -----------------------------------------------------------------
export async function createAlert(input: unknown) {
  return runAdminAction("alerts.manage", createAlertSchema, input, (ctx, d) =>
    rpc(ctx.supabase.schema("api").rpc("admin_create_alert", { p_severity: d.severity, p_title: d.title, p_detail: d.detail || `${d.reason}` })),
  );
}

export async function resolveAlert(input: unknown) {
  return runAdminAction("alerts.manage", resolveAlertSchema, input, (ctx, d) =>
    rpc(ctx.supabase.schema("api").rpc("resolve_alert", { p_id: d.id, p_note: d.reason })),
  );
}

// --- Money ------------------------------------------------------------------
export async function confirmCash(input: unknown) {
  return runAdminAction("payments.reconcile", confirmCashSchema, input, (ctx, d) =>
    rpc(ctx.supabase.schema("api").rpc("admin_confirm_cash", { p_trip_id: d.tripId, p_amount: d.amount, p_reason: d.reason })),
  );
}

export async function updateRefund(input: unknown) {
  return runAdminAction(null, updateRefundSchema, input, (ctx, d) =>
    rpc(ctx.supabase.schema("api").rpc("update_refund_request", { p_id: d.id, p_amount: d.amount, p_reason: d.reason })),
  );
}

// --- Pickers ----------------------------------------------------------------
const personSchema = z.array(
  z.object({
    id: z.uuid(),
    name: z.string(),
    phone: z.string().nullable(),
    availability: z.string().optional(),
    status: z.string().optional(),
    vehicle: z.string().nullable().optional(),
    category_id: z.uuid().nullable().optional(),
  }),
);
export type PickedPerson = z.infer<typeof personSchema>[number];

export async function pickPeople(input: unknown) {
  return runAdminAction(null, pickPeopleSchema, input, async (ctx, d) =>
    personSchema.parse(await rpc(ctx.supabase.schema("api").rpc("admin_pick_people", { p_role: d.role, p_query: d.query }))),
  );
}
