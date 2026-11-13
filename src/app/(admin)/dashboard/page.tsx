import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { RangeFilter } from "@/components/domain/range-filter";
import { resolveRange, uuidOrUndefined } from "@/lib/date-range";
import { requirePagePermission } from "@/server/auth/context";
import { getDashboard, getFilterRefs, getIntradaySupply, getSurgeOverview } from "@/server/queries/insight";
import { AttentionPanel, CancellationsCard, FunnelCard, IntradayCard, KpiCards, SupplyCard, SurgeCard, ZoneHealthCard } from "./dashboard-client";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const [ctx, params, t] = await Promise.all([requirePagePermission("dashboard.view"), searchParams, getTranslations("dashboard")]);
  const range = resolveRange(params);
  const zone = uuidOrUndefined(params.zone);
  const category = uuidOrUndefined(params.category);
  const [data, refs, supply, surge] = await Promise.all([getDashboard(ctx, { ...range, zone, category }), getFilterRefs(ctx), getIntradaySupply(ctx), getSurgeOverview(ctx)]);

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <RangeFilter preset={range.preset} from={range.from} to={range.to} zone={zone} category={category} zones={refs.zones} categories={refs.categories} />
      <KpiCards data={data} />
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <FunnelCard data={data} />
        <CancellationsCard data={data} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <IntradayCard data={data} />
        <AttentionPanel data={data} />
      </div>
      <SupplyCard rows={supply} />
      <SurgeCard surge={surge} />
      <ZoneHealthCard data={data} />
    </>
  );
}
