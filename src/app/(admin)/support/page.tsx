import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { TabLinks } from "@/components/domain/tab-links";
import { requirePagePermission } from "@/server/auth/context";
import { listTickets } from "@/server/queries/care";
import { TicketsTable } from "./tickets-table";

export const metadata: Metadata = { title: "Support" };

const TABS = ["active", "mine", "unassigned", "breached", "closed"] as const;
type Tab = (typeof TABS)[number];
const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function SupportPage({ searchParams }: PageProps<"/support">) {
  const [ctx, params, t] = await Promise.all([requirePagePermission("support.view"), searchParams, getTranslations("support")]);
  const tab: Tab = TABS.find((x) => x === params.tab) ?? "active";
  const q = one(params.q);
  const data = await listTickets(ctx, {
    status: tab === "closed" ? "closed" : tab === "breached" ? "open" : "active",
    assignee: tab === "mine" ? "me" : tab === "unassigned" ? "unassigned" : undefined,
    priority: one(params.priority),
    q,
    cursor: one(params.cursor), sort: one(params.sort),
  });
  const rows = tab === "breached" ? data.rows.filter((r) => r.sla_breached) : data.rows;

  const href = (key: Tab) => {
    const sp = new URLSearchParams();
    if (key !== "active") sp.set("tab", key);
    if (q) sp.set("q", q);
    const s = sp.toString();
    return s ? `/support?${s}` : "/support";
  };

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <TabLinks
        active={tab}
        tabs={[
          { key: "active", label: t("tabActive"), href: href("active"), count: data.counts.active },
          { key: "mine", label: t("tabMine"), href: href("mine"), count: data.counts.mine },
          { key: "unassigned", label: t("tabUnassigned"), href: href("unassigned"), count: data.counts.unassigned },
          { key: "breached", label: t("tabBreached"), href: href("breached"), count: data.counts.breached },
          { key: "closed", label: t("tabClosed"), href: href("closed") },
        ]}
      />
      <TicketsTable rows={rows} nextCursor={data.next_cursor ?? null} />
    </>
  );
}
