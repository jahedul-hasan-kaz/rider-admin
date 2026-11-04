import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { TabLinks } from "@/components/domain/tab-links";
import { requirePagePermission } from "@/server/auth/context";
import { listPayoutAccounts, listPayoutBatches } from "@/server/queries/finance";
import { AccountsList, BatchesTable, CreateBatchButton } from "./payouts-client";

export const metadata: Metadata = { title: "Payouts" };

const TABS = ["batches", "accounts"] as const;
type Tab = (typeof TABS)[number];

export default async function PayoutsPage({ searchParams }: PageProps<"/payouts">) {
  const [ctx, params, t] = await Promise.all([requirePagePermission("payouts.view"), searchParams, getTranslations("payouts")]);
  const tab: Tab = TABS.find((x) => x === params.tab) ?? "batches";
  const [batches, accounts] = await Promise.all([
    tab === "batches" ? listPayoutBatches(ctx) : Promise.resolve(null),
    listPayoutAccounts(ctx, "pending"),
  ]);

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} actions={<CreateBatchButton />} />
      <TabLinks
        active={tab}
        tabs={[
          { key: "batches", label: t("tabBatches"), href: "/payouts" },
          { key: "accounts", label: t("tabAccounts"), href: "/payouts?tab=accounts", count: accounts.length },
        ]}
      />
      {batches ? <BatchesTable rows={batches} /> : <AccountsList rows={accounts} />}
    </>
  );
}
