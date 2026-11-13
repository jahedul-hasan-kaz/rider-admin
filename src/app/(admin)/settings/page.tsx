import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { TabLinks } from "@/components/domain/tab-links";
import { requirePagePermission } from "@/server/auth/context";
import { getFilterRefs, getOutboxOverview, listArchiveRuns, listFlags, listSettings } from "@/server/queries/insight";
import { DeliveryOverview, FlagsList, RetentionRuns, SettingsGroups } from "./settings-client";

export const metadata: Metadata = { title: "Settings" };

const TABS = ["settings", "flags", "delivery", "retention"] as const;
type Tab = (typeof TABS)[number];

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const [ctx, params, t] = await Promise.all([requirePagePermission("settings.view"), searchParams, getTranslations("settings")]);
  const tab: Tab = TABS.find((x) => x === params.tab) ?? "settings";
  const canAudit = ctx.permissions.has("audit.view");

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <TabLinks
        active={tab}
        tabs={[
          { key: "settings", label: t("tabSettings"), href: "/settings" },
          { key: "flags", label: t("tabFlags"), href: "/settings?tab=flags" },
          { key: "delivery", label: t("tabDelivery"), href: "/settings?tab=delivery" },
          { key: "retention", label: t("tabRetention"), href: "/settings?tab=retention" },
        ]}
      />
      {tab === "settings" ? <SettingsGroups settings={(await listSettings(ctx)).filter((s) => s.schema?.group !== "Retention")} /> : null}
      {tab === "flags" ? <FlagsList flags={await listFlags(ctx)} zones={(await getFilterRefs(ctx).catch(() => ({ zones: [], categories: [] }))).zones} /> : null}
      {tab === "delivery" ? <DeliveryOverview overview={await getOutboxOverview(ctx)} /> : null}
      {tab === "retention" ? (
        <RetentionRuns
          settings={(await listSettings(ctx)).filter((s) => s.schema?.group === "Retention")}
          runs={canAudit ? await listArchiveRuns(ctx) : null}
        />
      ) : null}
    </>
  );
}
