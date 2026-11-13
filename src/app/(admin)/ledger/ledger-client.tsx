"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { BookOpen, ShieldCheck, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useTransition } from "react";
import { toast } from "sonner";
import { CursorPagination } from "@/components/data-table/cursor-pagination";
import { DataTable } from "@/components/data-table/data-table";
import { Toolbar, ToolbarSearch } from "@/components/data-table/toolbar";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { Money } from "@/components/domain/money";
import { useCan } from "@/components/permissions-provider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { runLedgerVerification } from "@/server/actions/finance";
import type { LedgerAccountRow, LedgerOverview, LedgerTransactionRow } from "@/server/queries/finance";

export function VerificationCard({ verification }: { verification: LedgerOverview["verification"] }) {
  const t = useTranslations("ledger");
  const can = useCan();
  const router = useRouter();
  const [pending, start] = useTransition();
  const ok = verification?.ok ?? true;
  const Icon = ok ? ShieldCheck : ShieldAlert;

  function run() {
    start(async () => {
      const result = await runLedgerVerification();
      if (!result.ok) {
        toast.error(t("verifyFailed"));
        return;
      }
      if (result.data.drift + result.data.unbalanced === 0) toast.success(t("verifyClean"));
      else toast.error(t("verifyDrift", { count: result.data.drift + result.data.unbalanced }));
      router.refresh();
    });
  }

  return (
    <Alert variant={ok ? "default" : "destructive"}>
      <Icon className="size-4" />
      <AlertTitle>{verification ? (ok ? t("verifyOk") : t("verifyBad")) : t("verifyNever")}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>
          {verification ? (
            <>
              {t("verifyLast")} <DateTime value={verification.ran_at} relative /> · {t("verifyChecked", { count: verification.accounts_checked })}
            </>
          ) : (
            t("verifyHint")
          )}
        </span>
        {can("ledger.adjust_approve") ? (
          <Button variant="outline" size="sm" onClick={run} disabled={pending}>
            {pending ? t("verifying") : t("verifyNow")}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export function AccountsTable({ rows }: { rows: LedgerAccountRow[] }) {
  const t = useTranslations("ledger");
  const columns = useMemo<ColumnDef<LedgerAccountRow, unknown>[]>(
    () => [
      {
        id: "account",
        header: t("colAccount"),
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="font-medium">{row.original.owner_name ?? (t.has(`platform_${row.original.code.replace("platform:", "")}`) ? t(`platform_${row.original.code.replace("platform:", "")}`) : row.original.code)}</p>
            <p className="font-mono text-xs text-muted-foreground">{row.original.code.length > 40 ? `${row.original.code.slice(0, 40)}…` : row.original.code}</p>
          </div>
        ),
      },
      { id: "owner", header: t("colOwner"), cell: ({ row }) => <span className="capitalize">{row.original.owner_type}</span> },
      { id: "kind", header: t("colKind"), cell: ({ row }) => <span className="capitalize text-muted-foreground">{row.original.kind}</span> },
      {
        id: "balance",
        header: t("colBalance"),
        cell: ({ row }) => (
          <Money
            value={row.original.balance}
            className={row.original.balance < 0 && row.original.kind === "liability" ? "font-medium text-danger" : "font-medium"}
          />
        ),
      },
    ],
    [t],
  );
  return (
    <div className="space-y-3">
      <Toolbar filterKeys={["q"]}>
        <ToolbarSearch placeholder={t("searchAccounts")} />
      </Toolbar>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        getRowHref={(r) => `/ledger/accounts/${r.id}`}
        caption={t("tabAccounts")}
        empty={<EmptyState icon={BookOpen} title={t("emptyAccounts")} />}
      />
    </div>
  );
}

export function TransactionsTable({ rows, nextCursor }: { rows: LedgerTransactionRow[]; nextCursor: string | null }) {
  const t = useTranslations("ledger");
  const columns = useMemo<ColumnDef<LedgerTransactionRow, unknown>[]>(
    () => [
      { id: "kind", meta: { sortKey: "kind" }, header: t("colKindTx"), cell: ({ row }) => <span className="font-medium">{(t.has(`kind_${row.original.kind}`) ? t(`kind_${row.original.kind}`) : row.original.kind)}</span> },
      { id: "memo", header: t("colMemo"), cell: ({ row }) => <span className="block max-w-64 truncate text-muted-foreground">{row.original.memo ?? "—"}</span> },
      { id: "amount", meta: { sortKey: "amount" }, header: t("colAmount"), cell: ({ row }) => <Money value={row.original.amount} /> },
      {
        id: "state",
        header: "",
        cell: ({ row }) =>
          row.original.reverses_id ? (
            <span className="text-xs text-muted-foreground">{t("isReversal")}</span>
          ) : row.original.reversed ? (
            <span className="text-xs text-warning">{t("wasReversed")}</span>
          ) : null,
      },
      { id: "date", meta: { sortKey: "created_at" }, header: t("colDate"), cell: ({ row }) => <DateTime value={row.original.created_at} relative /> },
    ],
    [t],
  );
  return (
    <div className="space-y-3">
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        getRowHref={(r) => `/ledger/transactions/${r.id}`}
        caption={t("tabTransactions")}
        empty={<EmptyState icon={BookOpen} title={t("emptyTransactions")} />}
      />
      <CursorPagination nextCursor={nextCursor} />
    </div>
  );
}
