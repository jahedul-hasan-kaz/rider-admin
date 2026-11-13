"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Banknote, CheckCheck, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { CursorPagination } from "@/components/data-table/cursor-pagination";
import { DataTable } from "@/components/data-table/data-table";
import { Toolbar, ToolbarSearch } from "@/components/data-table/toolbar";
import { useUrlParams } from "@/components/data-table/use-url-params";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { FormDialog } from "@/components/domain/form-dialog";
import { Money } from "@/components/domain/money";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { ConfirmCashButton } from "@/components/domain/crud-dialogs";
import { useCan } from "@/components/permissions-provider";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEPOSIT_METHODS } from "@/lib/schemas/finance";
import { reconcilePayments, recordCashDeposit } from "@/server/actions/finance";
import type { DriverDue, PaymentRow } from "@/server/queries/finance";

export function PaymentsTable({ rows, nextCursor }: { rows: PaymentRow[]; nextCursor: string | null }) {
  const t = useTranslations("payments");
  const label = useStatusLabel();
  const { pending } = useUrlParams();

  const columns = useMemo<ColumnDef<PaymentRow, unknown>[]>(
    () => [
      { id: "trip", header: t("colTrip"), cell: ({ row }) => <span className="font-mono text-xs">{row.original.trip_id.slice(0, 8)}</span> },
      { id: "passenger", meta: { sortKey: "passenger_name" }, header: t("colPassenger"), cell: ({ row }) => row.original.passenger_name ?? "—" },
      { id: "driver", header: t("colDriver"), cell: ({ row }) => row.original.driver_name ?? "—" },
      { id: "method", meta: { sortKey: "method" }, header: t("colMethod"), cell: ({ row }) => <span className="capitalize">{row.original.method}</span> },
      { id: "amount", meta: { sortKey: "amount" }, header: t("colAmount"), cell: ({ row }) => <Money value={row.original.amount} className="font-medium" /> },
      {
        id: "status", meta: { sortKey: "status" },
        header: t("colStatus"),
        cell: ({ row }) => <StatusBadge status={row.original.status} label={label(row.original.status)} />,
      },
      {
        id: "refunded",
        header: t("colRefunded"),
        cell: ({ row }) => (row.original.refunded_amount > 0 ? <Money value={row.original.refunded_amount} /> : <span className="text-muted-foreground">—</span>),
      },
      {
        id: "reconciled",
        header: t("colReconciled"),
        cell: ({ row }) =>
          row.original.reconciled_at ? <DateTime value={row.original.reconciled_at} relative /> : <span className="text-muted-foreground">{t("reconciledNo")}</span>,
      },
      { id: "date", meta: { sortKey: "created_at" }, header: t("colDate"), cell: ({ row }) => <DateTime value={row.original.created_at} relative /> },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          row.original.method === "cash" && row.original.status === "pending" ? (
            // Keep the click on the button, not the row link.
            <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
              <ConfirmCashButton tripId={row.original.trip_id} amount={row.original.amount} />
            </span>
          ) : null,
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
        getRowHref={(r) => `/trips/${r.trip_id}`}
        pending={pending}
        caption={t("title")}
        empty={<EmptyState icon={Banknote} title={t("empty")} />}
      />
      <CursorPagination nextCursor={nextCursor} />
    </div>
  );
}

/** Marks every payment on the current page as reconciled (they were just verified against the cash and gateway reports). */
export function ReconcileButton({ payments }: { payments: PaymentRow[] }) {
  const t = useTranslations("payments");
  const can = useCan();
  const router = useRouter();
  const [note, setNote] = useState("");
  const eligible = payments.filter((p) => !p.reconciled_at && ["succeeded", "partially_refunded", "refunded"].includes(p.status));
  const total = eligible.reduce((sum, p) => sum + p.amount, 0);
  if (!can("payments.reconcile") || eligible.length === 0) return null;
  return (
    <FormDialog
      trigger={
        <Button>
          <CheckCheck className="size-4" />
          {t("reconcile", { count: eligible.length })}
        </Button>
      }
      title={t("reconcileTitle")}
      description={t("reconcileBody", { count: eligible.length, total: total.toLocaleString() })}
      confirmLabel={t("reconcileConfirm")}
      successMessage={t("reconciled")}
      onSubmit={() => reconcilePayments({ paymentIds: eligible.map((p) => p.id), note: note || undefined })}
      onSuccess={() => router.refresh()}
      onClose={() => setNote("")}
    >
      {() => (
        <Field>
          <FieldLabel htmlFor="reconcile-note">{t("reconcileNote")}</FieldLabel>
          <Input id="reconcile-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
      )}
    </FormDialog>
  );
}

export function DuesTable({ rows }: { rows: DriverDue[] }) {
  const t = useTranslations("payments");
  const can = useCan();

  const columns = useMemo<ColumnDef<DriverDue, unknown>[]>(
    () => [
      { id: "driver", header: t("colDriver"), cell: ({ row }) => <span className="font-medium">{row.original.driver_name ?? "—"}</span> },
      { id: "balance", header: t("colOwed"), cell: ({ row }) => <Money value={Math.abs(row.original.balance)} className="font-medium text-danger" /> },
      {
        id: "last",
        header: t("colLastDeposit"),
        cell: ({ row }) => (row.original.last_deposit_at ? <DateTime value={row.original.last_deposit_at} relative /> : <span className="text-muted-foreground">{t("noDeposit")}</span>),
      },
      {
        id: "action",
        header: "",
        cell: ({ row }) => (can("payments.reconcile") ? <DepositDialog driver={row.original} /> : null),
      },
    ],
    [t, can],
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      getRowId={(r) => r.driver_id}
      caption={t("tabDues")}
      empty={<EmptyState icon={Wallet} title={t("duesEmpty")} />}
    />
  );
}

function DepositDialog({ driver }: { driver: DriverDue }) {
  const t = useTranslations("payments");
  const router = useRouter();
  const [amount, setAmount] = useState(String(Math.abs(driver.balance)));
  const [method, setMethod] = useState<(typeof DEPOSIT_METHODS)[number]>("office");
  const [reference, setReference] = useState("");
  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0;
  return (
    <FormDialog
      trigger={
        <Button variant="outline" size="sm" onClick={(e) => e.stopPropagation()}>
          {t("recordDeposit")}
        </Button>
      }
      title={t("depositTitle", { name: driver.driver_name ?? "" })}
      description={t("depositBody")}
      confirmLabel={t("recordDeposit")}
      valid={valid}
      successMessage={t("depositSaved")}
      onSubmit={() => recordCashDeposit({ driverId: driver.driver_id, amount: value, method, reference: reference || undefined })}
      onSuccess={() => router.refresh()}
    >
      {(errors) => (
        <div className="space-y-3">
          <Field data-invalid={Boolean(errors.amount) || undefined}>
            <FieldLabel htmlFor={`dep-amount-${driver.driver_id}`}>{t("depositAmount")}</FieldLabel>
            <Input id={`dep-amount-${driver.driver_id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            {errors.amount ? <FieldError>{errors.amount}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel>{t("depositMethod")}</FieldLabel>
            <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEPOSIT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`method_${m}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor={`dep-ref-${driver.driver_id}`}>{t("depositReference")}</FieldLabel>
            <Input id={`dep-ref-${driver.driver_id}`} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
          </Field>
        </div>
      )}
    </FormDialog>
  );
}
