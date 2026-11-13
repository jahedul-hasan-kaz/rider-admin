"use client";

import { Plus } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Money } from "@/components/domain/money";
import type { FareRule, FareRulesPayload } from "@/server/queries/rides";

function slotRules(rules: FareRule[], categoryId: string, zoneId: string | null) {
  return rules.filter((r) => r.category_id === categoryId && r.zone_id === zoneId);
}

/** Categories × zones: which rule is live, what's scheduled next, and any draft (spec §5.10). */
export function FaresMatrix({ data, canManage }: { data: FareRulesPayload; canManage: boolean }) {
  const t = useTranslations("fares");
  const locale = useLocale();
  const columns: { id: string | null; name: string }[] = [
    { id: null, name: t("defaultColumn") },
    ...data.zones.map((z) => ({ id: z.id, name: z.name })),
  ];

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[640px] text-sm">
        <caption className="sr-only">{t("matrixTitle")}</caption>
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs tracking-wide text-muted-foreground uppercase">
            <th className="px-4 py-3 font-medium">{t("categoryLabel")}</th>
            {columns.map((c) => (
              <th key={c.id ?? "default"} className="px-4 py-3 font-medium">
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.categories.map((cat) => (
            <tr key={cat.id} className="border-b last:border-0 align-top">
              <th scope="row" className="px-4 py-4 text-left font-medium">
                {cat.name}
                {!cat.active ? <Badge variant="outline" className="ml-2">off</Badge> : null}
              </th>
              {columns.map((col) => {
                const rules = slotRules(data.rules, cat.id, col.id);
                const live = rules.find((r) => r.live_state === "active");
                const next = rules.filter((r) => r.live_state === "scheduled").sort((a, b) => (a.effective_from ?? "").localeCompare(b.effective_from ?? ""))[0];
                const draft = rules.find((r) => r.live_state === "draft");
                const empty = !live && !next && !draft;
                return (
                  <td key={col.id ?? "default"} className="px-4 py-4">
                    <div className="space-y-1.5">
                      {live ? (
                        <Link href={`/fares/${live.id}` as Route} className="block rounded-md border border-success/30 bg-success-soft/40 p-2 hover:bg-success-soft/70">
                          <span className="text-xs font-semibold text-success">{t("live", { version: live.rule_version })}</span>
                          <span className="block text-xs text-muted-foreground">
                            <Money value={live.base_fare} /> + <Money value={live.per_km} />/km
                          </span>
                        </Link>
                      ) : null}
                      {next ? (
                        <Link href={`/fares/${next.id}` as Route} className="block text-xs text-info hover:underline">
                          {t("next", { version: next.rule_version, date: formatDateTime(next.effective_from, locale) })}
                        </Link>
                      ) : null}
                      {draft ? (
                        <Link href={`/fares/${draft.id}` as Route} className={cn("block text-xs text-warning hover:underline")}>
                          {t("draftBadge", { version: draft.rule_version })}
                        </Link>
                      ) : null}
                      {empty ? <span className="block text-xs text-muted-foreground">{t("noRule")}</span> : null}
                      {canManage && !draft ? (
                        <Link
                          href={`/fares/new?category=${cat.id}${col.id ? `&zone=${col.id}` : ""}` as Route}
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          <Plus className="size-3" aria-hidden />
                          {t("create")}
                        </Link>
                      ) : null}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
