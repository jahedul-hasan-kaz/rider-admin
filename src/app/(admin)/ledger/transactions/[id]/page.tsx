import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { DateTime } from "@/components/domain/date-time";
import { Money } from "@/components/domain/money";
import { PageHeader } from "@/components/domain/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePagePermission } from "@/server/auth/context";
import { AppError } from "@/server/http/errors";
import { getLedgerTransaction } from "@/server/queries/finance";
import { ReversalButton } from "./reversal-client";

export const metadata: Metadata = { title: "Ledger transaction" };

export default async function LedgerTransactionPage({ params }: PageProps<"/ledger/transactions/[id]">) {
  const [{ id }, ctx, t] = await Promise.all([params, requirePagePermission("ledger.view"), getTranslations("ledger")]);
  if (!z.uuid().safeParse(id).success) notFound();

  let tx;
  try {
    tx = await getLedgerTransaction(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const debit = tx.entries.reduce((s, e) => s + e.debit, 0);
  const credit = tx.entries.reduce((s, e) => s + e.credit, 0);
  const canReverse = tx.kind !== "reversal" && !tx.reversed_by;

  return (
    <>
      <PageHeader
        title={(t.has(`kind_${tx.kind}`) ? t(`kind_${tx.kind}`) : tx.kind)}
        description={tx.memo ?? undefined}
        actions={canReverse ? <ReversalButton transactionId={tx.id} /> : null}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("entries")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("colAccount")}</TableHead>
                <TableHead className="text-right">{t("colDebit")}</TableHead>
                <TableHead className="text-right">{t("colCredit")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tx.entries.map((e, i) => (
                <TableRow key={`${e.account_id}-${i}`}>
                  <TableCell>
                    <Link href={`/ledger/accounts/${e.account_id}`} className="font-mono text-xs underline-offset-2 hover:underline">
                      {e.account.length > 48 ? `${e.account.slice(0, 48)}…` : e.account}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">{e.debit > 0 ? <Money value={e.debit} /> : null}</TableCell>
                  <TableCell className="text-right">{e.credit > 0 ? <Money value={e.credit} /> : null}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">{t("total")}</TableCell>
                <TableCell className="text-right font-medium">
                  <Money value={debit} />
                </TableCell>
                <TableCell className="text-right font-medium">
                  <Money value={credit} />
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t("colDate")}</dt>
              <dd>
                <DateTime value={tx.created_at} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("postedBy")}</dt>
              <dd>{tx.created_by_name ?? t("system")}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("reference")}</dt>
              <dd className="font-mono text-xs break-all">{tx.reference}</dd>
            </div>
            {tx.trip_id ? (
              <div>
                <dt className="text-muted-foreground">{t("trip")}</dt>
                <dd>
                  <Link href={`/trips/${tx.trip_id}`} className="font-mono text-xs underline-offset-2 hover:underline">
                    {tx.trip_id.slice(0, 8)}
                  </Link>
                </dd>
              </div>
            ) : null}
            {tx.reverses_id ? (
              <div>
                <dt className="text-muted-foreground">{t("reverses")}</dt>
                <dd>
                  <Link href={`/ledger/transactions/${tx.reverses_id}`} className="underline-offset-2 hover:underline">
                    {t("viewOriginal")}
                  </Link>
                </dd>
              </div>
            ) : null}
            {tx.reversed_by ? (
              <div>
                <dt className="text-muted-foreground">{t("reversedBy")}</dt>
                <dd>
                  <Link href={`/ledger/transactions/${tx.reversed_by}`} className="underline-offset-2 hover:underline">
                    {t("viewReversal")}
                  </Link>
                </dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>
    </>
  );
}
