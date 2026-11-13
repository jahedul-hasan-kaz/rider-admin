import "server-only";
import { z } from "zod";
import type { AdminContext } from "@/server/auth/context";
import { api, call, num } from "@/server/queries/rpc";

// Typed readers for the M4 dashboard, analytics, alerts, exports, settings and flags RPCs.

const nn = num.nullable();

export const cardsSchema = z.object({
  completed_trips: num,
  requests: num,
  match_rate: nn,
  match_p50_s: nn,
  match_p90_s: nn,
  gross_bookings: num,
  platform_revenue: num,
  discounts: num,
  contribution: num,
  contribution_per_ride: nn,
  contribution_subsidised: nn,
  contribution_unsubsidised: nn,
});

export const dashboardSchema = z.object({
  range: z.object({ from: z.string(), to: z.string() }),
  current: cardsSchema,
  previous: cardsSchema,
  delta: z.object({
    completed_trips: nn,
    match_rate: nn,
    gross_bookings: nn,
    platform_revenue: nn,
    contribution_per_ride: nn,
  }),
  funnel: z.object({ requests: num, matched: num, started: num, completed: num }),
  cancellations: z.object({ passenger: num, driver: num, admin: num, no_driver: num, failed: num }),
  days: z.array(z.object({ day: z.string(), completed_trips: num, gross_bookings: num, requests: num, matched: num })),
  intraday: z.array(z.object({ at: z.string(), requests: num, matched: num, completed: num })),
  zones: z.array(
    z.object({
      zone_id: z.uuid(),
      name: z.string(),
      requests: num,
      matched: num,
      match_rate: nn,
      median_match_s: nn,
      online_drivers: num,
      health: z.enum(["good", "watch", "bad", "idle"]),
    }),
  ),
  attention: z.object({
    documents_pending: num,
    documents_expiring: num,
    refunds_waiting: num,
    tickets_breaching: num,
    incidents_open: num,
    fare_flags: num,
    cash_mismatches: num,
    alerts_open: num,
  }),
  online_drivers_now: num,
  generated_at: z.string(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

export type AnalyticsPage = "funnel" | "economics" | "drivers" | "passengers" | "finance";
export const ANALYTICS_PAGES: AnalyticsPage[] = ["funnel", "economics", "drivers", "passengers", "finance"];

const totalsSchema = z.object({
  requests: num,
  matched: num,
  started: num,
  completed_requests: num,
  cancelled_passenger: num,
  cancelled_driver: num,
  cancelled_admin: num,
  no_driver: num,
  failed: num,
  completed_trips: num,
  gross_bookings: num,
  platform_revenue: num,
  discounts: num,
  contribution: num,
  driver_earnings: num,
  distance_m: num,
  duration_s: num,
  flagged_fares: num,
});
const matchSchema = z.object({ p50: nn, p90: nn });

export const funnelSchema = z.object({
  totals: totalsSchema,
  match: matchSchema,
  by_zone: z.array(z.object({ zone: z.string(), requests: num, matched: num, completed: num, no_driver: num })),
  by_category: z.array(z.object({ category: z.string(), requests: num, matched: num, completed: num })),
});
export const economicsSchema = z.object({
  totals: totalsSchema,
  detail: z.object({
    subsidised: z.object({ trips: num, revenue: num, discounts: num, contribution: num }),
    unsubsidised: z.object({ trips: num, revenue: num, contribution: num }),
    avg_fare: nn,
    median_fare: nn,
    avg_distance_km: nn,
    avg_duration_min: nn,
    commission_share_pct: nn,
  }),
  days: z.array(z.object({ day: z.string(), gross: num, revenue: num, discounts: num, contribution: num })),
});
export const driversSchema = z.object({
  totals: totalsSchema,
  active_drivers: num,
  newly_approved: num,
  drivers: z.array(
    z.object({ driver_id: z.uuid(), name: z.string().nullable(), trips: num, earnings: num, rating: nn, acceptance_pct: nn, cancelled: num }),
  ),
});
export const passengersSchema = z.object({
  totals: totalsSchema,
  match_buckets: z.object({ lt30: num, lt60: num, lt120: num, gte120: num }),
  match: matchSchema,
  ratings: z.object({ "1": num, "2": num, "3": num, "4": num, "5": num, avg: nn }),
  tickets: num,
  repeat_riders_pct: nn,
});
export const financeSchema = z.object({
  totals: totalsSchema,
  refunds: z.object({ count: num, amount: num }),
  payments: z.object({ pending: num, unreconciled: num, mismatches: num }),
  cash_owed_by_drivers: num,
  payouts: z.object({ paid: num, failed: num, total: num }),
  ledger: z.object({ ran_at: z.string(), ok: z.boolean() }).nullable(),
  flagged_fares: num,
});

export const alertSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  severity: z.enum(["info", "warning", "critical"]),
  title: z.string(),
  detail: z.record(z.string(), z.unknown()),
  status: z.enum(["open", "resolved"]),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  resolved_at: z.string().nullable(),
  acknowledged_by_name: z.string().nullable(),
  acknowledged_at: z.string().nullable(),
  ack_note: z.string().nullable(),
});
export type OpsAlert = z.infer<typeof alertSchema>;

export const exportJobSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  params: z.object({ from: z.string(), to: z.string() }),
  status: z.enum(["queued", "running", "ready", "failed", "expired"]),
  row_count: nn,
  byte_size: nn,
  error: z.string().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
  expires_at: z.string().nullable(),
});
export type ExportJob = z.infer<typeof exportJobSchema>;

