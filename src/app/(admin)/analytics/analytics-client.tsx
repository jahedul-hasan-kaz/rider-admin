"use client";

import { useLocale, useTranslations } from "next-intl";
import { BarChart, FunnelBars, ShareBars } from "@/components/charts/charts";
import { DateTime } from "@/components/domain/date-time";
import { KpiHelp } from "@/components/domain/kpi-help";
import { Money } from "@/components/domain/money";
import { Stat, StatGrid } from "@/components/domain/stat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration, formatMoney } from "@/lib/format";
import type { z } from "zod";
import type { driversSchema, economicsSchema, financeSchema, funnelSchema, passengersSchema } from "@/server/queries/insight";

function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1 text-base">
          {title}
          {help ? <KpiHelp title={title}>{help}</KpiHelp> : null}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Labelled({ label, help, children, hint, tone }: { label: string; help: string; children: React.ReactNode; hint?: React.ReactNode; tone?: "danger" | "warning" | "success" }) {
  return (
    <Stat label={label} hint={hint} tone={tone} help={help}>
      {children}
    </Stat>
  );
}

const pct = (n: number | null) => (n === null ? "—" : `${n}%`);

export function FunnelView({ data }: { data: z.infer<typeof funnelSchema> }) {
  const t = useTranslations("analytics");
  const d = useTranslations("dashboard");
  const tot = data.totals;
  const rate = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : "—");
  return (
    <div className="space-y-4">
      <StatGrid>
        <Labelled label={t("matchRate")} help={t("def_matchRate")}>{rate(tot.matched, tot.requests)}</Labelled>
        <Labelled label={t("completionRate")} help={t("def_completionRate")}>{rate(tot.completed_requests, tot.requests)}</Labelled>
        <Labelled label={t("noDriverRate")} help={t("def_noDriverRate")} tone={tot.no_driver > 0 ? "warning" : undefined}>{rate(tot.no_driver, tot.requests)}</Labelled>
        <Labelled label={t("matchTime")} help={t("def_matchTime")} hint={data.match.p90 === null ? undefined : d("p90", { value: formatDuration(data.match.p90) })}>
          {data.match.p50 === null ? "—" : formatDuration(data.match.p50)}
        </Labelled>
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={d("funnel")} help={d("helpFunnel")}>
          {tot.requests === 0 ? (
            <p className="text-sm text-muted-foreground">{d("noRequests")}</p>
          ) : (
            <FunnelBars
              dropLabel={(p) => d("dropOff", { pct: p })}
              steps={[
                { label: d("stepRequests"), value: tot.requests },
                { label: d("stepMatched"), value: tot.matched },
                { label: d("stepStarted"), value: tot.started },
                { label: d("stepCompleted"), value: tot.completed_requests },
              ]}
            />
          )}
        </Section>
        <Section title={d("whyRidesEnd")} help={d("helpCancellations")}>
          <ShareBars
            items={[
              { label: d("cancelPassenger"), value: tot.cancelled_passenger, className: "bg-warning" },
              { label: d("cancelDriver"), value: tot.cancelled_driver, className: "bg-danger" },
              { label: d("cancelAdmin"), value: tot.cancelled_admin, className: "bg-info" },
              { label: d("noDriver"), value: tot.no_driver, className: "bg-neutral" },
              { label: d("failed"), value: tot.failed, className: "bg-danger" },
            ]}
          />
        </Section>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("byZone")}>
          <SimpleTable
            head={[t("zone"), d("colRequests"), t("matched"), t("completed"), d("noDriver")]}
            rows={data.by_zone.map((z) => [z.zone, z.requests, z.matched, z.completed, z.no_driver])}
            empty={d("noZones")}
          />
        </Section>
        <Section title={t("byCategory")}>
          <SimpleTable head={[t("category"), d("colRequests"), t("matched"), t("completed")]} rows={data.by_category.map((c) => [c.category, c.requests, c.matched, c.completed])} empty={d("noRequests")} />
        </Section>
      </div>
    </div>
  );
}

