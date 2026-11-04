"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { CarFront, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { CursorPagination } from "@/components/data-table/cursor-pagination";
import { DataTable } from "@/components/data-table/data-table";
import { Toolbar, ToolbarSearch } from "@/components/data-table/toolbar";
import { useUrlParams } from "@/components/data-table/use-url-params";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { Money } from "@/components/domain/money";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDistance } from "@/lib/format";
import type { TripRow } from "@/server/queries/rides";

/** Outcome colour: the shared badge keys off a few canonical words. */
export function tripTone(status: string): string {
  if (status === "completed") return "completed";
  if (["driver_assigned", "driver_arriving", "arrived", "in_progress"].includes(status)) return "in_progress";
  if (status === "failed") return "failed";
  return "cancelled";
}

export function TripsTable({ rows, nextCursor }: { rows: TripRow[]; nextCursor: string | null }) {
  const t = useTranslations("trips");
  const label = useStatusLabel();
  const { pending } = useUrlParams();

  const columns = useMemo<ColumnDef<TripRow, unknown>[]>(
    () => [
      {
        id: "trip",
        header: t("colTrip"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="font-mono text-xs">{row.original.id.slice(0, 8)}</p>
            <p className="max-w-48 truncate text-xs text-muted-foreground">
              {row.original.pickup_label ?? "—"} → {row.original.destination_label ?? "—"}
            </p>
          </div>
        ),
      },
      { id: "passenger", meta: { sortKey: "passenger_name" }, header: t("colPassenger"), cell: ({ row }) => row.original.passenger.name },
      { id: "driver", meta: { sortKey: "driver_name" }, header: t("colDriver"), cell: ({ row }) => row.original.driver.name },
      { id: "vehicle", header: t("colVehicle"), cell: ({ row }) => <span className="font-mono text-xs">{row.original.vehicle.registration_number}</span> },
      {
        id: "status", meta: { sortKey: "status" },
        header: t("colStatus"),
        cell: ({ row }) => (
          <div className="flex items-center gap-1.5">
            <StatusBadge status={tripTone(row.original.status)} label={label(row.original.status)} />
            {row.original.fare_review_required ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <TriangleAlert className="size-4 text-warning" aria-label={t("flagged")} />
                </TooltipTrigger>
                <TooltipContent>{t("flagged")}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        ),
      },
      { id: "accepted", meta: { sortKey: "accepted_at" }, header: t("colStarted"), cell: ({ row }) => <DateTime value={row.original.accepted_at} relative /> },
      { id: "distance", meta: { sortKey: "distance" }, header: t("colDistance"), cell: ({ row }) => <span className="tabular">{formatDistance(row.original.distance_m)}</span> },
      {
        id: "fare", meta: { sortKey: "fare" },
        header: t("colFare"),
        cell: ({ row }) => <Money value={row.original.final_fare ?? row.original.estimated_fare} className={row.original.final_fare === null ? "text-muted-foreground" : "font-medium"} />,
      },
    ],
    [t, label],
  );

  return (
    <div className="space-y-3">
      <Toolbar filterKeys={["q"]}>
        <ToolbarSearch placeholder={t("searchPlaceholder")} />
      </Toolbar>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        getRowHref={(r) => `/trips/${r.id}`}
        pending={pending}
        caption={t("title")}
        empty={<EmptyState icon={CarFront} title={t("empty")} />}
      />
      <CursorPagination nextCursor={nextCursor} />
    </div>
  );
}
