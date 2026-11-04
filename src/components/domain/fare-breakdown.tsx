"use client";

import { useTranslations } from "next-intl";
import { Money } from "@/components/domain/money";
import { cn } from "@/lib/utils";
import type { FareBreakdownData } from "@/server/queries/rides";

type Row = { key: string; label: string; value: number; sign?: "-" };

function DiffCell({ active, value, before }: { active: boolean; value: number; before: number }) {
  if (!active) return null;
  const d = Math.round((value - before) * 100) / 100;
  return (
    <span className={cn("w-20 text-right text-xs tabular", d > 0 && "text-warning", d < 0 && "text-success", d === 0 && "text-muted-foreground")}>
      {d === 0 ? "—" : `${d > 0 ? "+" : ""}${d.toFixed(2)}`}
    </span>
  );
}

/** Itemised fare (quotes, trips, simulator). Zero rows are hidden except the core ones. */
export function FareBreakdown({
  data,
  compare,
  showSplit = true,
}: {
  data: FareBreakdownData;
  /** Optional second breakdown: shows the difference per line (simulator vs live rule). */
  compare?: FareBreakdownData | null;
  showSplit?: boolean;
}) {
  const t = useTranslations("fare");
  const lines: Row[] = [
    { key: "base", label: t("base"), value: data.base_amount },
    { key: "distance", label: t("distance"), value: data.distance_amount },
    { key: "time", label: t("time"), value: data.time_amount },
    { key: "surge", label: t("surge"), value: data.surge_amount },
    { key: "waiting", label: t("waiting"), value: data.waiting_amount },
    { key: "min", label: t("minimumAdjustment"), value: data.minimum_adjustment },
    { key: "round", label: t("rounding"), value: data.rounding_amount },
    { key: "booking", label: t("bookingFee"), value: data.booking_fee },
    { key: "discount", label: t("discount"), value: data.discount_amount, sign: "-" as const },
  ].filter((r) => r.value !== 0 || ["base", "distance", "time"].includes(r.key));

  const other: Record<string, number> = compare
    ? {
        base: compare.base_amount,
        distance: compare.distance_amount,
        time: compare.time_amount,
        surge: compare.surge_amount,
        waiting: compare.waiting_amount,
        min: compare.minimum_adjustment,
        round: compare.rounding_amount,
        booking: compare.booking_fee,
        discount: compare.discount_amount,
        total: compare.total_amount,
      }
    : {};

  return (
    <dl className="space-y-1.5 text-sm">
      {lines.map((r) => (
        <div key={r.key} className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{r.label}</dt>
          <dd className="flex items-center gap-3">
            <Money value={r.sign === "-" ? -r.value : r.value} />
            <DiffCell active={Boolean(compare)} value={r.value} before={other[r.key] ?? 0} />
          </dd>
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 border-t pt-2 font-semibold">
        <dt>{t("total")}</dt>
        <dd className="flex items-center gap-3">
          <Money value={data.total_amount} />
          <DiffCell active={Boolean(compare)} value={data.total_amount} before={other.total ?? 0} />
        </dd>
      </div>
      {showSplit ? (
        <div className="space-y-1 rounded-md bg-muted/50 p-2 text-xs">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">
              {t("commission")} ({(data.commission_pct * 100).toFixed(1)}%)
            </dt>
            <dd>
              <Money value={data.platform_commission} />
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t("driverEarning")}</dt>
            <dd>
              <Money value={data.driver_earning} />
            </dd>
          </div>
        </div>
      ) : null}
    </dl>
  );
}
