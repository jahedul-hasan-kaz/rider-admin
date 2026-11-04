import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { PageHeader } from "@/components/domain/page-header";
import { requirePagePermission } from "@/server/auth/context";
import { AppError } from "@/server/http/errors";
import { getPayoutBatch } from "@/server/queries/finance";
import { BatchActions, BatchBadge, BatchBody } from "./batch-client";

export const metadata: Metadata = { title: "Payout batch" };

export default async function PayoutBatchPage({ params }: PageProps<"/payouts/[id]">) {
  const [{ id }, ctx, t] = await Promise.all([params, requirePagePermission("payouts.view"), getTranslations("payouts")]);
  if (!z.uuid().safeParse(id).success) notFound();

  let batch;
  try {
    batch = await getPayoutBatch(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        title={t("batchTitle")}
        description={t("batchSubtitle", { count: batch.payout_count })}
        badge={<BatchBadge status={batch.status} />}
        actions={<BatchActions batch={batch} />}
      />
      <BatchBody batch={batch} />
    </>
  );
}
