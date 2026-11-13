import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NewAccountButton } from "@/components/domain/crud-dialogs";
import { PageHeader } from "@/components/domain/page-header";
import { TabLinks } from "@/components/domain/tab-links";
import { Badge } from "@/components/ui/badge";
import { requirePagePermission } from "@/server/auth/context";
import { getFormRefs } from "@/server/queries/insight";
import { DRIVER_TABS, listDrivers, type DriverTab } from "@/server/queries/supply";
import { DriversTable } from "./drivers-table";

export const metadata: Metadata = { title: "Drivers" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function DriversPage({ searchParams }: PageProps<"/drivers">) {
  const [ctx, params, t] = await Promise.all([requirePagePermission("drivers.view"), searchParams, getTranslations("drivers")]);
  const tabParam = one(params.tab);
  const tab: DriverTab = DRIVER_TABS.includes(tabParam as DriverTab) ? (tabParam as DriverTab) : "all";
  const q = one(params.q);
  const [data, refs] = await Promise.all([listDrivers(ctx, { tab, q, cursor: one(params.cursor), sort: one(params.sort) }), getFormRefs(ctx)]);

  const tabHref = (key: DriverTab) => {
    const sp = new URLSearchParams();
    if (key !== "all") sp.set("tab", key);
    if (q) sp.set("q", q);
    const s = sp.toString();
    return s ? `/drivers?${s}` : "/drivers";
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={<NewAccountButton role="driver" zones={refs.zones} />}
        badge={
          data.counts.online > 0 ? (
            <Badge className="bg-success-soft text-success">
              <span className="mr-1 size-1.5 animate-pulse rounded-full bg-success" aria-hidden />
              {t("online", { count: data.counts.online })}
            </Badge>
          ) : null
        }
      />
      <TabLinks
        active={tab}
        tabs={[
          { key: "all", label: t("tabAll"), href: tabHref("all") },
          { key: "applications", label: t("tabApplications"), href: tabHref("applications"), count: data.counts.applications },
          { key: "approved", label: t("tabApproved"), href: tabHref("approved"), count: data.counts.approved },
          { key: "suspended", label: t("tabSuspended"), href: tabHref("suspended"), count: data.counts.suspended },
          { key: "rejected", label: t("tabRejected"), href: tabHref("rejected") },
          { key: "draft", label: t("tabDraft"), href: tabHref("draft") },
        ]}
      />
      <DriversTable rows={data.rows} nextCursor={data.next_cursor ?? null} tab={tab} />
    </>
  );
}
