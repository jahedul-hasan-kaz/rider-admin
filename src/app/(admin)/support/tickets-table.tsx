"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Clock, LifeBuoy, UserCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useCan } from "@/components/permissions-provider";
import { assignTicketsToMe } from "@/server/actions/finance";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { CursorPagination } from "@/components/data-table/cursor-pagination";
import { DataTable } from "@/components/data-table/data-table";
import { Toolbar, ToolbarSearch } from "@/components/data-table/toolbar";
import { useUrlParams } from "@/components/data-table/use-url-params";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import type { TicketRow } from "@/server/queries/care";

export function TicketsTable({ rows, nextCursor }: { rows: TicketRow[]; nextCursor: string | null }) {
  const t = useTranslations("support");
  const label = useStatusLabel();
  const { pending } = useUrlParams();
  const can = useCan();
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [assigning, startAssign] = useTransition();
  const canAssign = can("support.assign");
  const toggle = (id: string, on: boolean) => setSelected((prev) => (on ? [...prev, id] : prev.filter((x) => x !== id)));

  function assign() {
    startAssign(async () => {
      const result = await assignTicketsToMe({ ids: selected });
      if (result.ok) {
        toast.success(t("bulkAssigned", { count: result.data.count }));
        setSelected([]);
        router.refresh();
      } else {
        toast.error(t("actionFailed"));
      }
    });
  }

  const columns = useMemo<ColumnDef<TicketRow, unknown>[]>(
    () => [
      ...(canAssign
        ? [
            {
              id: "select",
              header: "",
              cell: ({ row }: { row: { original: TicketRow } }) => (
                <Checkbox
                  checked={selected.includes(row.original.id)}
                  onCheckedChange={(v) => toggle(row.original.id, v === true)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={t("selectTicket", { no: row.original.ticket_no })}
                />
              ),
            } satisfies ColumnDef<TicketRow, unknown>,
          ]
        : []),
      {
        id: "ticket", meta: { sortKey: "ticket_no" },
        header: t("colTicket"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="max-w-80 truncate font-medium">
              <span className="text-muted-foreground tabular">#{row.original.ticket_no}</span> {row.original.subject}
            </p>
            <p className="text-xs text-muted-foreground capitalize">{t(`cat_${row.original.category}`)}</p>
          </div>
        ),
      },
      {
        id: "requester",
        header: t("colRequester"),
        cell: ({ row }) => (
          <div>
            <p>{row.original.requester_name ?? "—"}</p>
            <p className="text-xs text-muted-foreground capitalize">{row.original.requester_role}</p>
          </div>
        ),
      },
      { id: "priority", meta: { sortKey: "priority" }, header: t("colPriority"), cell: ({ row }) => <StatusBadge status={row.original.priority} label={label(row.original.priority)} /> },
      { id: "status", meta: { sortKey: "status" }, header: t("colStatus"), cell: ({ row }) => <StatusBadge status={row.original.status} label={label(row.original.status)} /> },
      { id: "assignee", header: t("colAssignee"), cell: ({ row }) => row.original.assignee_name ?? <span className="text-muted-foreground">{t("unassigned")}</span> },
      {
        id: "sla", meta: { sortKey: "sla_due_at" },
        header: t("colSla"),
        cell: ({ row }) =>
          row.original.sla_breached ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-danger">
              <Clock className="size-3.5" aria-hidden />
              {t("breached")}
            </span>
          ) : (
            <DateTime value={row.original.sla_due_at} relative />
          ),
      },
      { id: "updated", meta: { sortKey: "updated_at" }, header: t("colUpdated"), cell: ({ row }) => <DateTime value={row.original.updated_at} relative /> },
    ],
     
    [t, label, canAssign, selected],
  );

  return (
    <div className="space-y-3">
      <Toolbar filterKeys={["q"]}>
        <ToolbarSearch placeholder={t("searchPlaceholder")} />
        {selected.length > 0 ? (
          <Button size="sm" onClick={assign} disabled={assigning}>
            <UserCheck className="size-4" />
            {t("assignSelected", { count: selected.length })}
          </Button>
        ) : null}
      </Toolbar>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        getRowHref={(r) => `/support/${r.id}`}
        pending={pending}
        caption={t("title")}
        empty={<EmptyState icon={LifeBuoy} title={t("empty")} />}
      />
      <CursorPagination nextCursor={nextCursor} />
    </div>
  );
}
