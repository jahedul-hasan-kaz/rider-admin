"use client";

import { ReceiptText } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Money } from "@/components/domain/money";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { useCan } from "@/components/permissions-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { requestRefund } from "@/server/actions/finance";
import type { TripFinance } from "@/server/queries/finance";

/** Payment, earning and ledger lines for one trip, with the refund request entry point. */
export function TripMoney({ finance }: { finance: TripFinance }) {
  const t = useTranslations("payments");
  const label = useStatusLabel();
  const can = useCan();
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const { payment, earning, ledger_lines: lines } = finance;

  if (!payment && !earning) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("moneyTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{t("noPayment")}</CardContent>
      </Card>
    );
  }

  const refundable = payment ? payment.amount - payment.refunded_amount : 0;
  const canRefund = payment && can("refunds.request") && ["succeeded", "partially_refunded"].includes(payment.status) && refundable > 0;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t("moneyTitle")}</CardTitle>
        {canRefund ? (
          <ReasonDialog
            trigger={
              <Button variant="outline" size="sm">
                <ReceiptText className="size-4" />
                {t("requestRefund")}
              </Button>
            }
            title={t("refundTitle")}
            description={t("refundBody", { max: refundable.toLocaleString() })}
            confirmLabel={t("requestRefund")}
            successMessage={t("refundRequested")}
            presets={["Customer was overcharged", "Trip was not completed as booked", "Goodwill after a complaint"]}
            onConfirm={(reason) => requestRefund({ paymentId: payment.id, amount: Number(amount), reason })}
            onSuccess={() => {
              setAmount("");
              router.push("/refunds");
            }}
          >
            <Field>
              <FieldLabel htmlFor="refund-amount">{t("refundAmount")}</FieldLabel>
              <Input id="refund-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(refundable)} />
              <FieldDescription>{t("refundHelp")}</FieldDescription>
            </Field>
          </ReasonDialog>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {payment ? (
            <>
              <Item label={t("moneyPayment")}>
                <span className="flex items-center gap-2">
                  <Money value={payment.amount} className="font-medium" />
                  <StatusBadge status={payment.status} label={label(payment.status)} />
                </span>
              </Item>
              <Item label={t("colMethod")}>
                <span className="capitalize">{payment.method}</span>
              </Item>
              {payment.refunded_amount > 0 ? (
                <Item label={t("colRefunded")}>
                  <Money value={payment.refunded_amount} />
                </Item>
              ) : null}
            </>
          ) : null}
          {earning ? (
            <>
              <Item label={t("moneyGross")}>
                <Money value={earning.gross_fare} />
              </Item>
              {earning.discount > 0 ? (
                <Item label={t("moneyDiscount")}>
                  <Money value={earning.discount} />
                </Item>
              ) : null}
              <Item label={t("moneyCommission")}>
                <Money value={earning.commission} />
              </Item>
              <Item label={t("moneyNet")}>
                <Money value={earning.net_earning} className="font-medium" />
              </Item>
            </>
          ) : null}
        </dl>
        {lines && lines.length > 0 ? (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">{t("moneyLedger")}</p>
            <ul className="space-y-1 text-sm">
              {lines.map((l, i) => (
                <li key={`${l.account}-${i}`} className="flex items-center justify-between gap-3 font-mono text-xs">
                  <span className="truncate">{l.account.length > 44 ? `${l.account.slice(0, 44)}…` : l.account}</span>
                  <span className="shrink-0 tabular">
                    {l.debit > 0 ? `Dr ${l.debit}` : `Cr ${l.credit}`}
                  </span>
                </li>
              ))}
            </ul>
            <Link href="/ledger?tab=transactions" className="text-xs underline-offset-2 hover:underline">
              {t("moneyOpenLedger")}
            </Link>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
