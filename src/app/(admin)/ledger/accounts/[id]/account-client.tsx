"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Scale } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { CursorPagination } from "@/components/data-table/cursor-pagination";
import { DataTable } from "@/components/data-table/data-table";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { Money } from "@/components/domain/money";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { Stat } from "@/components/domain/stat";
import { useCan } from "@/components/permissions-provider";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { requestAdjustment } from "@/server/actions/finance";
import type { LedgerEntry } from "@/server/queries/finance";

type Account = { id: string; code: string; owner_type: string; kind: string; balance: number };

export function AdjustmentButton({ accountId }: { accountId: string }) {
  const t = useTranslations("ledger");
  const can = useCan();
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  if (!can("ledger.adjust_request")) return null;
  const value = Number(amount);
  return (
    <ReasonDialog
      trigger={
        <Button variant="outline">
          <Scale className="size-4" />
          {t("requestAdjustment")}
        </Button>
      }
      title={t("adjustTitle")}
      description={t("adjustBody")}
      confirmLabel={t("adjustConfirm")}
      successMessage={t("adjustRequested")}
      presets={["Incentive payout", "Correction of a posting error", "Goodwill credit"]}
      onConfirm={(reason) => requestAdjustment({ accountId, direction, amount: value, reason })}
      onSuccess={() => {
        setAmount("");
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel>{t("adjustDirection")}</FieldLabel>
          <Select value={direction} onValueChange={(v) => setDirection(v as "credit" | "debit")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="credit">{t("adjustCredit")}</SelectItem>
              <SelectItem value="debit">{t("adjustDebit")}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="adjust-amount">{t("adjustAmount")}</FieldLabel>
          <Input id="adjust-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
    </ReasonDialog>
  );
}

export function AccountBody({ account, entries, nextCursor }: { account: Account; entries: LedgerEntry[]; nextCursor: string | null }) {
  const t = useTranslations("ledger");
  const columns = useMemo<ColumnDef<LedgerEntry, unknown>[]>(
    () => [
      { id: "kind", header: t("colKindTx"), cell: ({ row }) => <span className="font-medium">{(t.has(`kind_${row.original.kind}`) ? t(`kind_${row.original.kind}`) : row.original.kind)}</span> },
      { id: "memo", header: t("colMemo"), cell: ({ row }) => <span className="block max-w-64 truncate text-muted-foreground">{row.original.memo ?? "—"}</span> },
      { id: "debit", header: t("colDebit"), cell: ({ row }) => (row.original.debit > 0 ? <Money value={row.original.debit} /> : <span className="text-muted-foreground">—</span>) },
      { id: "credit", header: t("colCredit"), cell: ({ row }) => (row.original.credit > 0 ? <Money value={row.original.credit} /> : <span className="text-muted-foreground">—</span>) },
      { id: "date", header: t("colDate"), cell: ({ row }) => <DateTime value={row.original.created_at} relative /> },
    ],
    [t],
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t("colBalance")} tone={account.balance < 0 && account.kind === "liability" ? "danger" : undefined}>
          {account.balance.toLocaleString()}
        </Stat>
        <Stat label={t("colOwner")}>
          <span className="capitalize">{account.owner_type}</span>
        </Stat>
        <Stat label={t("colKind")}>
          <span className="capitalize">{account.kind}</span>
        </Stat>
      </div>
      <DataTable
        columns={columns}
        data={entries}
        getRowId={(r) => String(r.id)}
        getRowHref={(r) => `/ledger/transactions/${r.transaction_id}`}
        caption={t("entries")}
        empty={<EmptyState icon={Scale} title={t("emptyEntries")} />}
      />
      <CursorPagination nextCursor={nextCursor} />
    </div>
  );
}