export const settingSchema = z.object({
  key: z.string(),
  value: z.unknown(),
  description: z.string().nullable(),
  schema: z
    .object({
      group: z.string().optional(),
      type: z.string(),
      min: num.optional(),
      max: num.optional(),
      unit: z.string().optional(),
      editable: z.boolean().optional(),
      values: z.array(z.string()).optional(),
      default: z.unknown().optional(),
    })
    .nullable(),
  version: num,
  updated_at: z.string(),
  updated_by_name: z.string().nullable(),
  is_default: z.boolean().nullable(),
});
export type Setting = z.infer<typeof settingSchema>;

export const flagSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
  rules: z.object({ zone_ids: z.array(z.string()).optional(), category_ids: z.array(z.string()).optional(), percentage: num.optional() }),
  description: z.string().nullable(),
  version: num,
  updated_at: z.string(),
  updated_by_name: z.string().nullable(),
});
export type FeatureFlag = z.infer<typeof flagSchema>;

export const settingHistorySchema = z.array(
  z.object({ at: z.string(), admin: z.string().nullable(), before: z.unknown(), after: z.unknown(), reason: z.string().nullable() }),
);

export const archiveRunSchema = z.object({
  id: num,
  kind: z.string(),
  source: z.string(),
  partition: z.string().nullable(),
  range_from: z.string().nullable(),
  range_to: z.string().nullable(),
  row_count: num,
  checksum: z.string().nullable(),
  ran_at: z.string(),
  exported: z.boolean(),
  file_sha256: z.string().nullable(),
  file_bytes: num.nullable(),
});
export type ArchiveRun = z.infer<typeof archiveRunSchema>;

type Filters = { from: string; to: string; zone?: string; category?: string };

export const getDashboard = (ctx: AdminContext, f: Filters) =>
  call(api(ctx).rpc("dashboard", { p_from: f.from, p_to: f.to, p_zone: f.zone, p_category: f.category }), dashboardSchema);

const analytics = <S extends z.ZodType>(ctx: AdminContext, page: AnalyticsPage, f: Filters, schema: S): Promise<z.infer<S>> =>
  call(api(ctx).rpc("analytics", { p_page: page, p_from: f.from, p_to: f.to, p_zone: f.zone, p_category: f.category }), schema);

export const getFunnel = (ctx: AdminContext, f: Filters) => analytics(ctx, "funnel", f, funnelSchema);
export const getEconomics = (ctx: AdminContext, f: Filters) => analytics(ctx, "economics", f, economicsSchema);
export const getDrivers = (ctx: AdminContext, f: Filters) => analytics(ctx, "drivers", f, driversSchema);
export const getPassengers = (ctx: AdminContext, f: Filters) => analytics(ctx, "passengers", f, passengersSchema);
export const getFinance = (ctx: AdminContext, f: Filters) => analytics(ctx, "finance", f, financeSchema);

export const listAlerts = (ctx: AdminContext, status: "open" | "resolved") => call(api(ctx).rpc("list_alerts", { p_status: status }), z.array(alertSchema));
export const listExports = (ctx: AdminContext) => call(api(ctx).rpc("list_exports"), z.array(exportJobSchema));
export const listSettings = (ctx: AdminContext) => call(api(ctx).rpc("list_settings"), z.array(settingSchema));
export const listFlags = (ctx: AdminContext) => call(api(ctx).rpc("list_flags"), z.array(flagSchema));
export const getSettingHistory = (ctx: AdminContext, key: string) => call(api(ctx).rpc("setting_history", { p_key: key }), settingHistorySchema);
export const listArchiveRuns = (ctx: AdminContext) => call(api(ctx).rpc("list_archive_runs"), z.array(archiveRunSchema));

export const filterRefsSchema = z.object({
  zones: z.array(z.object({ id: z.uuid(), name: z.string() })),
  categories: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export const getFilterRefs = (ctx: AdminContext) => call(api(ctx).rpc("insight_filters"), filterRefsSchema);

export const supplySchema = z.array(z.object({ at: z.string(), online: num, on_trip: num }));
export const getIntradaySupply = (ctx: AdminContext) => call(api(ctx).rpc("intraday_supply"), supplySchema);

export const outboxOverviewSchema = z.object({
  counts: z.array(z.object({ channel: z.string(), status: z.string(), count: num })),
  recent_failures: z.array(
    z.object({ id: z.uuid(), channel: z.string(), subject: z.string(), error: z.string().nullable(), attempts: num, created_at: z.string() }),
  ),
  queued: num,
});
export type OutboxOverview = z.infer<typeof outboxOverviewSchema>;
export const getOutboxOverview = (ctx: AdminContext) => call(api(ctx).rpc("outbox_overview"), outboxOverviewSchema);

export const surgeSchema = z.object({
  enabled: z.boolean().nullable(),
  rows: z.array(
    z.object({ zone: z.string(), category: z.string(), auto: num, manual: num, effective: num, demand: num, supply: num, computed_at: z.string() }),
  ),
});
export type SurgeOverview = z.infer<typeof surgeSchema>;
export const getSurgeOverview = (ctx: AdminContext) => call(api(ctx).rpc("surge_overview"), surgeSchema);

/** Zones and vehicle types for create/edit forms; empty when the admin cannot read them (the form then hides the field). */
export const getFormRefs = (ctx: AdminContext) => getFilterRefs(ctx).catch(() => ({ zones: [], categories: [] }));
