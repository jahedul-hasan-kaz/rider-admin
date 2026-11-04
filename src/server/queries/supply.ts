import "server-only";
import { z } from "zod";
import type { AdminContext } from "@/server/auth/context";
import { fromPostgrestError } from "@/server/http/errors";
import { sortFallback } from "@/server/queries/rpc";

// Typed readers for the M1 admin RPCs (permission-checked in SQL).

const ref = z.object({ id: z.uuid(), name: z.string() });

export const ONBOARDING_STATUSES = ["draft", "submitted", "under_review", "approved", "rejected", "suspended"] as const;
export const DOCUMENT_STATES = ["missing", "pending", "approved", "rejected", "expired"] as const;

export const driverRowSchema = z.object({
  id: z.uuid(),
  user_id: z.uuid(),
  full_name: z.string(),
  phone_masked: z.string().nullable(),
  email_masked: z.string().nullable(),
  account_status: z.string(),
  onboarding_status: z.enum(ONBOARDING_STATUSES),
  availability: z.enum(["offline", "online", "on_trip"]),
  rating_avg: z.number().nullable(),
  acceptance_rate_30d: z.number().nullable(),
  cancellation_rate_30d: z.number().nullable(),
  submitted_at: z.string().nullable(),
  approved_at: z.string().nullable(),
  created_at: z.string(),
  zone: ref.nullable(),
  vehicle: z
    .object({ id: z.uuid(), registration_number: z.string(), category: z.string(), status: z.string() })
    .nullable(),
});
export type DriverRow = z.infer<typeof driverRowSchema>;

