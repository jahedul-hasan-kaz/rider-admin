import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BookRideButton } from "@/components/domain/crud-dialogs";
import { PageHeader } from "@/components/domain/page-header";
import { requirePagePermission } from "@/server/auth/context";
import { getFormRefs } from "@/server/queries/insight";
import { listRequests, REQUEST_STATUSES } from "@/server/queries/rides";
import { RequestsTable } from "./requests-table";

export const metadata: Metadata = { title: "Ride requests" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function RequestsPage({ searchParams }: PageProps<"/requests">) {
  const [ctx, params, t] = await Promise.all([requirePagePermission("trips.view"), searchParams, getTranslations("requests")]);
  const status = REQUEST_STATUSES.find((s) => s === params.status);
  const [data, refs] = await Promise.all([listRequests(ctx, { status, q: one(params.q), cursor: one(params.cursor), sort: one(params.sort) }), getFormRefs(ctx)]);

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} actions={<BookRideButton categories={refs.categories} />} />
      <RequestsTable rows={data.rows} nextCursor={data.next_cursor ?? null} />
    </>
  );
}
