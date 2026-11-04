import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { PageHeader } from "@/components/domain/page-header";
import { requirePagePermission } from "@/server/auth/context";
import { listFareRules } from "@/server/queries/rides";
import { RuleEditor } from "../rule-editor";

export const metadata: Metadata = { title: "New fare rule" };

export default async function NewFareRulePage({ searchParams }: PageProps<"/fares/new">) {
  const [ctx, query, t] = await Promise.all([requirePagePermission("fares.manage"), searchParams, getTranslations("fares")]);
  const categoryId = z.uuid().safeParse(query.category);
  if (!categoryId.success) notFound();
  const zoneParam = z.uuid().safeParse(query.zone);

  const data = await listFareRules(ctx);
  const category = data.categories.find((c) => c.id === categoryId.data);
  if (!category) notFound();
  const zone = zoneParam.success ? data.zones.find((z) => z.id === zoneParam.data) : undefined;
  const zoneId = zone?.id ?? null;

  return (
    <>
      <PageHeader title={t("editorNew")} />
      <RuleEditor
        rule={null}
        categoryId={category.id}
        zoneId={zoneId}
        categoryName={category.name}
        zoneName={zone?.name ?? t("allZones")}
        siblings={data.rules.filter((r) => r.category_id === category.id && r.zone_id === zoneId)}
        zoneSurge={zone?.manual_surge_multiplier ?? 1}
      />
    </>
  );
}
