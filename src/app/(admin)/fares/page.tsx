import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { requirePagePermission } from "@/server/auth/context";
import { listFareRules } from "@/server/queries/rides";
import { FaresMatrix } from "./fares-matrix";

export const metadata: Metadata = { title: "Fare rules" };

export default async function FaresPage() {
  const [ctx, t] = await Promise.all([requirePagePermission("fares.view"), getTranslations("fares")]);
  const data = await listFareRules(ctx);
  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <FaresMatrix data={data} canManage={ctx.permissions.has("fares.manage")} />
    </>
  );
}
