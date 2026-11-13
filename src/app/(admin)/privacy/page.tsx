import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { TabLinks } from "@/components/domain/tab-links";
import { requireAnyPagePermission } from "@/server/auth/context";
import { listDeletionRequests } from "@/server/queries/privacy";
import { DeletionList } from "./privacy-client";

export const metadata: Metadata = { title: "Privacy requests" };

export default async function PrivacyPage({ searchParams }: PageProps<"/privacy">) {
  const [ctx, params, t] = await Promise.all([requireAnyPagePermission(["passengers.update", "drivers.update"]), searchParams, getTranslations("privacy")]);
  const tab = params.tab === "done" ? "done" : "pending";
  const rows = await listDeletionRequests(ctx, tab === "pending" ? "pending" : null);

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <TabLinks
        active={tab}
        tabs={[
          { key: "pending", label: t("tabPending"), href: "/privacy" },
          { key: "done", label: t("tabAll"), href: "/privacy?tab=done" },
        ]}
      />
      <DeletionList rows={tab === "done" ? rows.filter((r) => r.status !== "pending") : rows} />
    </>
  );
}