export function EconomicsView({ data }: { data: z.infer<typeof economicsSchema> }) {
  const t = useTranslations("analytics");
  const locale = useLocale();
  const tot = data.totals;
  const dt = data.detail;
  const perRide = tot.completed_trips > 0 ? tot.contribution / tot.completed_trips : null;
  return (
    <div className="space-y-4">
      <StatGrid>
        <Labelled label={t("gross")} help={t("def_gross")}>{tot.gross_bookings.toLocaleString()}</Labelled>
        <Labelled label={t("revenue")} help={t("def_revenue")} hint={dt.commission_share_pct === null ? undefined : t("commissionShare", { pct: dt.commission_share_pct })}>
          {tot.platform_revenue.toLocaleString()}
        </Labelled>
        <Labelled label={t("discounts")} help={t("def_discounts")}>{tot.discounts.toLocaleString()}</Labelled>
        <Labelled label={t("contributionPerRide")} help={t("def_contribution")} tone={perRide !== null && perRide < 0 ? "danger" : undefined}>
          {perRide === null ? "—" : perRide.toFixed(2)}
        </Labelled>
      </StatGrid>
      <StatGrid>
        <Labelled label={t("avgFare")} help={t("def_avgFare")} hint={dt.median_fare === null ? undefined : t("median", { value: formatMoney(dt.median_fare, locale) })}>
          {dt.avg_fare === null ? "—" : formatMoney(dt.avg_fare, locale)}
        </Labelled>
        <Labelled label={t("avgDistance")} help={t("def_avgDistance")}>{dt.avg_distance_km === null ? "—" : `${dt.avg_distance_km} km`}</Labelled>
        <Labelled label={t("avgDuration")} help={t("def_avgDuration")}>{dt.avg_duration_min === null ? "—" : `${dt.avg_duration_min} min`}</Labelled>
        <Labelled label={t("driverPayEarned")} help={t("def_driverEarnings")}>{tot.driver_earnings.toLocaleString()}</Labelled>
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("dailyMoney")} help={t("def_dailyMoney")}>
          {data.days.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noData")}</p>
          ) : (
            <BarChart
              ariaLabel={t("dailyMoneyAria")}
              labels={data.days.map((x) => x.day.slice(5))}
              series={[
                { name: t("revenue"), values: data.days.map((x) => x.revenue), className: "fill-primary" },
                { name: t("discounts"), values: data.days.map((x) => x.discounts), className: "fill-warning" },
              ]}
            />
          )}
        </Section>
        <Section title={t("subsidy")} help={t("def_subsidy")}>
          <SimpleTable
            head={["", t("trips"), t("revenue"), t("contribution")]}
            rows={[
              [t("withPromo"), dt.subsidised.trips, dt.subsidised.revenue, dt.subsidised.contribution],
              [t("withoutPromo"), dt.unsubsidised.trips, dt.unsubsidised.revenue, dt.unsubsidised.contribution],
            ]}
            empty={t("noData")}
          />
          <p className="mt-3 text-xs text-muted-foreground">{t("subsidyNote")}</p>
        </Section>
      </div>
    </div>
  );
}

export function DriversView({ data }: { data: z.infer<typeof driversSchema> }) {
  const t = useTranslations("analytics");
  const tot = data.totals;
  const perDriver = data.active_drivers > 0 ? tot.completed_trips / data.active_drivers : null;
  return (
    <div className="space-y-4">
      <StatGrid>
        <Labelled label={t("activeDrivers")} help={t("def_activeDrivers")}>{data.active_drivers}</Labelled>
        <Labelled label={t("newDrivers")} help={t("def_newDrivers")}>{data.newly_approved}</Labelled>
        <Labelled label={t("tripsPerDriver")} help={t("def_tripsPerDriver")}>{perDriver === null ? "—" : perDriver.toFixed(1)}</Labelled>
        <Labelled label={t("driverCancels")} help={t("def_driverCancels")} tone={tot.cancelled_driver > 0 ? "warning" : undefined}>{tot.cancelled_driver}</Labelled>
      </StatGrid>
      <Section title={t("driverTable")} help={t("def_driverTable")}>
        <SimpleTable
          head={[t("driver"), t("trips"), t("earnings"), t("acceptance"), t("cancelled"), t("rating")]}
          rows={data.drivers.map((d) => [d.name ?? "—", d.trips, d.earnings, d.acceptance_pct === null ? "—" : `${d.acceptance_pct}%`, d.cancelled, d.rating ?? "—"])}
          empty={t("noData")}
        />
      </Section>
    </div>
  );
}

