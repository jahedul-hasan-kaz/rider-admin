"use client";

import { History } from "lucide-react";
import { useTranslations } from "next-intl";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import type { AuditRow } from "@/server/queries/audit";

/** Newest-first activity for one admin, from the admin audit log. */
export function ActivityTimeline({ rows }: { rows: AuditRow[] }) {
  const t = useTranslations("audit");
  if (rows.length === 0) return <EmptyState icon={History} title={t("emptyTitle")} />;

  return (
    <ol className="relative space-y-5 border-l pl-6">
      {rows.map((row) => (
        <li key={row.id} className="relative">
          <span className="absolute top-1.5 -left-[29px] size-2.5 rounded-full border-2 border-background bg-primary" aria-hidden />
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{row.action}</code>
            <span className="text-muted-foreground">
              {row.admin_name ?? t("system")} · <DateTime value={row.created_at} relative />
            </span>
          </div>
          {row.reason ? <p className="mt-1 text-sm">{row.reason}</p> : null}
        </li>
      ))}
    </ol>
  );
}
