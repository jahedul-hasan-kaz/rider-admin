"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Check, HandCoins, UserCheck, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table/data-table";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { FormDialog } from "@/components/domain/form-dialog";
import { Money } from "@/components/domain/money";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { useCan } from "@/components/permissions-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createPayoutBatch, reviewPayoutAccount } from "@/server/actions/finance";
import type { PayoutAccount, PayoutBatch } from "@/server/queries/finance";

export function CreateBatchButton() {
  const t = useTranslations("payouts");
  const can = useCan();
  const router = useRouter();
  const [notes, setNotes] = useState("");
  if (!can("payouts.create")) return null;
  return (
    <FormDialog
      trigger={
        <Button>
          <HandCoins className="size-4" />
          {t("createBatch")}
        </Button>
      }
      title={t("createTitle")}
      description={t("createBody")}
      confirmLabel={t("createConfirm")}
      successMessage={t("created")}
      onSubmit={() => createPayoutBatch({ notes: notes || undefined })}
      onSuccess={() => router.refresh()}
      onClose={() => setNotes("")}
    >
      {() => (
        <Field>
          <FieldLabel htmlFor="batch-notes">{t("notes")}</FieldLabel>
          <Input id="batch-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        </Field>
      )}
    </FormDialog>
  );
}

export function BatchesTable({ rows }: { rows: PayoutBatch[] }) {
  const t = useTranslations("payouts");
  const label = useStatusLabel();
  const columns = useMemo<ColumnDef<PayoutBatch, unknown>[]>(
    () => [
      { id: "date", header: t("colCreated"), cell: ({ row }) => <DateTime value={row.original.created_at} relative /> },
      { id: "by", header: t("colCreatedBy"), cell: ({ row }) => row.original.created_by_name ?? "—" },
      { id: "count", header: t("colDrivers"), cell: ({ row }) => <span className="tabular">{row.original.payout_count}</span> },
      { id: "total", header: t("colTotal"), cell: ({ row }) => <Money value={row.original.total_amount} className="font-medium" /> },
      {
        id: "progress",
        header: t("colProgress"),
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground tabular">
            {t("progress", { paid: row.original.counts.paid, total: row.original.payout_count, failed: row.original.counts.failed })}
          </span>
        ),
      },
      { id: "status", header: t("colStatus"), cell: ({ row }) => <StatusBadge status={row.original.status} label={label(row.original.status)} /> },
    ],
    [t, label],
  );
  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      getRowHref={(r) => `/payouts/${r.id}`}
      caption={t("title")}
      empty={<EmptyState icon={HandCoins} title={t("emptyBatches")} />}
    />
  );
}

export function AccountsList({ rows }: { rows: PayoutAccount[] }) {
  const t = useTranslations("payouts");
  const can = useCan();
  const router = useRouter();
  const [pending, start] = useTransition();

  function review(id: string, approve: boolean) {
    start(async () => {
      const result = await reviewPayoutAccount({ id, approve, note: approve ? undefined : t("rejectedNote") });
      if (result.ok) {
        toast.success(approve ? t("accountVerified") : t("accountRejected"));
        router.refresh();
      } else {
        toast.error(t("accountError"));
      }
    });
  }

  if (rows.length === 0) return <EmptyState icon={UserCheck} title={t("emptyAccounts")} />;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rows.map((a) => (
        <Card key={a.id}>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{a.driver_name ?? "—"}</p>
                <p className="text-sm text-muted-foreground">
                  <span className="capitalize">{a.method}</span> · {a.masked} · {a.account_holder}
                </p>
              </div>
              <DateTime value={a.created_at} relative />
            </div>
            {can("payouts.approve") ? (
              <div className="flex justify-end gap-2 border-t pt-3">
                <Button variant="outline" size="sm" className="text-destructive" disabled={pending} onClick={() => review(a.id, false)}>
                  <X className="size-4" />
                  {t("reject")}
                </Button>
                <Button size="sm" disabled={pending} onClick={() => review(a.id, true)}>
                  <Check className="size-4" />
                  {t("verify")}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
