"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Route as RouteIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { CursorPagination } from "@/components/data-table/cursor-pagination";
import { DataTable } from "@/components/data-table/data-table";
import { Toolbar, ToolbarSearch, ToolbarSelect } from "@/components/data-table/toolbar";
import { useUrlParams } from "@/components/data-table/use-url-params";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { Money } from "@/components/domain/money";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { formatDuration } from "@/lib/format";
import { REQUEST_STATUSES } from "@/lib/ride-constants";
import type { RequestRow } from "@/server/queries/rides";
import { tripTone } from "../trips/trips-table";

export function requestTone(status: string): string {
  if (status === "searching") return "searching";
  if (status === "matched") return "in_progress";
  return tripTone(status);
}

export function RequestsTable({ rows, nextCursor }: { rows: RequestRow[]; nextCursor: string | null }) {
  const t = useTranslations("requests");
  const label = useStatusLabel();
  const { pending } = useUrlParams();

  const columns = useMemo<ColumnDef<RequestRow, unknown>[]>(
    () => [
      {
        id: "request",
        header: t("colRequest"),
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.id.slice(0, 8)}</span>,
      },
      { id: "passenger", meta: { sortKey: "passenger_name" }, header: t("colPassenger"), cell: ({ row }) => row.original.passenger.name },
      { id: "category", header: t("colCategory"), cell: ({ row }) => row.original.category },
      {
        id: "route",
        header: t("colRoute"),
        cell: ({ row }) => (
          <span className="block max-w-56 truncate text-xs text-muted-foreground">
            {t("route", { from: row.original.pickup_label ?? "—", to: row.original.destination_label ?? "—" })}
          </span>
        ),
      },
      {
        id: "status", meta: { sortKey: "status" },
        header: t("colStatus"),
        cell: ({ row }) => <StatusBadge status={requestTone(row.original.status)} label={label(row.original.status)} />,
      },
      { id: "requested", meta: { sortKey: "requested_at" }, header: t("colRequested"), cell: ({ row }) => <DateTime value={row.original.requested_at} relative /> },
      { id: "wait", header: t("colWait"), cell: ({ row }) => <span className="tabular">{formatDuration(row.original.wait_s)}</span> },
      { id: "offers", header: t("colOffers"), cell: ({ row }) => <span className="tabular">{row.original.offers_sent}</span> },
      { id: "fare", meta: { sortKey: "estimated_fare" }, header: t("estimatedFare"), cell: ({ row }) => <Money value={row.original.estimated_fare} /> },
    ],
    [t, label],
  );

  return (
    <div className="space-y-3">
      <Toolbar filterKeys={["q", "status"]}>
        <ToolbarSearch placeholder={t("searchPlaceholder")} />
        <ToolbarSelect param="status" allLabel={t("allStatuses")} options={REQUEST_STATUSES.map((s) => ({ value: s, label: label(s) }))} />
      </Toolbar>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        getRowHref={(r) => `/requests/${r.id}`}
        pending={pending}
        caption={t("title")}
        empty={<EmptyState icon={RouteIcon} title={t("empty")} />}
      />
      <CursorPagination nextCursor={nextCursor} />
    </div>
  );
}
