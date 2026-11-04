import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { PageHeader } from "@/components/domain/page-header";
import { requirePagePermission } from "@/server/auth/context";
import { AppError } from "@/server/http/errors";
import { getDriver } from "@/server/queries/supply";
import { DriverHeaderBadges } from "../driver-sections";
import { ReviewWorkspace } from "./review-workspace";

export const metadata: Metadata = { title: "Review application" };

export default async function DriverReviewPage({ params }: PageProps<"/drivers/[id]/review">) {
  const [{ id }, ctx, t] = await Promise.all([params, requirePagePermission("documents.view"), getTranslations("drivers")]);
  if (!z.uuid().safeParse(id).success) notFound();
  if (!ctx.permissions.has("drivers.view")) notFound();

  let driver;
  try {
    driver = await getDriver(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <>
      <PageHeader title={`${t("review")}: ${driver.full_name}`} badge={<DriverHeaderBadges driver={driver} />} />
      {/* Remount on data change so the selection follows the server state. */}
      <ReviewWorkspace
        key={driver.document_history.map((d) => `${d.id}:${d.version}`).join("|") + driver.vehicles.map((v) => v.status).join()}
        driver={driver}
      />
    </>
  );
}
