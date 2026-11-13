"use client";

import { Check, Hourglass, ReceiptText, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { CursorPagination } from "@/components/data-table/cursor-pagination";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { Money } from "@/components/domain/money";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { useCan } from "@/components/permissions-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { errorKey } from "@/lib/action-errors";
import { EditRefundButton } from "@/components/domain/crud-dialogs";
import { cancelRefundRequest, reviewRefund } from "@/server/actions/finance";
import type { RefundRow } from "@/server/queries/finance";

const OPEN = ["requested", "awaiting_second_approval"];

/** One card per request: what, how much, why, and who has signed off so far. */
export function RefundsList({ rows, nextCursor, me }: { rows: RefundRow[]; nextCursor: string | null; me: string }) {
  const t = useTranslations("refunds");
  if (rows.length === 0) return <EmptyState icon={ReceiptText} title={t("empty")} />;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <RefundCard key={r.id} row={r} me={me} />
      ))}
      <CursorPagination nextCursor={nextCursor} />
    </div>
  );
}

function RefundCard({ row, me }: { row: RefundRow; me: string }) {
  const t = useTranslations("refunds");
  const tErr = useTranslations("errors");
  const label = useStatusLabel();
  const can = useCan();
  const router = useRouter();
  const [pending, start] = useTransition();
  const isOpen = OPEN.includes(row.status);
  const approvePermission = row.kind === "refund" ? "refunds.approve" : "ledger.adjust_approve";
  const mine = row.requested_by === me;

  function approve() {
    start(async () => {
      const result = await reviewRefund({ id: row.id, approve: true });
      if (result.ok) {
        toast.success(t("approved"));
        router.refresh();
      } else {
        toast.error(tErr(errorKey(result.error.code)));
      }
    });
  }

  function withdraw() {
    start(async () => {
      const result = await cancelRefundRequest({ id: row.id });
      if (result.ok) {
        toast.success(t("withdrawn"));
        router.refresh();
      } else {
        toast.error(t("errGeneric"));
      }
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{t(`kind_${row.kind}`)}</span>
              <StatusBadge status={row.status} label={label(row.status)} />
              {row.needs_second_approval && isOpen ? (
                <span className="inline-flex items-center gap-1 text-xs text-warning">
                  <Hourglass className="size-3.5" aria-hidden />
                  {t("needsTwo")}
                </span>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">{row.reason}</p>
            <p className="text-xs text-muted-foreground">
              {t("requestedBy", { name: row.requested_by_name ?? "—" })} · <DateTime value={row.created_at} relative />
            </p>
          </div>
          <div className="text-right">
            <Money value={row.amount} className="text-xl font-semibold" />
            {row.kind === "adjustment" ? <p className="text-xs text-muted-foreground">{t(`dir_${row.direction}`)}</p> : null}
          </div>
        </div>

        <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
          {row.passenger_name ? (
            <div>
              <dt className="text-muted-foreground">{t("passenger")}</dt>
              <dd>{row.passenger_name}</dd>
            </div>
          ) : null}
          {row.account_code ? (
            <div className="min-w-0">
              <dt className="text-muted-foreground">{t("account")}</dt>
              <dd className="truncate font-mono">{row.account_code}</dd>
            </div>
          ) : null}
          {row.trip_id ? (
            <div>
              <dt className="text-muted-foreground">{t("trip")}</dt>
              <dd>
                <Link href={`/trips/${row.trip_id}`} className="font-mono underline-offset-2 hover:underline">
                  {row.trip_id.slice(0, 8)}
                </Link>
              </dd>
            </div>
          ) : null}
          {row.reverses_transaction_id ? (
            <div>
              <dt className="text-muted-foreground">{t("reverses")}</dt>
              <dd>
                <Link href={`/ledger/transactions/${row.reverses_transaction_id}`} className="underline-offset-2 hover:underline">
                  {t("viewTransaction")}
                </Link>
              </dd>
            </div>
          ) : null}
          {row.approved_by_name ? (
            <div>
              <dt className="text-muted-foreground">{t("firstApprover")}</dt>
              <dd>{row.approved_by_name}</dd>
            </div>
          ) : null}
          {row.second_approved_by_name ? (
            <div>
              <dt className="text-muted-foreground">{t("secondApprover")}</dt>
              <dd>{row.second_approved_by_name}</dd>
            </div>
          ) : null}
          {row.ledger_transaction_id ? (
            <div>
              <dt className="text-muted-foreground">{t("posted")}</dt>
              <dd>
                <Link href={`/ledger/transactions/${row.ledger_transaction_id}`} className="underline-offset-2 hover:underline">
                  {t("viewTransaction")}
                </Link>
              </dd>
            </div>
          ) : null}
          {row.rejection_reason ? (
            <div className="sm:col-span-3">
              <dt className="text-muted-foreground">{t("rejectionReason")}</dt>
              <dd>{row.rejection_reason}</dd>
            </div>
          ) : null}
        </dl>

        {isOpen ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-3">
            {mine ? (
              <>
                <span className="mr-auto text-xs text-muted-foreground">{t("yourRequest")}</span>
                {row.status === "requested" ? <EditRefundButton id={row.id} amount={row.amount} /> : null}
                <Button variant="outline" size="sm" onClick={withdraw} disabled={pending}>
                  {t("withdraw")}
                </Button>
              </>
            ) : can(approvePermission) ? (
              <>
                <ReasonDialog
                  trigger={
                    <Button variant="outline" size="sm" className="text-destructive" disabled={pending}>
                      <X className="size-4" />
                      {t("reject")}
                    </Button>
                  }
                  title={t("rejectTitle")}
                  description={t("rejectBody")}
                  confirmLabel={t("reject")}
                  destructive
                  successMessage={t("rejected")}
                  onConfirm={(reason) => reviewRefund({ id: row.id, approve: false, reason })}
                  onSuccess={() => router.refresh()}
                />
                <Button size="sm" onClick={approve} disabled={pending}>
                  <Check className="size-4" />
                  {row.status === "awaiting_second_approval" ? t("approveSecond") : t("approve")}
                </Button>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">{t("noApprovePermission")}</span>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
