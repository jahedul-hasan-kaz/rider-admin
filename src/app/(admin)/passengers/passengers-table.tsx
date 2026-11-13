"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { CursorPagination } from "@/components/data-table/cursor-pagination";
import { DataTable } from "@/components/data-table/data-table";
import { Toolbar, ToolbarSearch, ToolbarSelect } from "@/components/data-table/toolbar";
import { useUrlParams } from "@/components/data-table/use-url-params";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { Badge } from "@/components/ui/badge";
import type { PassengerRow } from "@/server/queries/supply";

export function PassengersTable({ rows, nextCursor }: { rows: PassengerRow[]; nextCursor: string | null }) {
  const t = useTranslations("passengers");
  const label = useStatusLabel();
  const { pending } = useUrlParams();

  const columns = useMemo<ColumnDef<PassengerRow, unknown>[]>(
    () => [
      {
        id: "name", meta: { sortKey: "full_name" },
        header: t("colName"),
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2 font-medium">
            {row.original.full_name}
            {row.original.role === "user" ? <Badge variant="outline">{t("notOnboarded")}</Badge> : null}
          </span>
        ),
      },
      {
        id: "phone",
        header: t("colPhone"),
        cell: ({ row }) => <span className="font-mono text-xs tabular">{row.original.phone_masked ?? "—"}</span>,
      },
      {
        id: "status", meta: { sortKey: "status" },
        header: t("colStatus"),
        cell: ({ row }) => <StatusBadge status={row.original.status} label={label(row.original.status)} />,
      },
      { id: "joined", meta: { sortKey: "created_at" }, header: t("colJoined"), cell: ({ row }) => <DateTime value={row.original.created_at} /> },
      { id: "seen", meta: { sortKey: "last_seen_at" }, header: t("colLastSeen"), cell: ({ row }) => <DateTime value={row.original.last_seen_at} relative /> },
    ],
    [t, label],
  );

  return (
    <div className="space-y-3">
      <Toolbar filterKeys={["q", "status"]}>
        <ToolbarSearch placeholder={t("searchPlaceholder")} />
        <ToolbarSelect
          param="status"
          allLabel={t("allStatuses")}
          options={["active", "suspended", "deactivated"].map((s) => ({ value: s, label: label(s) }))}
        />
      </Toolbar>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        getRowHref={(r) => `/passengers/${r.id}`}
        pending={pending}
        caption={t("title")}
        empty={<EmptyState icon={Users} title={t("empty")} />}
      />
      <CursorPagination nextCursor={nextCursor} />
    </div>
  );
}
