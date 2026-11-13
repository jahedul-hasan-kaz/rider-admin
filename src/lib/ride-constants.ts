// Plain constants shared by server queries and client components (the queries module is server-only).

export const REQUEST_STATUSES = [
  "searching",
  "matched",
  "completed",
  "no_driver_found",
  "cancelled_by_passenger",
  "cancelled_by_driver",
  "cancelled_by_admin",
  "failed",
] as const;

export const TRIP_TABS = ["all", "active", "completed", "cancelled", "flagged"] as const;
export type TripTab = (typeof TRIP_TABS)[number];
