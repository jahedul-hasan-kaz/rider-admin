import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { PageHeader } from "@/components/domain/page-header";
import { requirePagePermission } from "@/server/auth/context";
import { listFareRules } from "@/server/queries/rides";
import { RuleEditor } from "../rule-editor";

export const metadata: Metadata = { title: "Fare rule" };

export default async function FareRulePage({ params }: PageProps<"/fares/[id]">) {
  const [{ id }, ctx, t] = await Promise.all([params, requirePagePermission("fares.view"), getTranslations("fares")]);
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await listFareRules(ctx);
  const rule = data.rules.find((r) => r.id === id);
  if (!rule) notFound();

  const category = data.categories.find((c) => c.id === rule.category_id);
  const zone = data.zones.find((z) => z.id === rule.zone_id);
  const siblings = data.rules.filter((r) => r.category_id === rule.category_id && r.zone_id === rule.zone_id);

  return (
    <>
      <PageHeader title={t("editorEdit", { version: rule.rule_version })} />
      <RuleEditor
        key={`${rule.id}:${rule.version}:${rule.status}`}
        rule={rule}
        categoryId={rule.category_id}
        zoneId={rule.zone_id}
        categoryName={category?.name ?? ""}
        zoneName={zone?.name ?? t("allZones")}
        siblings={siblings}
        zoneSurge={zone?.manual_surge_multiplier ?? 1}
      />
    </>
  );
}
