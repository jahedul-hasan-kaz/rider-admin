import { APP_TIME_ZONE } from "@/lib/format";

// Dashboard and analytics ranges are inclusive Asia/Dhaka calendar days, kept in the URL as ?range=…&from=…&to=….

export const RANGE_PRESETS = ["today", "7d", "30d", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today in Dhaka as YYYY-MM-DD. */
export function dhakaToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export type ResolvedRange = { preset: RangePreset; from: string; to: string };

/** Turns URL params into a valid range (never more than 366 days); anything malformed falls back to the last 7 days. */
export function resolveRange(params: Record<string, string | string[] | undefined>, now = new Date()): ResolvedRange {
  const today = dhakaToday(now);
  const preset = RANGE_PRESETS.find((p) => p === one(params.range)) ?? "7d";
  if (preset === "today") return { preset, from: today, to: today };
  if (preset === "30d") return { preset, from: addDays(today, -29), to: today };
  if (preset === "custom") {
    const from = one(params.from);
    const to = one(params.to);
    if (from && to && ISO_DATE.test(from) && ISO_DATE.test(to) && from <= to && addDays(from, 365) >= to) return { preset, from, to };
  }
  return { preset: "7d", from: addDays(today, -6), to: today };
}

export const uuidOrUndefined = (v: string | string[] | undefined) =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : undefined;
