import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { TabLinks } from "@/components/domain/tab-links";
import { requirePagePermission } from "@/server/auth/context";
import { listRatings } from "@/server/queries/care";
import { RatingsTable } from "./ratings-table";

export const metadata: Metadata = { title: "Ratings" };

const TABS = ["low", "all", "hidden"] as const;
type Tab = (typeof TABS)[number];
const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function RatingsPage({ searchParams }: PageProps<"/ratings">) {
  const [ctx, params, t] = await Promise.all([requirePagePermission("support.view"), searchParams, getTranslations("ratings")]);
  const tab: Tab = TABS.find((x) => x === params.tab) ?? "low";
  const data = await listRatings(ctx, { maxScore: tab === "low" ? 2 : undefined, hidden: tab === "hidden", cursor: one(params.cursor), sort: one(params.sort) });

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <TabLinks
        active={tab}
        tabs={[
          { key: "low", label: t("tabLow"), href: "/ratings" },
          { key: "all", label: t("tabAll"), href: "/ratings?tab=all" },
          { key: "hidden", label: t("tabHidden"), href: "/ratings?tab=hidden" },
        ]}
      />
      <RatingsTable rows={data.rows} nextCursor={data.next_cursor ?? null} />
    </>
  );
}
