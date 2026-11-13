"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { CarFront } from "lucide-react";
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
import type { VehicleRow } from "@/server/queries/supply";

export function VehiclesTable({ rows, nextCursor }: { rows: VehicleRow[]; nextCursor: string | null }) {
  const t = useTranslations("vehicles");
  const label = useStatusLabel();
  const { pending } = useUrlParams();

  const columns = useMemo<ColumnDef<VehicleRow, unknown>[]>(
    () => [
      {
        id: "plate", meta: { sortKey: "registration_number" },
        header: t("colPlate"),
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2 font-mono text-sm">
            {row.original.registration_number}
            {row.original.is_current ? <Badge variant="secondary">{t("current")}</Badge> : null}
          </span>
        ),
      },
      {
        id: "vehicle",
        header: t("colVehicle"),
        cell: ({ row }) => `${row.original.make} ${row.original.model} · ${row.original.color} · ${row.original.year}`,
      },
      { id: "category", header: t("colCategory"), cell: ({ row }) => row.original.category.name },
      { id: "driver", meta: { sortKey: "driver_name" }, header: t("colDriver"), cell: ({ row }) => row.original.driver.full_name },
      {
        id: "status", meta: { sortKey: "status" },
        header: t("colStatus"),
        cell: ({ row }) => <StatusBadge status={row.original.status} label={label(row.original.status)} />,
      },
      { id: "verified", meta: { sortKey: "verified_at" }, header: t("colVerified"), cell: ({ row }) => <DateTime value={row.original.verified_at} relative /> },
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
          options={["pending", "active", "suspended", "inactive"].map((s) => ({ value: s, label: label(s) }))}
        />
      </Toolbar>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        getRowHref={(r) => `/vehicles/${r.id}`}
        pending={pending}
        caption={t("title")}
        empty={<EmptyState icon={CarFront} title={t("empty")} />}
      />
      <CursorPagination nextCursor={nextCursor} />
    </div>
  );
}
