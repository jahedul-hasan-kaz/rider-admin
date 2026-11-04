import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { addDays, dhakaToday } from "@/lib/date-range";
import { requirePagePermission } from "@/server/auth/context";
import { listExports } from "@/server/queries/insight";
import { ExportForm, ExportsList } from "./exports-client";

export const metadata: Metadata = { title: "Exports" };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const one = (v: string | string[] | undefined) => (typeof v === "string" && ISO.test(v) ? v : undefined);

export default async function ExportsPage({ searchParams }: PageProps<"/exports">) {
  const [ctx, params, t] = await Promise.all([requirePagePermission("analytics.export"), searchParams, getTranslations("exports")]);
  const jobs = await listExports(ctx);
  const today = dhakaToday();
  const allowed = (["trips", "payments", "ledger", "tickets", "drivers"] as const).filter((k) =>
    ctx.permissions.has(({ trips: "trips.view", payments: "payments.view", ledger: "ledger.view", tickets: "support.view", drivers: "drivers.view" } as const)[k]),
  );

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <ExportForm kinds={[...allowed]} defaultFrom={one(params.from) ?? addDays(today, -29)} defaultTo={one(params.to) ?? today} />
      <ExportsList jobs={jobs} />
    </>
  );
}
