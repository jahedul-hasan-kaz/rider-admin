import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { TabLinks } from "@/components/domain/tab-links";
import { requirePagePermission } from "@/server/auth/context";
import { listPromotions } from "@/server/queries/finance";
import { listFareRules } from "@/server/queries/rides";
import { NewPromotionButton, PromotionsTable } from "./promotions-client";

export const metadata: Metadata = { title: "Promotions" };

const TABS = ["all", "active", "draft", "ended"] as const;
type Tab = (typeof TABS)[number];

export default async function PromotionsPage({ searchParams }: PageProps<"/promotions">) {
  const [ctx, params, t] = await Promise.all([requirePagePermission("promotions.view"), searchParams, getTranslations("promotions")]);
  const tab: Tab = TABS.find((x) => x === params.tab) ?? "all";
  const [rows, refs] = await Promise.all([
    listPromotions(ctx, tab === "all" ? undefined : tab),
    // Zones and categories for the editor; a manager without fares access just gets no area filters.
    listFareRules(ctx).catch(() => ({ categories: [], zones: [], rules: [] })),
  ]);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={<NewPromotionButton categories={refs.categories} zones={refs.zones} />}
      />
      <TabLinks
        active={tab}
        tabs={[
          { key: "all", label: t("tabAll"), href: "/promotions" },
          { key: "active", label: t("tabActive"), href: "/promotions?tab=active" },
          { key: "draft", label: t("tabDraft"), href: "/promotions?tab=draft" },
          { key: "ended", label: t("tabEnded"), href: "/promotions?tab=ended" },
        ]}
      />
      <PromotionsTable rows={rows} />
    </>
  );
}
