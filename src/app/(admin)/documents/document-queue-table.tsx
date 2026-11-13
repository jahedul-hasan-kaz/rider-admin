"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { FileCheck2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { CursorPagination } from "@/components/data-table/cursor-pagination";
import { DataTable } from "@/components/data-table/data-table";
import { useUrlParams } from "@/components/data-table/use-url-params";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { useDocumentTypeLabel } from "@/components/domain/status-text";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DocumentQueue, QueueRow } from "@/server/queries/supply";

const SLA_WARN_HOURS = 24;

export function DocumentQueueTable({ rows, nextCursor, queue }: { rows: QueueRow[]; nextCursor: string | null; queue: DocumentQueue }) {
  const t = useTranslations("documents");
  const locale = useLocale();
  const docLabel = useDocumentTypeLabel();
  const { pending } = useUrlParams();

  const columns = useMemo<ColumnDef<QueueRow, unknown>[]>(() => {
    const cols: ColumnDef<QueueRow, unknown>[] = [
      { id: "doc", meta: { sortKey: "document_type" }, header: t("colDocument"), cell: ({ row }) => <span className="font-medium">{docLabel(row.original.document_type)}</span> },
      { id: "driver", meta: { sortKey: "driver_name" }, header: t("colDriver"), cell: ({ row }) => row.original.driver_name },
      {
        id: "vehicle",
        header: t("colVehicle"),
        cell: ({ row }) =>
          row.original.vehicle ? <span className="font-mono text-xs">{row.original.vehicle.registration_number}</span> : "—",
      },
    ];
    if (queue === "pending") {
      cols.push({
        id: "waiting", meta: { sortKey: "uploaded_at" },
        header: t("colUploaded"),
        cell: ({ row }) => {
          const uploaded = row.original.uploaded_at;
          const overdue = uploaded && Date.now() - Date.parse(uploaded) > SLA_WARN_HOURS * 3_600_000;
          return (
            <span className={cn("text-sm", overdue && "font-medium text-warning")}>
              {uploaded ? t("waiting", { time: formatRelative(uploaded, locale).replace(/ ago$/, "") }) : "—"}
            </span>
          );
        },
      });
    } else if (queue === "rejected") {
      cols.push({
        id: "reason",
        header: t("colReason"),
        cell: ({ row }) => <span className="line-clamp-1 max-w-72 text-sm">{row.original.rejection_reason}</span>,
      });
    } else {
      cols.push({
        id: "expires", meta: { sortKey: "expires_at" },
        header: t("colExpires"),
        cell: ({ row }) => (
          <span className={cn("tabular", queue === "expired" && "text-danger")}>{row.original.expires_at ?? "—"}</span>
        ),
      });
    }
    cols.push({ id: "uploaded", meta: { sortKey: "uploaded_at" }, header: t("uploaded"), cell: ({ row }) => <DateTime value={row.original.uploaded_at} /> });
    return cols;
  }, [t, docLabel, queue, locale]);

  return (
    <div className="space-y-3">
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        getRowHref={(r) => `/drivers/${r.driver_id}/review`}
        pending={pending}
        caption={t("title")}
        empty={<EmptyState icon={FileCheck2} title={queue === "pending" ? t("emptyPending") : t("empty")} />}
      />
      <CursorPagination nextCursor={nextCursor} />
    </div>
  );
}
