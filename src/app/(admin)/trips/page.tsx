import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { TabLinks } from "@/components/domain/tab-links";
import { requirePagePermission } from "@/server/auth/context";
import { listTrips, TRIP_TABS, type TripTab } from "@/server/queries/rides";
import { TripsTable } from "./trips-table";

export const metadata: Metadata = { title: "Trips" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function TripsPage({ searchParams }: PageProps<"/trips">) {
  const [ctx, params, t] = await Promise.all([requirePagePermission("trips.view"), searchParams, getTranslations("trips")]);
  const tab: TripTab = TRIP_TABS.find((x) => x === params.tab) ?? "all";
  const q = one(params.q);
  const data = await listTrips(ctx, {
    status: tab === "all" || tab === "flagged" ? undefined : tab,
    flagged: tab === "flagged",
    q,
    cursor: one(params.cursor), sort: one(params.sort),
  });

  const href = (key: TripTab) => {
    const sp = new URLSearchParams();
    if (key !== "all") sp.set("tab", key);
    if (q) sp.set("q", q);
    const s = sp.toString();
    return s ? `/trips?${s}` : "/trips";
  };

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <TabLinks
        active={tab}
        tabs={[
          { key: "all", label: t("tabAll"), href: href("all") },
          { key: "active", label: t("tabActive"), href: href("active"), count: data.counts.active },
          { key: "completed", label: t("tabCompleted"), href: href("completed") },
          { key: "cancelled", label: t("tabCancelled"), href: href("cancelled") },
          { key: "flagged", label: t("tabFlagged"), href: href("flagged"), count: data.counts.flagged },
        ]}
      />
      <TripsTable rows={data.rows} nextCursor={data.next_cursor ?? null} />
    </>
  );
}
