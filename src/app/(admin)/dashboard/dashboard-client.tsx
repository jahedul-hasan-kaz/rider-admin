"use client";

import { ArrowDownRight, ArrowUpRight, FileCheck2, MapPinOff, FileClock, LifeBuoy, Minus, ReceiptText, ShieldAlert, Siren, TriangleAlert, Wallet } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { BarChart, FunnelBars, ShareBars, Sparkline } from "@/components/charts/charts";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { KpiHelp } from "@/components/domain/kpi-help";
import { Money } from "@/components/domain/money";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Dashboard, SurgeOverview } from "@/server/queries/insight";

/** "+12.5%" with an arrow, coloured by whether the change is good. `invert` is for metrics where lower is better. */
function Delta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  const t = useTranslations("dashboard");
  if (value === null) return <span className="text-xs text-muted-foreground">{t("noPrevious")}</span>;
  if (value === 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="size-3" aria-hidden />0%
      </span>
    );
  }
  const good = invert ? value < 0 : value > 0;
  const Icon = value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", good ? "text-success" : "text-danger")}>
      <Icon className="size-3.5" aria-hidden />
      {Math.abs(value)}%<span className="sr-only">{value > 0 ? t("up") : t("down")}</span>
    </span>
  );
}

function KpiCard({ label, help, value, delta, spark, sparkLabel, hint }: { label: string; help: string; value: React.ReactNode; delta?: number | null; spark?: number[]; sparkLabel?: string; hint?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {label}
          <KpiHelp title={label}>{help}</KpiHelp>
        </div>
        <div className="flex items-end justify-between gap-2">
          <p className="text-2xl font-semibold tracking-tight tabular">{value}</p>
          {spark ? <Sparkline values={spark} label={sparkLabel ?? label} /> : null}
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          {delta !== undefined ? <Delta value={delta} /> : <span />}
          {hint ? <span className="text-right">{hint}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function KpiCards({ data }: { data: Dashboard }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const c = data.current;
  const days = data.days;
  return (
    <section aria-label={t("kpis")} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <KpiCard
        label={t("kpiRides")}
        help={t("helpRides")}
        value={c.completed_trips.toLocaleString()}
        delta={data.delta.completed_trips}
        spark={days.map((d) => d.completed_trips)}
        hint={t("kpiRidesHint", { requests: c.requests })}
      />
      <KpiCard
        label={t("kpiMatchRate")}
        help={t("helpMatchRate")}
        value={c.match_rate === null ? "—" : `${c.match_rate}%`}
        delta={data.delta.match_rate}
        spark={days.map((d) => (d.requests > 0 ? (d.matched / d.requests) * 100 : 0))}
      />
      <KpiCard
        label={t("kpiMatchTime")}
        help={t("helpMatchTime")}
        value={c.match_p50_s === null ? "—" : formatDuration(c.match_p50_s)}
        hint={c.match_p90_s === null ? undefined : t("p90", { value: formatDuration(c.match_p90_s) })}
      />
      <KpiCard
        label={t("kpiGross")}
        help={t("helpGross")}
        value={<Money value={c.gross_bookings} />}
        delta={data.delta.gross_bookings}
        spark={days.map((d) => d.gross_bookings)}
      />
      <KpiCard
        label={t("kpiRevenue")}
        help={t("helpRevenue")}
        value={<Money value={c.platform_revenue} />}
        delta={data.delta.platform_revenue}
        hint={t("discountsGiven", { value: formatMoney(c.discounts, locale) })}
      />
      <KpiCard
        label={t("kpiContribution")}
        help={t("helpContribution")}
        value={c.contribution_per_ride === null ? "—" : <Money value={c.contribution_per_ride} />}
        delta={data.delta.contribution_per_ride}
        hint={
          c.contribution_subsidised !== null || c.contribution_unsubsidised !== null
            ? t("subsidySplit", {
                with: c.contribution_subsidised === null ? "—" : formatMoney(c.contribution_subsidised, locale),
                without: c.contribution_unsubsidised === null ? "—" : formatMoney(c.contribution_unsubsidised, locale),
              })
            : undefined
        }
      />
    </section>
  );
}

export function FunnelCard({ data }: { data: Dashboard }) {
  const t = useTranslations("dashboard");
  const f = data.funnel;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1 text-base">
          {t("funnel")}
          <KpiHelp title={t("funnel")}>{t("helpFunnel")}</KpiHelp>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {f.requests === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noRequests")}</p>
        ) : (
          <FunnelBars
            dropLabel={(pct) => t("dropOff", { pct })}
            steps={[
              { label: t("stepRequests"), value: f.requests },
              { label: t("stepMatched"), value: f.matched },
              { label: t("stepStarted"), value: f.started },
              { label: t("stepCompleted"), value: f.completed },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function CancellationsCard({ data }: { data: Dashboard }) {
  const t = useTranslations("dashboard");
  const c = data.cancellations;
  const items = [
    { label: t("cancelPassenger"), value: c.passenger, className: "bg-warning" },
    { label: t("cancelDriver"), value: c.driver, className: "bg-danger" },
    { label: t("cancelAdmin"), value: c.admin, className: "bg-info" },
    { label: t("noDriver"), value: c.no_driver, className: "bg-neutral" },
    { label: t("failed"), value: c.failed, className: "bg-danger" },
  ];
  const total = items.reduce((s, i) => s + i.value, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1 text-base">
          {t("whyRidesEnd")}
          <KpiHelp title={t("whyRidesEnd")}>{t("helpCancellations")}</KpiHelp>
        </CardTitle>
      </CardHeader>
      <CardContent>{total === 0 ? <p className="text-sm text-muted-foreground">{t("nothingLost")}</p> : <ShareBars items={items} />}</CardContent>
    </Card>
  );
}

export function IntradayCard({ data }: { data: Dashboard }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const rows = data.intraday;
  const label = (iso: string) =>
    new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Dhaka" }).format(new Date(iso));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-1">
            {t("intraday")}
            <KpiHelp title={t("intraday")}>{t("helpIntraday")}</KpiHelp>
          </span>
          <span className="text-xs font-normal text-muted-foreground">{t("onlineNow", { count: data.online_drivers_now })}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noRecentRequests")}</p>
        ) : (
          <BarChart
            ariaLabel={t("intradayAria")}
            labels={rows.map((r) => label(r.at))}
            series={[
              { name: t("stepRequests"), values: rows.map((r) => r.requests), className: "fill-primary/40" },
              { name: t("stepMatched"), values: rows.map((r) => r.matched), className: "fill-primary" },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}

const ATTENTION: { key: keyof Dashboard["attention"]; icon: typeof FileClock; href: string; tone?: "danger" }[] = [
  { key: "incidents_open", icon: ShieldAlert, href: "/safety", tone: "danger" },
  { key: "alerts_open", icon: Siren, href: "/alerts", tone: "danger" },
  { key: "tickets_breaching", icon: LifeBuoy, href: "/support?tab=breached" },
  { key: "refunds_waiting", icon: ReceiptText, href: "/refunds" },
  { key: "documents_pending", icon: FileClock, href: "/documents" },
  { key: "documents_expiring", icon: FileCheck2, href: "/documents" },
  { key: "fare_flags", icon: TriangleAlert, href: "/trips?tab=flagged" },
  { key: "cash_mismatches", icon: Wallet, href: "/payments?tab=unreconciled" },
];

export function AttentionPanel({ data }: { data: Dashboard }) {
  const t = useTranslations("dashboard");
  const items = ATTENTION.filter((a) => data.attention[a.key] > 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("attention")}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("allClear")}</p>
        ) : (
          <ul className="space-y-1">
            {items.map((a) => (
              <li key={a.key}>
                <Link href={a.href as Route} className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                  <a.icon className={cn("size-4 shrink-0", a.tone === "danger" ? "text-danger" : "text-warning")} aria-hidden />
                  <span className="flex-1">{t(`attn_${a.key}`)}</span>
                  <span className={cn("rounded-full px-2 text-xs font-medium tabular", a.tone === "danger" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>
                    {data.attention[a.key]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          {t("updated")} <DateTime value={data.generated_at} relative />
        </p>
      </CardContent>
    </Card>
  );
}

const HEALTH_TONE = { good: "bg-success-soft text-success", watch: "bg-warning-soft text-warning", bad: "bg-danger-soft text-danger", idle: "bg-neutral-soft text-neutral" } as const;

export function ZoneHealthCard({ data }: { data: Dashboard }) {
  const t = useTranslations("dashboard");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1 text-base">
          {t("zoneHealth")}
          <KpiHelp title={t("zoneHealth")}>{t("helpZoneHealth")}</KpiHelp>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.zones.length === 0 ? (
          <EmptyState icon={MapPinOff} title={t("noZones")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">{t("colZone")}</th>
                  <th className="py-2 pr-4 font-medium">{t("colRequests")}</th>
                  <th className="py-2 pr-4 font-medium">{t("colMatchRate")}</th>
                  <th className="py-2 pr-4 font-medium">{t("colMedianMatch")}</th>
                  <th className="py-2 pr-4 font-medium">{t("colSupply")}</th>
                  <th className="py-2 font-medium">{t("colHealth")}</th>
                </tr>
              </thead>
              <tbody>
                {data.zones.map((z) => (
                  <tr key={z.zone_id} className="border-t">
                    <td className="py-2 pr-4 font-medium">{z.name}</td>
                    <td className="py-2 pr-4 tabular">{z.requests}</td>
                    <td className="py-2 pr-4 tabular">{z.match_rate === null ? "—" : `${z.match_rate}%`}</td>
                    <td className="py-2 pr-4 tabular">{z.median_match_s === null ? "—" : formatDuration(z.median_match_s)}</td>
                    <td className="py-2 pr-4 tabular">{z.online_drivers}</td>
                    <td className="py-2">
                      <span className={cn("inline-flex h-6 items-center rounded-md px-2 text-xs font-medium", HEALTH_TONE[z.health])}>{t(`health_${z.health}`)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function SupplyCard({ rows }: { rows: { at: string; online: number; on_trip: number }[] }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const label = (iso: string) =>
    new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Dhaka" }).format(new Date(iso));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1 text-base">
          {t("supply")}
          <KpiHelp title={t("supply")}>{t("helpSupply")}</KpiHelp>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noSupply")}</p>
        ) : (
          <BarChart
            ariaLabel={t("supplyAria")}
            labels={rows.map((r) => label(r.at))}
            format={(n) => n.toFixed(1)}
            series={[
              { name: t("driversIdle"), values: rows.map((r) => r.online), className: "fill-info" },
              { name: t("driversOnTrip"), values: rows.map((r) => r.on_trip), className: "fill-primary" },
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}

export function SurgeCard({ surge }: { surge: SurgeOverview }) {
  const t = useTranslations("dashboard");
  const active = surge.rows.filter((r) => r.effective > 1);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-1">
            {t("surge")}
            <KpiHelp title={t("surge")}>{t("helpSurge")}</KpiHelp>
          </span>
          <span className="text-xs font-normal text-muted-foreground">{surge.enabled ? t("surgeAutoOn") : t("surgeAutoOff")}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {active.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noSurge")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">{t("colZone")}</th>
                  <th className="py-2 pr-4 font-medium">{t("colCategory")}</th>
                  <th className="py-2 pr-4 font-medium">{t("colMultiplier")}</th>
                  <th className="py-2 pr-4 font-medium">{t("colDemand")}</th>
                  <th className="py-2 font-medium">{t("colSupply")}</th>
                </tr>
              </thead>
              <tbody>
                {active.map((r) => (
                  <tr key={`${r.zone}-${r.category}`} className="border-t">
                    <td className="py-2 pr-4 font-medium">{r.zone}</td>
                    <td className="py-2 pr-4">{r.category}</td>
                    <td className="py-2 pr-4 tabular">
                      ×{r.effective.toFixed(2)}
                      <span className="ml-2 text-xs text-muted-foreground">{t("surgeSplit", { auto: r.auto.toFixed(2), manual: r.manual.toFixed(2) })}</span>
                    </td>
                    <td className="py-2 pr-4 tabular">{r.demand}</td>
                    <td className="py-2 tabular">{r.supply}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
