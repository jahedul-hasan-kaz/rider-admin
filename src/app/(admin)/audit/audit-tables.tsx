"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ScrollText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";
import { CursorPagination } from "@/components/data-table/cursor-pagination";
import { DataTable } from "@/components/data-table/data-table";
import { Toolbar, ToolbarSearch, ToolbarSelect } from "@/components/data-table/toolbar";
import { useUrlParams } from "@/components/data-table/use-url-params";
import { CopyButton } from "@/components/domain/copy-button";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { JsonDiff } from "@/components/domain/json-diff";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AuditRow, ChangeRow } from "@/server/queries/audit";

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-center gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all">{children}</dd>
    </div>
  );
}

export function AuditActionsTable({ rows, nextCursor }: { rows: AuditRow[]; nextCursor: number | null }) {
  const t = useTranslations("audit");
  const { pending } = useUrlParams();
  const [selected, setSelected] = useState<AuditRow | null>(null);

  const columns = useMemo<ColumnDef<AuditRow, unknown>[]>(
    () => [
      { id: "time", header: t("colTime"), cell: ({ row }) => <DateTime value={row.original.created_at} /> },
      { id: "admin", header: t("colAdmin"), cell: ({ row }) => row.original.admin_name ?? t("system") },
      {
        id: "action",
        header: t("colAction"),
        cell: ({ row }) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{row.original.action}</code>,
      },
      {
        id: "entity",
        header: t("colEntity"),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.entity_type}
            {row.original.entity_id ? ` · ${row.original.entity_id.slice(0, 8)}` : ""}
          </span>
        ),
      },
      {
        id: "reason",
        header: t("colReason"),
        cell: ({ row }) => <span className="line-clamp-1 max-w-72 text-sm">{row.original.reason ?? "—"}</span>,
      },
    ],
    [t],
  );

  return (
    <div className="space-y-3">
      <Toolbar filterKeys={["q"]}>
        <ToolbarSearch placeholder={t("filterAction")} />
      </Toolbar>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => String(r.id)}
        onRowClick={setSelected}
        pending={pending}
        caption={t("tabActions")}
        empty={<EmptyState icon={ScrollText} title={t("emptyTitle")} />}
      />
      <CursorPagination nextCursor={nextCursor} />

      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-base">{selected.action}</SheetTitle>
                <SheetDescription>{t("detailTitle")}</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6">
                <dl className="space-y-2">
                  <Meta label={t("colTime")}>
                    <DateTime value={selected.created_at} />
                  </Meta>
                  <Meta label={t("colAdmin")}>{selected.admin_name ?? t("system")}</Meta>
                  <Meta label={t("colEntity")}>
                    {selected.entity_type} {selected.entity_id}
                  </Meta>
                  <Meta label={t("colReason")}>{selected.reason ?? "—"}</Meta>
                  <Meta label={t("ip")}>{selected.ip ?? "—"}</Meta>
                  <Meta label={t("requestId")}>
                    {selected.request_id ? (
                      <span className="inline-flex items-center gap-1 font-mono text-xs">
                        {selected.request_id}
                        <CopyButton value={selected.request_id} />
                      </span>
                    ) : (
                      "—"
                    )}
                  </Meta>
                </dl>
                {selected.before || selected.after ? (
                  <JsonDiff
                    before={selected.before}
                    after={selected.after}
                    labels={{ field: t("changedFields"), before: t("before"), after: t("after") }}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">{t("noDetails")}</p>
                )}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function ChangeLogTable({ rows, nextCursor, tables }: { rows: ChangeRow[]; nextCursor: number | null; tables: string[] }) {
  const t = useTranslations("audit");
  const { pending } = useUrlParams();
  const [selected, setSelected] = useState<ChangeRow | null>(null);

  const columns = useMemo<ColumnDef<ChangeRow, unknown>[]>(
    () => [
      { id: "time", header: t("colTime"), cell: ({ row }) => <DateTime value={row.original.created_at} /> },
      { id: "actor", header: t("colAdmin"), cell: ({ row }) => row.original.actor_name ?? t("system") },
      {
        id: "table",
        header: t("colTable"),
        cell: ({ row }) => <code className="font-mono text-xs">{row.original.table_name.replace("public.", "")}</code>,
      },
      {
        id: "op",
        header: t("colOperation"),
        cell: ({ row }) => (
          <Badge variant={row.original.op === "INSERT" ? "secondary" : row.original.op === "DELETE" ? "destructive" : "outline"}>
            {row.original.op}
          </Badge>
        ),
      },
      {
        id: "fields",
        header: t("colFields"),
        cell: ({ row }) => (
          <span className="line-clamp-1 max-w-72 text-xs text-muted-foreground">
            {(row.original.changed_cols ?? []).filter((c) => !["updated_at", "version"].includes(c)).join(", ") || "—"}
          </span>
        ),
      },
    ],
    [t],
  );

  return (
    <div className="space-y-3">
      <Toolbar filterKeys={["table"]}>
        <ToolbarSelect
          param="table"
          allLabel={t("filterTable")}
          options={tables.map((name) => ({ value: name, label: name.replace("public.", "") }))}
        />
      </Toolbar>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => String(r.id)}
        onRowClick={setSelected}
        pending={pending}
        caption={t("tabChanges")}
        empty={<EmptyState icon={ScrollText} title={t("emptyTitle")} />}
      />
      <CursorPagination nextCursor={nextCursor} />

      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected ? (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-base">
                  {selected.op} {selected.table_name}
                </SheetTitle>
                <SheetDescription className="font-mono text-xs">{selected.record_id}</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6">
                <dl className="space-y-2">
                  <Meta label={t("colTime")}>
                    <DateTime value={selected.created_at} />
                  </Meta>
                  <Meta label={t("colAdmin")}>{selected.actor_name ?? t("system")}</Meta>
                  <Meta label={t("requestId")}>{selected.request_id ?? "—"}</Meta>
                </dl>
                <JsonDiff
                  before={selected.old_row}
                  after={selected.new_row}
                  labels={{ field: t("changedFields"), before: t("before"), after: t("after") }}
                />
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
