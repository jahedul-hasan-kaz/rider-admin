"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { EyeOff, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { CursorPagination } from "@/components/data-table/cursor-pagination";
import { DataTable } from "@/components/data-table/data-table";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { useCan } from "@/components/permissions-provider";
import { Button } from "@/components/ui/button";
import { hideRating } from "@/server/actions/finance";
import type { RatingRow } from "@/server/queries/care";

function Stars({ score }: { score: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${score} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={n <= score ? "size-3.5 fill-warning text-warning" : "size-3.5 text-muted-foreground/40"} aria-hidden />
      ))}
    </span>
  );
}

export function RatingsTable({ rows, nextCursor }: { rows: RatingRow[]; nextCursor: string | null }) {
  const t = useTranslations("ratings");
  const can = useCan();
  const router = useRouter();

  const columns = useMemo<ColumnDef<RatingRow, unknown>[]>(
    () => [
      { id: "score", meta: { sortKey: "score" }, header: t("colScore"), cell: ({ row }) => <Stars score={row.original.score} /> },
      {
        id: "comment",
        header: t("colComment"),
        cell: ({ row }) =>
          row.original.comment ? <p className="max-w-96 text-sm whitespace-pre-wrap">{row.original.comment}</p> : <span className="text-muted-foreground">{t("noComment")}</span>,
      },
      {
        id: "who",
        header: t("colWho"),
        cell: ({ row }) => (
          <div className="text-sm">
            <p>
              {row.original.reviewer_name ?? "—"} <span className="text-muted-foreground">→</span> {row.original.reviewee_name ?? "—"}
            </p>
            <p className="text-xs text-muted-foreground capitalize">{t("by", { role: row.original.reviewer_role })}</p>
          </div>
        ),
      },
      {
        id: "trip",
        header: t("colTrip"),
        cell: ({ row }) => (
          <Link href={`/trips/${row.original.trip_id}`} className="font-mono text-xs underline-offset-2 hover:underline">
            {row.original.trip_id.slice(0, 8)}
          </Link>
        ),
      },
      { id: "date", meta: { sortKey: "created_at" }, header: t("colDate"), cell: ({ row }) => <DateTime value={row.original.created_at} relative /> },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          row.original.hidden ? (
            <span className="text-xs text-muted-foreground">{row.original.hidden_reason}</span>
          ) : can("support.manage") ? (
            <ReasonDialog
              trigger={
                <Button variant="outline" size="sm">
                  <EyeOff className="size-4" />
                  {t("hide")}
                </Button>
              }
              title={t("hideTitle")}
              description={t("hideBody")}
              confirmLabel={t("hide")}
              destructive
              presets={["Abusive language", "Personal information"]}
              successMessage={t("hidden")}
              onConfirm={(reason) => hideRating({ id: row.original.id, reason })}
              onSuccess={() => router.refresh()}
            />
          ) : null,
      },
    ],
    [t, can, router],
  );

  return (
    <div className="space-y-3">
      <DataTable columns={columns} data={rows} getRowId={(r) => r.id} caption={t("title")} empty={<EmptyState icon={Star} title={t("empty")} />} />
      <CursorPagination nextCursor={nextCursor} />
    </div>
  );
}
