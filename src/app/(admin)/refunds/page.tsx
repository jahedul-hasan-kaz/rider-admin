import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { TabLinks } from "@/components/domain/tab-links";
import { requireAnyPagePermission } from "@/server/auth/context";
import { listRefunds } from "@/server/queries/finance";
import { RefundsList } from "./refunds-client";

export const metadata: Metadata = { title: "Refunds & adjustments" };

const TABS = ["open", "processed", "rejected", "all"] as const;
type Tab = (typeof TABS)[number];
const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function RefundsPage({ searchParams }: PageProps<"/refunds">) {
  const [ctx, params, t] = await Promise.all([requireAnyPagePermission(["ledger.view", "refunds.request", "refunds.approve", "ledger.adjust_request", "ledger.adjust_approve"]), searchParams, getTranslations("refunds")]);
  const tab: Tab = TABS.find((x) => x === params.tab) ?? "open";
  const data = await listRefunds(ctx, { status: tab === "all" ? undefined : tab, cursor: one(params.cursor) });

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <TabLinks
        active={tab}
        tabs={[
          { key: "open", label: t("tabOpen"), href: "/refunds", count: data.counts.open },
          { key: "processed", label: t("tabProcessed"), href: "/refunds?tab=processed" },
          { key: "rejected", label: t("tabRejected"), href: "/refunds?tab=rejected" },
          { key: "all", label: t("tabAll"), href: "/refunds?tab=all" },
        ]}
      />
      <RefundsList rows={data.rows} nextCursor={data.next_cursor ?? null} me={ctx.userId} />
    </>
  );
}