export const checklistItemSchema = z.object({
  document_type: z.string(),
  document_id: z.uuid().nullable(),
  state: z.enum(DOCUMENT_STATES),
  expires_at: z.string().nullable(),
  rejection_reason: z.string().nullable(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

const driverVehicleSchema = z.object({
  id: z.uuid(),
  category: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
  make: z.string(),
  model: z.string(),
  color: z.string(),
  registration_number: z.string(),
  year: z.number(),
  status: z.enum(["pending", "active", "inactive", "suspended"]),
  suspended_reason: z.string().nullable(),
  version: z.number(),
  documents: z.array(checklistItemSchema),
});
export type DriverVehicle = z.infer<typeof driverVehicleSchema>;

export const documentSchema = z.object({
  id: z.uuid(),
  document_type: z.string(),
  vehicle_id: z.uuid().nullable(),
  review_status: z.enum(["pending", "approved", "rejected", "expired"]),
  uploaded_at: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  rejection_reason: z.string().nullable(),
  expires_at: z.string().nullable(),
  issued_at: z.string().nullable(),
  document_number_masked: z.string().nullable(),
  content_type: z.string(),
  superseded_at: z.string().nullable(),
  version: z.number(),
});
export type DriverDocument = z.infer<typeof documentSchema>;

export const driverDetailSchema = driverRowSchema.extend({
  version: z.number(),
  home_zone_id: z.uuid().nullable(),
  rejected_reason: z.string().nullable(),
  suspended_reason: z.string().nullable(),
  licence_number_masked: z.string().nullable(),
  licence_expiry: z.string().nullable(),
  current_vehicle_id: z.uuid().nullable(),
  documents: z.array(checklistItemSchema),
  vehicles: z.array(driverVehicleSchema),
  live_location: z.object({ lat: z.number(), lng: z.number(), updated_at: z.string() }).nullable().optional(),
  document_history: z.array(documentSchema),
  events: z.array(
    z.object({
      id: z.number(),
      kind: z.string(),
      old_status: z.string().nullable(),
      new_status: z.string(),
      reason: z.string().nullable(),
      actor_type: z.string(),
      actor_name: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
});
export type DriverDetail = z.infer<typeof driverDetailSchema>;

export const queueRowSchema = z.object({
  id: z.uuid(),
  driver_id: z.uuid(),
  driver_name: z.string(),
  document_type: z.string(),
  vehicle: z.object({ id: z.uuid(), registration_number: z.string() }).nullable(),
  review_status: z.string(),
  uploaded_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  rejection_reason: z.string().nullable(),
  onboarding_status: z.string(),
});
export type QueueRow = z.infer<typeof queueRowSchema>;

export const vehicleSchema = z.object({
  id: z.uuid(),
  registration_number: z.string(),
  make: z.string(),
  model: z.string(),
  color: z.string(),
  year: z.number(),
  status: z.enum(["pending", "active", "inactive", "suspended"]),
  suspended_reason: z.string().nullable(),
  verified_at: z.string().nullable(),
  created_at: z.string(),
  version: z.number(),
  category: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
  driver: z.object({ id: z.uuid(), full_name: z.string(), onboarding_status: z.string() }),
  is_current: z.boolean(),
});
export type VehicleRow = z.infer<typeof vehicleSchema>;
export const vehicleDetailSchema = vehicleSchema.extend({ documents: z.array(checklistItemSchema) });
export type VehicleDetail = z.infer<typeof vehicleDetailSchema>;

export const passengerSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  role: z.enum(["passenger", "user"]),
  status: z.enum(["active", "suspended", "deactivated"]),
  phone_masked: z.string().nullable(),
  email_masked: z.string().nullable(),
  has_phone: z.boolean(),
  has_email: z.boolean(),
  preferred_language: z.string(),
  suspended_reason: z.string().nullable(),
  created_at: z.string(),
  last_seen_at: z.string().nullable(),
  version: z.number(),
});
export type PassengerRow = z.infer<typeof passengerSchema>;
export const passengerDetailSchema = passengerSchema.extend({
  status_events: z.array(
    z.object({
      old_status: z.string().nullable(),
      new_status: z.string(),
      reason: z.string().nullable(),
      actor_name: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
});
export type PassengerDetail = z.infer<typeof passengerDetailSchema>;

export const categorySchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  name_bn: z.string().nullable(),
  description: z.string().nullable(),
  passenger_capacity: z.number(),
  icon: z.string(),
  sort_order: z.number(),
  active: z.boolean(),
  version: z.number(),
  vehicle_count: z.number(),
});
export type Category = z.infer<typeof categorySchema>;

const geometry = z.object({ type: z.string(), coordinates: z.array(z.unknown()) });
export const zoneSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
  area_km2: z.number(),
  timezone: z.string(),
  manual_surge_multiplier: z.number(),
  version: z.number(),
  updated_at: z.string(),
  boundary: geometry,
  online_drivers: z.number(),
});
export type Zone = z.infer<typeof zoneSchema>;

const page = <T extends z.ZodType>(row: T) =>
  z.object({ rows: z.array(row), next_cursor: z.string().nullable().optional() });

async function call<T extends z.ZodType>(promise: PromiseLike<{ data: unknown; error: unknown }>, schema: T): Promise<z.infer<T>> {
  const { data, error } = await promise;
  if (error) throw fromPostgrestError(error as Parameters<typeof fromPostgrestError>[0]);
  return schema.parse(data);
}

const rpc = (ctx: AdminContext) => ctx.supabase.schema("api");

export const DRIVER_TABS = ["all", "applications", "approved", "suspended", "rejected", "draft"] as const;
export type DriverTab = (typeof DRIVER_TABS)[number];

export const listDrivers = (ctx: AdminContext, f: { tab: DriverTab; q?: string; cursor?: string; sort?: string }) => sortFallback(f, (f) =>
  call(
    rpc(ctx).rpc("list_drivers", { p_tab: f.tab, p_search: f.q, p_cursor: f.cursor, p_limit: 50, p_sort: f.sort }),
    page(driverRowSchema).extend({
      counts: z.object({ applications: z.number(), approved: z.number(), suspended: z.number(), online: z.number() }),
    }),
  ));

export const getDriver = (ctx: AdminContext, id: string) => call(rpc(ctx).rpc("get_driver", { p_driver_id: id }), driverDetailSchema);

export const DOCUMENT_QUEUES = ["pending", "expiring", "expired", "rejected"] as const;
export type DocumentQueue = (typeof DOCUMENT_QUEUES)[number];

export const listDocumentQueue = (ctx: AdminContext, f: { queue: DocumentQueue; cursor?: string; sort?: string }) => sortFallback(f, (f) =>
  call(
    rpc(ctx).rpc("list_document_queue", { p_queue: f.queue, p_cursor: f.cursor, p_limit: 50, p_sort: f.sort }),
    page(queueRowSchema).extend({ counts: z.object({ pending: z.number(), expiring: z.number(), expired: z.number() }) }),
  ));

export const listVehicles = (ctx: AdminContext, f: { status?: string; q?: string; cursor?: string; sort?: string }) => sortFallback(f, (f) =>
  call(rpc(ctx).rpc("list_vehicles", { p_status: f.status, p_search: f.q, p_cursor: f.cursor, p_limit: 50, p_sort: f.sort }), page(vehicleSchema)));

export const getVehicle = (ctx: AdminContext, id: string) =>
  call(rpc(ctx).rpc("get_vehicle", { p_vehicle_id: id }), vehicleDetailSchema);

export const listPassengers = (ctx: AdminContext, f: { status?: string; q?: string; cursor?: string; sort?: string }) => sortFallback(f, (f) =>
  call(rpc(ctx).rpc("list_passengers", { p_status: f.status, p_search: f.q, p_cursor: f.cursor, p_limit: 50, p_sort: f.sort }), page(passengerSchema)));

export const getPassenger = (ctx: AdminContext, id: string) =>
  call(rpc(ctx).rpc("get_passenger", { p_profile_id: id }), passengerDetailSchema);

export const listCategories = (ctx: AdminContext) => call(rpc(ctx).rpc("list_vehicle_categories"), z.array(categorySchema));

export const listZones = (ctx: AdminContext) => call(rpc(ctx).rpc("list_zones"), z.array(zoneSchema));
