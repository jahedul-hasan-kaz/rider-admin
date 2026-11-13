import "server-only";
import { z } from "zod";
import type { AdminContext } from "@/server/auth/context";
import { fromPostgrestError } from "@/server/http/errors";
import { sortFallback } from "@/server/queries/rpc";

// Typed readers for the M2 admin RPCs (permission-checked in SQL).

const coord = z.object({ lat: z.number(), lng: z.number() });
const num = z.number();

// --- Fare rules --------------------------------------------------------------

export const FARE_COMPONENTS = ["base", "distance", "time", "waiting", "surge"] as const;

export const fareRuleSchema = z.object({
  id: z.uuid(),
  category_id: z.uuid(),
  zone_id: z.uuid().nullable(),
  rule_version: z.number(),
  status: z.enum(["draft", "scheduled", "active", "retired"]),
  live_state: z.enum(["draft", "scheduled", "active", "ended"]),
  base_fare: num,
  per_km: num,
  per_minute: num,
  minimum_fare: num,
  booking_fee: num,
  waiting_per_minute: num,
  free_waiting_minutes: num,
  cancellation_fee: num,
  platform_commission_pct: num,
  max_surge_multiplier: num,
  commissionable_components: z.array(z.string()),
  effective_from: z.string().nullable(),
  effective_to: z.string().nullable(),
  published_at: z.string().nullable(),
  published_by: z.string().nullable(),
  change_note: z.string().nullable(),
  version: num,
  created_at: z.string(),
});
export type FareRule = z.infer<typeof fareRuleSchema>;

export const fareRulesPayloadSchema = z.object({
  categories: z.array(z.object({ id: z.uuid(), code: z.string(), name: z.string(), active: z.boolean() })),
  zones: z.array(z.object({ id: z.uuid(), name: z.string(), active: z.boolean(), manual_surge_multiplier: num })),
  rules: z.array(fareRuleSchema),
});
export type FareRulesPayload = z.infer<typeof fareRulesPayloadSchema>;

export const breakdownSchema = z.object({
  base_amount: num,
  distance_amount: num,
  time_amount: num,
  surge_amount: num,
  waiting_amount: num,
  minimum_adjustment: num,
  rounding_amount: num,
  booking_fee: num,
  discount_amount: num,
  total_amount: num,
  commissionable_amount: num,
  platform_commission: num,
  driver_earning: num,
  commission_pct: num,
});
export type FareBreakdownData = z.infer<typeof breakdownSchema>;

// --- Live ops ------------------------------------------------------------------

export const opsSnapshotSchema = z.object({
  generated_at: z.string(),
  metrics: z.object({
    online_drivers: num,
    on_trip_drivers: num,
    searching: num,
    active_trips: num,
    requests_15m: num,
    matched_15m: num,
    median_match_s: num.nullable(),
    p90_match_s: num.nullable(),
    no_driver_1h: num,
  }),
  drivers: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      availability: z.enum(["online", "on_trip", "offline"]),
      lat: num,
      lng: num,
      heading: num.nullable(),
      age_s: num,
    }),
  ),
  requests: z.array(
    z.object({
      id: z.uuid(),
      passenger: z.string(),
      lat: num,
      lng: num,
      pickup_label: z.string().nullable(),
      requested_at: z.string(),
      round: num,
      offers: num,
      category: z.string(),
    }),
  ),
  trips: z.array(
    z.object({
      id: z.uuid(),
      status: z.string(),
      request_id: z.uuid(),
      driver: z.string(),
      passenger: z.string(),
      started_at: z.string().nullable(),
      pickup: coord,
      destination: coord,
    }),
  ),
  exceptions: z.object({ fare_review: num, stuck_searching: num }),
});
export type OpsSnapshot = z.infer<typeof opsSnapshotSchema>;

// --- Requests ------------------------------------------------------------------

export const requestRowSchema = z.object({
  id: z.uuid(),
  status: z.string(),
  requested_at: z.string(),
  closed_at: z.string().nullable(),
  matched_at: z.string().nullable(),
  wait_s: num,
  passenger: z.object({ id: z.uuid(), name: z.string() }),
  category: z.string(),
  zone: z.string(),
  pickup_label: z.string().nullable(),
  destination_label: z.string().nullable(),
  estimated_fare: num,
  payment_method: z.string(),
  dispatch_round: num,
  offers_sent: num,
  cancel_reason: z.string().nullable(),
  trip_id: z.uuid().nullable(),
  trip_status: z.string().nullable(),
});
export type RequestRow = z.infer<typeof requestRowSchema>;

