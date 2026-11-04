import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { requirePagePermission } from "@/server/auth/context";
import { listVehicles } from "@/server/queries/supply";
import { VehiclesTable } from "./vehicles-table";

export const metadata: Metadata = { title: "Vehicles" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
const STATUSES = ["pending", "active", "inactive", "suspended"];

export default async function VehiclesPage({ searchParams }: PageProps<"/vehicles">) {
  const [ctx, params, t] = await Promise.all([requirePagePermission("vehicles.view"), searchParams, getTranslations("vehicles")]);
  const status = STATUSES.find((s) => s === params.status);
  const data = await listVehicles(ctx, { status, q: one(params.q), cursor: one(params.cursor), sort: one(params.sort) });

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <VehiclesTable rows={data.rows} nextCursor={data.next_cursor ?? null} />
    </>
  );
}
