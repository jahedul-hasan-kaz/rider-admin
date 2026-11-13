"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Star, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { CursorPagination } from "@/components/data-table/cursor-pagination";
import { DataTable } from "@/components/data-table/data-table";
import { Toolbar, ToolbarSearch } from "@/components/data-table/toolbar";
import { useUrlParams } from "@/components/data-table/use-url-params";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { cn } from "@/lib/utils";
import type { DriverRow, DriverTab } from "@/server/queries/supply";

export function AvailabilityDot({ availability }: { availability: string }) {
  const label = useStatusLabel();
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span
        className={cn(
          "size-2 rounded-full",
          availability === "online" && "bg-success",
          availability === "on_trip" && "bg-info",
          availability === "offline" && "bg-muted-foreground/40",
        )}
        aria-hidden
      />
      {label(availability)}
    </span>
  );
}

export function DriversTable({ rows, nextCursor, tab }: { rows: DriverRow[]; nextCursor: string | null; tab: DriverTab }) {
  const t = useTranslations("drivers");
  const label = useStatusLabel();
  const { pending } = useUrlParams();

  const columns = useMemo<ColumnDef<DriverRow, unknown>[]>(
    () => [
      {
        id: "driver", meta: { sortKey: "full_name" },
        header: t("colDriver"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate font-medium">{row.original.full_name}</p>
            <p className="font-mono text-xs text-muted-foreground tabular">{row.original.phone_masked ?? "—"}</p>
          </div>
        ),
      },
      {
        id: "status", meta: { sortKey: "status" },
        header: t("colStatus"),
        cell: ({ row }) => <StatusBadge status={row.original.onboarding_status} label={label(row.original.onboarding_status)} />,
      },
      { id: "availability", header: t("colAvailability"), cell: ({ row }) => <AvailabilityDot availability={row.original.availability} /> },
      {
        id: "vehicle",
        header: t("colVehicle"),
        cell: ({ row }) =>
          row.original.vehicle ? (
            <div>
              <p className="font-mono text-xs">{row.original.vehicle.registration_number}</p>
              <p className="text-xs text-muted-foreground">{row.original.vehicle.category}</p>
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      { id: "zone", header: t("colZone"), cell: ({ row }) => row.original.zone?.name ?? <span className="text-muted-foreground">—</span> },
      {
        id: "rating", meta: { sortKey: "rating" },
        header: t("colRating"),
        cell: ({ row }) =>
          row.original.rating_avg != null ? (
            <span className="inline-flex items-center gap-1 tabular">
              <Star className="size-3.5 fill-warning text-warning" aria-hidden />
              {row.original.rating_avg.toFixed(2)}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "date", meta: { sortKey: tab === "applications" ? "submitted_at" : "created_at" },
        header: tab === "applications" ? t("colSubmitted") : t("colJoined"),
        cell: ({ row }) => (
          <DateTime value={tab === "applications" ? row.original.submitted_at : row.original.created_at} relative />
        ),
      },
    ],
    [t, label, tab],
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
        getRowHref={(r) => `/drivers/${r.id}`}
        pending={pending}
        caption={t("title")}
        empty={<EmptyState icon={UserRound} title={tab === "applications" ? t("emptyApplications") : t("empty")} />}
      />
      <CursorPagination nextCursor={nextCursor} />
    </div>
  );
}
