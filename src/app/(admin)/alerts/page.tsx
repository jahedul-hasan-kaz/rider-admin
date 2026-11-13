import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NewAlertButton } from "@/components/domain/crud-dialogs";
import { PageHeader } from "@/components/domain/page-header";
import { TabLinks } from "@/components/domain/tab-links";
import { requirePagePermission } from "@/server/auth/context";
import { listAlerts } from "@/server/queries/insight";
import { AlertsList } from "./alerts-client";

export const metadata: Metadata = { title: "Alerts" };

export default async function AlertsPage({ searchParams }: PageProps<"/alerts">) {
  const [ctx, params, t] = await Promise.all([requirePagePermission("dashboard.view"), searchParams, getTranslations("alerts")]);
  const tab = params.tab === "resolved" ? "resolved" : "open";
  const alerts = await listAlerts(ctx, tab);

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} actions={<NewAlertButton />} />
      <TabLinks
        active={tab}
        tabs={[
          { key: "open", label: t("tabOpen"), href: "/alerts" },
          { key: "resolved", label: t("tabResolved"), href: "/alerts?tab=resolved" },
        ]}
      />
      <AlertsList alerts={alerts} live={tab === "open"} />
    </>
  );
}
