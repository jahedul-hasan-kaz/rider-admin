import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { RangeFilter } from "@/components/domain/range-filter";
import { TabLinks } from "@/components/domain/tab-links";
import { Button } from "@/components/ui/button";
import { resolveRange, uuidOrUndefined } from "@/lib/date-range";
import { requirePagePermission } from "@/server/auth/context";
import { ANALYTICS_PAGES, getDrivers, getEconomics, getFilterRefs, getFinance, getFunnel, getPassengers, type AnalyticsPage } from "@/server/queries/insight";
import { DriversView, EconomicsView, FinanceView, FunnelView, PassengersView } from "./analytics-client";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const [ctx, params, t] = await Promise.all([requirePagePermission("analytics.view"), searchParams, getTranslations("analytics")]);
  const page: AnalyticsPage = ANALYTICS_PAGES.find((p) => p === params.page) ?? "funnel";
  const range = resolveRange(params);
  const zone = uuidOrUndefined(params.zone);
  const category = uuidOrUndefined(params.category);
  const filters = { ...range, zone, category };
  // The filter choices and the figures of the page load together.
  const [refs, data] = await Promise.all([
    getFilterRefs(ctx),
    (page === "funnel" ? getFunnel(ctx, filters)
      : page === "economics" ? getEconomics(ctx, filters)
      : page === "drivers" ? getDrivers(ctx, filters)
      : page === "passengers" ? getPassengers(ctx, filters)
      : getFinance(ctx, filters)) as Promise<unknown>,
  ]);

  const href = (p: AnalyticsPage) => {
    const sp = new URLSearchParams();
    if (p !== "funnel") sp.set("page", p);
    for (const key of ["range", "from", "to", "zone", "category"] as const) {
      const v = params[key];
      if (typeof v === "string" && v) sp.set(key, v);
    }
    const s = sp.toString();
    return s ? `/analytics?${s}` : "/analytics";
  };

  let view: React.ReactNode;
  if (page === "funnel") view = <FunnelView data={data as Awaited<ReturnType<typeof getFunnel>>} />;
  else if (page === "economics") view = <EconomicsView data={data as Awaited<ReturnType<typeof getEconomics>>} />;
  else if (page === "drivers") view = <DriversView data={data as Awaited<ReturnType<typeof getDrivers>>} />;
  else if (page === "passengers") view = <PassengersView data={data as Awaited<ReturnType<typeof getPassengers>>} />;
  else view = <FinanceView data={data as Awaited<ReturnType<typeof getFinance>>} />;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          ctx.permissions.has("analytics.export") ? (
            <Button variant="outline" asChild>
              <Link href={`/exports?from=${range.from}&to=${range.to}`}>
                <Download className="size-4" />
                {t("export")}
              </Link>
            </Button>
          ) : null
        }
      />
      <TabLinks
        active={page}
        tabs={ANALYTICS_PAGES.map((p) => ({ key: p, label: t(`tab_${p}`), href: href(p) }))}
      />
      <RangeFilter preset={range.preset} from={range.from} to={range.to} zone={zone} category={category} zones={refs.zones} categories={refs.categories} />
      {view}
    </>
  );
}