export const requestDetailSchema = requestRowSchema.extend({
  pickup: coord.nullable(),
  destination: coord.nullable(),
  estimated_distance_m: num,
  estimated_duration_s: num,
  pickup_note: z.string().nullable(),
  expires_at: z.string(),
  version: num,
  quote: z
    .object({ breakdown: breakdownSchema.passthrough(), surge_multiplier: num, rule_version: num.nullable(), expires_at: z.string() })
    .nullable(),
  offers: z.array(
    z.object({
      id: z.uuid(),
      rank: num,
      round: num,
      driver_id: z.uuid(),
      driver_name: z.string(),
      pickup_distance_m: num,
      pickup_eta_s: num,
      offered_at: z.string(),
      responded_at: z.string().nullable(),
      response: z.string(),
      reason: z.string().nullable(),
      response_s: num.nullable(),
    }),
  ),
  events: z.array(
    z.object({
      id: num,
      from_status: z.string().nullable(),
      to_status: z.string(),
      actor_type: z.string(),
      actor_name: z.string().nullable(),
      reason: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
});
export type RequestDetail = z.infer<typeof requestDetailSchema>;

// --- Trips ---------------------------------------------------------------------

export { REQUEST_STATUSES, TRIP_TABS, type TripTab } from "@/lib/ride-constants";

export const tripRowSchema = z.object({
  id: z.uuid(),
  request_id: z.uuid(),
  status: z.string(),
  created_at: z.string(),
  accepted_at: z.string(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  cancelled_at: z.string().nullable(),
  passenger: z.object({ id: z.uuid(), name: z.string() }),
  driver: z.object({ id: z.uuid(), user_id: z.uuid(), name: z.string() }),
  vehicle: z.object({ id: z.uuid(), registration_number: z.string(), category: z.string() }),
  zone: z.string(),
  estimated_fare: num,
  final_fare: num.nullable(),
  currency: z.string(),
  distance_m: num.nullable(),
  duration_s: num.nullable(),
  payment_method: z.string(),
  cancellation_fee: num,
  cancellation_reason: z.string().nullable(),
  cancelled_by: z.string().nullable(),
  distance_source: z.string().nullable(),
  fare_review_required: z.boolean(),
  pickup_label: z.string().nullable(),
  destination_label: z.string().nullable(),
});
export type TripRow = z.infer<typeof tripRowSchema>;

export const tripDetailSchema = tripRowSchema.extend({
  version: num,
  waiting_s: num.nullable(),
  accepted_pickup_eta_s: num.nullable(),
  pickup: coord.nullable(),
  destination: coord.nullable(),
  trail: z.array(z.tuple([num, num])).nullable(),
  estimated_distance_m: num,
  estimated_duration_s: num,
  rule_version: num,
  breakdown: breakdownSchema.extend({ distance_m: num, duration_s: num, cancellation_amount: num, tax_amount: num }).nullable(),
  quote: breakdownSchema.passthrough().nullable(),
  events: z.array(
    z.object({
      id: num,
      from_status: z.string().nullable(),
      to_status: z.string(),
      actor_type: z.string(),
      actor_name: z.string().nullable(),
      reason: z.string().nullable(),
      event_data: z.record(z.string(), z.unknown()),
      created_at: z.string(),
    }),
  ),
  notes: z.array(z.object({ id: z.uuid(), body: z.string(), author: z.string(), created_at: z.string() })),
});
export type TripDetail = z.infer<typeof tripDetailSchema>;

const page = <T extends z.ZodType>(row: T) =>
  z.object({ rows: z.array(row), next_cursor: z.string().nullable().optional() });

async function call<T extends z.ZodType>(promise: PromiseLike<{ data: unknown; error: unknown }>, schema: T): Promise<z.infer<T>> {
  const { data, error } = await promise;
  if (error) throw fromPostgrestError(error as Parameters<typeof fromPostgrestError>[0]);
  return schema.parse(data);
}

const api = (ctx: AdminContext) => ctx.supabase.schema("api");

export const listFareRules = (ctx: AdminContext) => call(api(ctx).rpc("list_fare_rules"), fareRulesPayloadSchema);
export const getFareRule = (ctx: AdminContext, id: string) => call(api(ctx).rpc("get_fare_rule", { p_rule_id: id }), fareRuleSchema);
export const getOpsSnapshot = (ctx: AdminContext) => call(api(ctx).rpc("ops_live_snapshot"), opsSnapshotSchema);

export const listRequests = (ctx: AdminContext, f: { status?: string; q?: string; cursor?: string; sort?: string }) => sortFallback(f, (f) =>
  call(api(ctx).rpc("list_ride_requests", { p_status: f.status, p_search: f.q, p_cursor: f.cursor, p_limit: 50, p_sort: f.sort }), page(requestRowSchema)));
export const getRequest = (ctx: AdminContext, id: string) => call(api(ctx).rpc("get_ride_request", { p_request_id: id }), requestDetailSchema);

export const listTrips = (ctx: AdminContext, f: { status?: string; q?: string; flagged?: boolean; cursor?: string; sort?: string }) => sortFallback(f, (f) =>
  call(
    api(ctx).rpc("list_trips", { p_status: f.status, p_search: f.q, p_flagged: f.flagged ?? false, p_cursor: f.cursor, p_limit: 50, p_sort: f.sort }),
    page(tripRowSchema).extend({ counts: z.object({ active: num, flagged: num }) }),
  ));
export const getTrip = (ctx: AdminContext, id: string) => call(api(ctx).rpc("get_trip", { p_trip_id: id }), tripDetailSchema);
