import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NewAccountButton } from "@/components/domain/crud-dialogs";
import { PageHeader } from "@/components/domain/page-header";
import { requirePagePermission } from "@/server/auth/context";
import { listPassengers } from "@/server/queries/supply";
import { PassengersTable } from "./passengers-table";

export const metadata: Metadata = { title: "Passengers" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function PassengersPage({ searchParams }: PageProps<"/passengers">) {
  const [ctx, params, t] = await Promise.all([requirePagePermission("passengers.view"), searchParams, getTranslations("passengers")]);
  const status = ["active", "suspended", "deactivated"].find((s) => s === params.status);
  const data = await listPassengers(ctx, { status, q: one(params.q), cursor: one(params.cursor), sort: one(params.sort) });

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} actions={<NewAccountButton role="passenger" />} />
      <PassengersTable rows={data.rows} nextCursor={data.next_cursor ?? null} />
    </>
  );
}
