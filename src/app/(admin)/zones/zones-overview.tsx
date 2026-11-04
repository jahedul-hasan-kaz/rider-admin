"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { StatusBadge } from "@/components/domain/status-badge";
import { ZoneMap, type MapZone } from "@/components/domain/zone-map";
import type { ZoneGeometry } from "@/lib/geo";
import type { Zone } from "@/server/queries/supply";
import { MapPinned } from "lucide-react";

export function ZonesOverview({ zones }: { zones: Zone[] }) {
  const t = useTranslations("zones");
  const mapZones: MapZone[] = useMemo(
    () => zones.map((z) => ({ id: z.id, name: z.name, active: z.active, boundary: z.boundary as ZoneGeometry })),
    [zones],
  );

  const columns = useMemo<ColumnDef<Zone, unknown>[]>(
    () => [
      {
        id: "name",
        header: t("colName"),
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.name}</p>
            <code className="text-xs text-muted-foreground">{row.original.code}</code>
          </div>
        ),
      },
      {
        id: "area",
        header: t("colArea"),
        cell: ({ row }) => (
          <span className="tabular">
            {row.original.area_km2.toLocaleString(undefined, { maximumFractionDigits: 1 })} {t("areaUnit")}
          </span>
        ),
      },
      { id: "drivers", header: t("colDrivers"), cell: ({ row }) => <span className="tabular">{row.original.online_drivers}</span> },
      {
        id: "status",
        header: t("colStatus"),
        cell: ({ row }) => (
          <StatusBadge status={row.original.active ? "active" : "inactive"} label={row.original.active ? t("active") : t("inactive")} />
        ),
      },
      { id: "updated", header: t("colUpdated"), cell: ({ row }) => <DateTime value={row.original.updated_at} relative /> },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <ZoneMap zones={mapZones} />
      <DataTable
        columns={columns}
        data={zones}
        getRowId={(z) => z.id}
        getRowHref={(z) => `/zones/${z.id}`}
        caption={t("title")}
        empty={<EmptyState icon={MapPinned} title={t("empty")} />}
      />
    </div>
  );
}
