import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { TabLinks } from "@/components/domain/tab-links";
import { requirePagePermission } from "@/server/auth/context";
import { listIncidents } from "@/server/queries/care";
import { SafetyQueue } from "./safety-client";

export const metadata: Metadata = { title: "Safety" };

const TABS = ["open", "done"] as const;
type Tab = (typeof TABS)[number];
const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function SafetyPage({ searchParams }: PageProps<"/safety">) {
  const [ctx, params, t] = await Promise.all([requirePagePermission("safety.view"), searchParams, getTranslations("safety")]);
  const tab: Tab = TABS.find((x) => x === params.tab) ?? "open";
  const data = await listIncidents(ctx, { status: tab, cursor: one(params.cursor), sort: one(params.sort) });

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <TabLinks
        active={tab}
        tabs={[
          { key: "open", label: t("tabOpen"), href: "/safety", count: data.counts.open },
          { key: "done", label: t("tabDone"), href: "/safety?tab=done" },
        ]}
      />
      <SafetyQueue initialRows={data.rows} initialCounts={data.counts} live={tab === "open"} nextCursor={data.next_cursor ?? null} />
    </>
  );
}
