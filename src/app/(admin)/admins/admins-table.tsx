"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ShieldCheck, ShieldOff, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { Toolbar, ToolbarSearch, ToolbarSelect } from "@/components/data-table/toolbar";
import { useUrlParams } from "@/components/data-table/use-url-params";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { StatusBadge } from "@/components/domain/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { initials } from "@/lib/format";
import type { AdminRow } from "@/server/queries/admins";

export function AdminsTable({ rows, currentAdminId }: { rows: AdminRow[]; currentAdminId: string }) {
  const t = useTranslations();
  const { pending } = useUrlParams();

  const columns = useMemo<ColumnDef<AdminRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: t("admins.colName"),
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar className="size-8">
              <AvatarFallback className="text-xs">{initials(row.original.full_name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate font-medium">
                {row.original.full_name}
                {row.original.id === currentAdminId ? (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">({t("admins.you")})</span>
                ) : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">{row.original.email}</p>
            </div>
          </div>
        ),
      },
      {
        id: "templates",
        header: t("admins.colTemplates"),
        cell: ({ row }) => (
          <div className="flex max-w-80 flex-wrap gap-1">
            {row.original.templates.map((tpl) => (
              <Badge key={tpl.id} variant={tpl.code === "super_admin" ? "default" : "secondary"}>
                {tpl.name}
              </Badge>
            ))}
            {row.original.override_count > 0 ? (
              <Badge variant="outline">{t("admins.extraPermissions", { count: row.original.override_count })}</Badge>
            ) : null}
            {row.original.templates.length === 0 && row.original.override_count === 0 ? (
              <span className="text-xs text-muted-foreground">{t("common.none")}</span>
            ) : null}
          </div>
        ),
      },
      {
        id: "mfa",
        header: t("admins.colMfa"),
        cell: ({ row }) =>
          row.original.mfa_enrolled_at ? (
            <span className="inline-flex items-center gap-1 text-sm text-success">
              <ShieldCheck className="size-4" aria-hidden /> {t("admins.mfaOn")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-sm text-warning">
              <ShieldOff className="size-4" aria-hidden /> {t("admins.mfaOff")}
            </span>
          ),
      },
      {
        id: "last_login",
        header: t("admins.colLastLogin"),
        cell: ({ row }) => <DateTime value={row.original.last_login_at} relative />,
      },
      {
        id: "status",
        header: t("admins.colStatus"),
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.status}
            label={t(`common.status${row.original.status[0]!.toUpperCase()}${row.original.status.slice(1)}`)}
          />
        ),
      },
    ],
    [t, currentAdminId],
  );

  return (
    <div className="space-y-3">
      <Toolbar filterKeys={["q", "status"]}>
        <ToolbarSearch placeholder={t("admins.searchPlaceholder")} />
        <ToolbarSelect
          param="status"
          allLabel={t("admins.allStatuses")}
          options={[
            { value: "active", label: t("common.statusActive") },
            { value: "suspended", label: t("common.statusSuspended") },
          ]}
        />
      </Toolbar>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        getRowHref={(r) => `/admins/${r.id}`}
        pending={pending}
        caption={t("admins.title")}
        empty={<EmptyState icon={Users} title={t("admins.emptyTitle")} />}
      />
    </div>
  );
}