export function PassengersView({ data }: { data: z.infer<typeof passengersSchema> }) {
  const t = useTranslations("analytics");
  const d = useTranslations("dashboard");
  const mb = data.match_buckets;
  const r = data.ratings;
  const rides = data.totals.completed_trips;
  return (
    <div className="space-y-4">
      <StatGrid>
        <Labelled label={t("matchTime")} help={t("def_matchTime")} hint={data.match.p90 === null ? undefined : d("p90", { value: formatDuration(data.match.p90) })}>
          {data.match.p50 === null ? "—" : formatDuration(data.match.p50)}
        </Labelled>
        <Labelled label={t("repeatRiders")} help={t("def_repeatRiders")}>{pct(data.repeat_riders_pct)}</Labelled>
        <Labelled label={t("ticketsPer100")} help={t("def_ticketsPer100")}>{rides > 0 ? ((data.tickets / rides) * 100).toFixed(1) : "—"}</Labelled>
        <Labelled label={t("avgRating")} help={t("def_avgRating")}>{r.avg === null ? "—" : r.avg}</Labelled>
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("waitDistribution")} help={t("def_waitDistribution")}>
          <ShareBars
            items={[
              { label: t("under30"), value: mb.lt30, className: "bg-success" },
              { label: t("s30to60"), value: mb.lt60 },
              { label: t("s60to120"), value: mb.lt120, className: "bg-warning" },
              { label: t("over120"), value: mb.gte120, className: "bg-danger" },
            ]}
          />
        </Section>
        <Section title={t("ratingDistribution")}>
          <ShareBars
            items={[5, 4, 3, 2, 1].map((n) => ({ label: `${n} ★`, value: r[String(n) as "1"], className: n <= 2 ? "bg-danger" : n === 3 ? "bg-warning" : "bg-success" }))}
          />
        </Section>
      </div>
    </div>
  );
}

export function FinanceView({ data }: { data: z.infer<typeof financeSchema> }) {
  const t = useTranslations("analytics");
  const payoutRate = data.payouts.total > 0 ? Math.round((data.payouts.failed / data.payouts.total) * 1000) / 10 : null;
  return (
    <div className="space-y-4">
      <StatGrid>
        <Labelled label={t("refundsDone")} help={t("def_refunds")} hint={t("refundCount", { count: data.refunds.count })}>{data.refunds.amount.toLocaleString()}</Labelled>
        <Labelled label={t("cashOwed")} help={t("def_cashOwed")} tone={data.cash_owed_by_drivers > 0 ? "danger" : undefined}>{data.cash_owed_by_drivers.toLocaleString()}</Labelled>
        <Labelled label={t("payoutFailure")} help={t("def_payoutFailure")} tone={payoutRate !== null && payoutRate > 2 ? "danger" : undefined} hint={t("payoutCounts", { failed: data.payouts.failed, total: data.payouts.total })}>
          {pct(payoutRate)}
        </Labelled>
        <Labelled label={t("flaggedFares")} help={t("def_flaggedFares")} tone={data.flagged_fares > 0 ? "warning" : undefined}>{data.flagged_fares}</Labelled>
      </StatGrid>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("paymentHealth")} help={t("def_paymentHealth")}>
          <ShareBars
            total={Math.max(data.payments.pending + data.payments.unreconciled + data.payments.mismatches, 1)}
            items={[
              { label: t("pendingCash"), value: data.payments.pending, className: "bg-warning" },
              { label: t("unreconciled"), value: data.payments.unreconciled, className: "bg-info" },
              { label: t("mismatches"), value: data.payments.mismatches, className: "bg-danger" },
            ]}
          />
        </Section>
        <Section title={t("ledgerHealth")} help={t("def_ledgerHealth")}>
          {data.ledger ? (
            <p className="text-sm">
              <span className={data.ledger.ok ? "font-medium text-success" : "font-medium text-danger"}>{data.ledger.ok ? t("ledgerOk") : t("ledgerBad")}</span>
              {" · "}
              <DateTime value={data.ledger.ran_at} relative />
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t("ledgerNever")}</p>
          )}
          <p className="mt-3 text-sm text-muted-foreground">
            {t("revenueShort")}: <Money value={data.totals.platform_revenue} />
          </p>
        </Section>
      </div>
    </div>
  );
}

function SimpleTable({ head, rows, empty }: { head: string[]; rows: (string | number)[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            {head.map((h, i) => (
              <th key={i} className="py-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t">
              {row.map((cell, j) => (
                <td key={j} className={j === 0 ? "py-2 pr-4 font-medium" : "py-2 pr-4 tabular"}>
                  {typeof cell === "number" ? cell.toLocaleString() : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
