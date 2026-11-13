import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { PageHeader } from "@/components/domain/page-header";
import { requirePagePermission } from "@/server/auth/context";
import { AppError } from "@/server/http/errors";
import { getLedgerAccount } from "@/server/queries/finance";
import { AccountBody, AdjustmentButton } from "./account-client";

export const metadata: Metadata = { title: "Ledger account" };

export default async function LedgerAccountPage({ params, searchParams }: PageProps<"/ledger/accounts/[id]">) {
  const [{ id }, sp, ctx, t] = await Promise.all([params, searchParams, requirePagePermission("ledger.view"), getTranslations("ledger")]);
  if (!z.uuid().safeParse(id).success) notFound();
  const cursor = typeof sp.cursor === "string" && /^\d+$/.test(sp.cursor) ? Number(sp.cursor) : undefined;

  let data;
  try {
    data = await getLedgerAccount(ctx, id, cursor);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        title={t("accountTitle")}
        description={<span className="font-mono text-xs break-all">{data.account.code}</span>}
        actions={<AdjustmentButton accountId={data.account.id} />}
      />
      <AccountBody account={data.account} entries={data.entries} nextCursor={data.next_cursor} />
    </>
  );
}
