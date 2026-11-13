import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { RequestCrudActions } from "@/components/domain/crud-dialogs";
import { PageHeader } from "@/components/domain/page-header";
import { requirePagePermission } from "@/server/auth/context";
import { AppError } from "@/server/http/errors";
import { getRequest } from "@/server/queries/rides";
import { RequestActions, RequestBadges, RequestBody } from "./request-client";

export const metadata: Metadata = { title: "Ride request" };

export default async function RequestPage({ params }: PageProps<"/requests/[id]">) {
  const [{ id }, ctx, t] = await Promise.all([params, requirePagePermission("trips.view"), getTranslations("requests")]);
  if (!z.uuid().safeParse(id).success) notFound();

  let request;
  try {
    request = await getRequest(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        title={`${t("colRequest")} ${request.id.slice(0, 8)}`}
        description={t("route", { from: request.pickup_label ?? "—", to: request.destination_label ?? "—" })}
        badge={<RequestBadges request={request} />}
        actions={
          <>
            <RequestActions request={request} />
            <RequestCrudActions request={request} />
          </>
        }
      />
      <RequestBody request={request} />
    </>
  );
}
