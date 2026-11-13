"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Check, HandCoins, Send, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { DataTable } from "@/components/data-table/data-table";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { FormDialog } from "@/components/domain/form-dialog";
import { Money } from "@/components/domain/money";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { Stat, StatGrid } from "@/components/domain/stat";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { useCan } from "@/components/permissions-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorKey } from "@/lib/action-errors";
import { approvePayoutBatch, cancelPayoutBatch, failPayout, markPayoutPaid } from "@/server/actions/finance";
import type { PayoutBatchDetail } from "@/server/queries/finance";

type Payout = PayoutBatchDetail["payouts"][number];

export function BatchBadge({ status }: { status: string }) {
  const label = useStatusLabel();
  return <StatusBadge status={status} label={label(status)} />;
}

export function BatchActions({ batch }: { batch: PayoutBatchDetail }) {
  const t = useTranslations("payouts");
  const tErr = useTranslations("errors");
  const can = useCan();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (batch.status !== "pending") return null;

  function approve() {
    start(async () => {
      const result = await approvePayoutBatch({ id: batch.id });
      if (result.ok) {
        toast.success(t("approved"));
        router.refresh();
      } else {
        toast.error(tErr(errorKey(result.error.code)));
      }
    });
  }

  return (
    <>
      {can("payouts.create") ? (
        <ReasonDialog
          trigger={<Button variant="outline">{t("cancelBatch")}</Button>}
          title={t("cancelTitle")}
          description={t("cancelBody")}
          confirmLabel={t("cancelBatch")}
          destructive
          successMessage={t("cancelled")}
          onConfirm={(reason) => cancelPayoutBatch({ id: batch.id, reason })}
          onSuccess={() => router.refresh()}
        />
      ) : null}
      {can("payouts.approve") ? (
        <Button onClick={approve} disabled={pending}>
          <Check className="size-4" />
          {t("approveBatch")}
        </Button>
      ) : null}
    </>
  );
}

export function BatchBody({ batch }: { batch: PayoutBatchDetail }) {
  const t = useTranslations("payouts");
  const label = useStatusLabel();
  const can = useCan();
  const router = useRouter();

  const columns = useMemo<ColumnDef<Payout, unknown>[]>(
    () => [
      { id: "driver", header: t("colDriver"), cell: ({ row }) => <span className="font-medium">{row.original.driver_name ?? "—"}</span> },
      {
        id: "account",
        header: t("colAccount"),
        cell: ({ row }) => (
          <span className="text-sm">
            <span className="capitalize">{row.original.method}</span> · {row.original.masked}
          </span>
        ),
      },
      { id: "amount", header: t("colAmount"), cell: ({ row }) => <Money value={row.original.amount} className="font-medium" /> },
      {
        id: "status",
        header: t("colStatus"),
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <StatusBadge status={row.original.status} label={label(row.original.status)} />
            {row.original.failure_reason ? <p className="max-w-56 text-xs text-muted-foreground">{row.original.failure_reason}</p> : null}
          </div>
        ),
      },
      {
        id: "reference",
        header: t("colReference"),
        cell: ({ row }) =>
          row.original.reference ? (
            <div>
              <p className="font-mono text-xs">{row.original.reference}</p>
              <DateTime value={row.original.paid_at} relative />
            </div>
          ) : (
            "—"
          ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          row.original.status === "approved" && can("payouts.approve") ? (
            <div className="flex justify-end gap-2">
              <FailDialog payout={row.original} onDone={() => router.refresh()} />
              <PaidDialog payout={row.original} onDone={() => router.refresh()} />
            </div>
          ) : null,
      },
    ],
    [t, label, can, router],
  );

  return (
    <div className="space-y-4">
      <StatGrid>
        <Stat label={t("statTotal")}>{batch.total_amount.toLocaleString()}</Stat>
        <Stat label={t("statPaid")} tone="success">
          {batch.counts.paid}
        </Stat>
        <Stat label={t("statWaiting")}>{batch.counts.pending + batch.counts.approved}</Stat>
        <Stat label={t("statFailed")} tone={batch.counts.failed > 0 ? "danger" : undefined}>
          {batch.counts.failed}
        </Stat>
      </StatGrid>
      {batch.status === "pending" ? (
        <Alert>
          <TriangleAlert className="size-4" />
          <AlertDescription>{t("makerChecker", { name: batch.created_by_name ?? "—" })}</AlertDescription>
        </Alert>
      ) : null}
      <DataTable
        columns={columns}
        data={batch.payouts}
        getRowId={(r) => r.id}
        caption={t("batchTitle")}
        empty={<EmptyState icon={HandCoins} title={t("emptyBatches")} />}
      />
    </div>
  );
}

function PaidDialog({ payout, onDone }: { payout: Payout; onDone: () => void }) {
  const t = useTranslations("payouts");
  const [reference, setReference] = useState("");
  return (
    <FormDialog
      trigger={
        <Button size="sm">
          <Send className="size-4" />
          {t("markPaid")}
        </Button>
      }
      title={t("paidTitle", { name: payout.driver_name ?? "" })}
      description={t("paidBody", { amount: payout.amount.toLocaleString(), method: payout.method, masked: payout.masked })}
      confirmLabel={t("markPaid")}
      valid={reference.trim().length > 0}
      successMessage={t("paid")}
      onSubmit={() => markPayoutPaid({ payoutId: payout.id, reference })}
      onSuccess={onDone}
      onClose={() => setReference("")}
    >
      {(errors) => (
        <Field data-invalid={Boolean(errors.reference) || undefined}>
          <FieldLabel htmlFor={`ref-${payout.id}`}>{t("transferReference")}</FieldLabel>
          <Input id={`ref-${payout.id}`} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} autoFocus />
        </Field>
      )}
    </FormDialog>
  );
}

function FailDialog({ payout, onDone }: { payout: Payout; onDone: () => void }) {
  const t = useTranslations("payouts");
  return (
    <ReasonDialog
      trigger={
        <Button variant="outline" size="sm" className="text-destructive">
          {t("markFailed")}
        </Button>
      }
      title={t("failTitle", { name: payout.driver_name ?? "" })}
      description={t("failBody")}
      confirmLabel={t("markFailed")}
      destructive
      presets={["Wallet number was invalid", "Transfer was rejected by the provider"]}
      successMessage={t("failed")}
      onConfirm={(reason) => failPayout({ payoutId: payout.id, reason })}
      onSuccess={onDone}
    />
  );
}
