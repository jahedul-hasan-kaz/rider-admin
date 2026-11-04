import { TZDate } from "@date-fns/tz";
import { format, formatDistanceToNowStrict } from "date-fns";
import { bn, enGB } from "date-fns/locale";

// Display rules from docs/spec/06-admin-ui.md §2: Asia/Dhaka, "02 Nov 2026, 14:05".
export const APP_TIME_ZONE = "Asia/Dhaka";

const dateLocale = (locale: string) => (locale === "bn" ? bn : enGB);

export function formatDateTime(value: string | Date | null | undefined, locale = "en"): string {
  if (!value) return "";
  return format(new TZDate(new Date(value), APP_TIME_ZONE), "dd MMM yyyy, HH:mm", { locale: dateLocale(locale) });
}

export function formatDate(value: string | Date | null | undefined, locale = "en"): string {
  if (!value) return "";
  return format(new TZDate(new Date(value), APP_TIME_ZONE), "dd MMM yyyy", { locale: dateLocale(locale) });
}

export function formatRelative(value: string | Date | null | undefined, locale = "en"): string {
  if (!value) return "";
  return formatDistanceToNowStrict(new Date(value), { addSuffix: true, locale: dateLocale(locale) });
}

/** Full UTC timestamp for tooltips, so support can match server logs. */
export function formatUtc(value: string | Date | null | undefined): string {
  if (!value) return "";
  return new Date(value).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** ৳1,250.00 (tabular numerals in the UI; arithmetic never happens in JS, only formatting). */
export function formatMoney(value: number | string | null | undefined, locale = "en"): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return `৳${n.toLocaleString(locale === "bn" ? "bn-BD" : "en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 3.4 km (or 850 m under 1 km). */
export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return "—";
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

/** 12 min 30 s */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  if (h > 0) return `${h} h ${m} min`;
  return rest ? `${m} min ${rest} s` : `${m} min`;
}
