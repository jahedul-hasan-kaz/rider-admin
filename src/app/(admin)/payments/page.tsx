import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { Stat, StatGrid } from "@/components/domain/stat";
import { TabLinks } from "@/components/domain/tab-links";
import { requirePagePermission } from "@/server/auth/context";
import { getPaymentsOverview, listDriverDues, listPayments } from "@/server/queries/finance";
import { DuesTable, PaymentsTable, ReconcileButton } from "./payments-client";

export const metadata: Metadata = { title: "Payments" };

const TABS = ["all", "pending", "overdue", "unreconciled", "dues"] as const;
type Tab = (typeof TABS)[number];
const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const [ctx, params, t] = await Promise.all([requirePagePermission("payments.view"), searchParams, getTranslations("payments")]);
  const tab: Tab = TABS.find((x) => x === params.tab) ?? "all";
  const q = one(params.q);
  // The overview and the list of the tab load together.
  const [overview, dues, list] = await Promise.all([
    getPaymentsOverview(ctx),
    tab === "dues" ? listDriverDues(ctx) : Promise.resolve(null),
    tab === "dues"
      ? Promise.resolve(null)
      : listPayments(ctx, {
          status: tab === "pending" || tab === "overdue" ? tab : undefined,
          unreconciled: tab === "unreconciled",
          q,
          cursor: one(params.cursor), sort: one(params.sort),
        }),
  ]);

  const href = (key: Tab) => {
    const sp = new URLSearchParams();
    if (key !== "all") sp.set("tab", key);
    if (q && key !== "dues") sp.set("q", q);
    const s = sp.toString();
    return s ? `/payments?${s}` : "/payments";
  };


  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={list && tab === "unreconciled" ? <ReconcileButton payments={list.rows} /> : null}
      />
      <StatGrid>
        <Stat label={t("statCollectedToday")} hint={t("statCollectedHint")}>
          {overview.collected_today.toLocaleString()}
        </Stat>
        <Stat label={t("statPendingCash")} tone={overview.pending_cash > 0 ? "warning" : undefined}>
          {overview.pending_cash.toLocaleString()}
        </Stat>
        <Stat label={t("statDues")} hint={t("statDuesHint")} tone={overview.dues_total > 0 ? "danger" : undefined}>
          {overview.dues_total.toLocaleString()}
        </Stat>
        <Stat label={t("statRefundsOpen")}>{overview.refunds_open}</Stat>
      </StatGrid>
      <TabLinks
        active={tab}
        tabs={[
          { key: "all", label: t("tabAll"), href: href("all") },
          { key: "pending", label: t("tabPending"), href: href("pending"), count: list?.counts.pending },
          { key: "overdue", label: t("tabOverdue"), href: href("overdue"), count: list?.counts.overdue },
          { key: "unreconciled", label: t("tabUnreconciled"), href: href("unreconciled"), count: list?.counts.unreconciled },
          { key: "dues", label: t("tabDues"), href: href("dues") },
        ]}
      />
      {dues ? <DuesTable rows={dues} /> : null}
      {list ? <PaymentsTable rows={list.rows} nextCursor={list.next_cursor ?? null} /> : null}
    </>
  );
}
