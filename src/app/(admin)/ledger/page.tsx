import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { Stat, StatGrid } from "@/components/domain/stat";
import { TabLinks } from "@/components/domain/tab-links";
import { requirePagePermission } from "@/server/auth/context";
import { getLedgerOverview, listLedgerAccounts, listLedgerTransactions } from "@/server/queries/finance";
import { AccountsTable, TransactionsTable, VerificationCard } from "./ledger-client";

export const metadata: Metadata = { title: "Ledger" };

const TABS = ["accounts", "transactions"] as const;
type Tab = (typeof TABS)[number];
const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function LedgerPage({ searchParams }: PageProps<"/ledger">) {
  const [ctx, params, t] = await Promise.all([requirePagePermission("ledger.view"), searchParams, getTranslations("ledger")]);
  const tab: Tab = TABS.find((x) => x === params.tab) ?? "accounts";
  const owner = one(params.owner);
  const q = one(params.q);
  const [overview, accounts, transactions] = await Promise.all([
    getLedgerOverview(ctx),
    tab === "accounts" ? listLedgerAccounts(ctx, { ownerType: owner, q }) : Promise.resolve(null),
    tab === "transactions" ? listLedgerTransactions(ctx, { kind: one(params.kind), cursor: one(params.cursor), sort: one(params.sort) }) : Promise.resolve(null),
  ]);
  const platform = Object.fromEntries(overview.platform.map((a) => [a.code.replace("platform:", ""), a.balance]));

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <VerificationCard verification={overview.verification} />
      <StatGrid>
        <Stat label={t("statCommission")}>{(platform.commission_revenue ?? 0).toLocaleString()}</Stat>
        <Stat label={t("statCashOnHand")} hint={t("statCashHint")}>
          {(platform.cash_on_hand ?? 0).toLocaleString()}
        </Stat>
        <Stat label={t("statOwedToDrivers")} hint={t("statOwedToDriversHint")}>
          {overview.owed_to_drivers.toLocaleString()}
        </Stat>
        <Stat label={t("statOwedByDrivers")} hint={t("statOwedByDriversHint")} tone={overview.owed_by_drivers > 0 ? "danger" : undefined}>
          {overview.owed_by_drivers.toLocaleString()}
        </Stat>
      </StatGrid>
      <TabLinks
        active={tab}
        tabs={[
          { key: "accounts", label: t("tabAccounts"), href: "/ledger" },
          { key: "transactions", label: t("tabTransactions"), href: "/ledger?tab=transactions" },
        ]}
      />
      {accounts ? <AccountsTable rows={accounts} /> : null}
      {transactions ? <TransactionsTable rows={transactions.rows} nextCursor={transactions.next_cursor ?? null} /> : null}
    </>
  );
}
