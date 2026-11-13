"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { MailX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { DataTable } from "@/components/data-table/data-table";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { StatusBadge } from "@/components/domain/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cancelAdminInvitation } from "@/server/actions/admins/invitations";
import type { Invitation } from "@/server/queries/admins";

const STATUS_KEY = {
  pending: "statusPending",
  accepted: "statusAccepted",
  cancelled: "statusCancelled",
  expired: "statusExpired",
} as const;

export function InvitationsTable({ rows, canCancel }: { rows: Invitation[]; canCancel: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const [cancelling, setCancelling] = useState<Invitation | null>(null);

  const columns = useMemo<ColumnDef<Invitation, unknown>[]>(
    () => [
      {
        id: "name",
        header: t("admins.colName"),
        cell: ({ row }) => (
          <div>
            <p className="font-medium">{row.original.full_name}</p>
            <p className="text-xs text-muted-foreground">{row.original.email}</p>
          </div>
        ),
      },
      {
        id: "templates",
        header: t("admins.colTemplates"),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.templates.map((name) => (
              <Badge key={name} variant="secondary">
                {name}
              </Badge>
            ))}
          </div>
        ),
      },
      { id: "by", header: t("admins.colInvitedBy"), cell: ({ row }) => row.original.invited_by ?? "—" },
      { id: "expires", header: t("admins.colExpires"), cell: ({ row }) => <DateTime value={row.original.expires_at} /> },
      {
        id: "status",
        header: t("admins.colStatus"),
        cell: ({ row }) => (
          <StatusBadge status={row.original.status} label={t(`common.${STATUS_KEY[row.original.status]}`)} />
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) =>
          canCancel && row.original.status === "pending" ? (
            <Button variant="ghost" size="sm" onClick={() => setCancelling(row.original)}>
              {t("admins.cancelInvitation")}
            </Button>
          ) : null,
      },
    ],
    [t, canCancel],
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        caption={t("admins.tabInvitations")}
        empty={<EmptyState icon={MailX} title={t("admins.emptyInvitations")} />}
      />
      <ReasonDialog
        open={cancelling !== null}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={t("admins.cancelInvitation")}
        description={`${cancelling?.email ?? ""}: ${t("admins.cancelInvitationBody")}`}
        confirmLabel={t("admins.cancelInvitation")}
        destructive
        successMessage={t("admins.invitationCancelled")}
        onConfirm={(reason) => cancelAdminInvitation({ invitationId: cancelling!.id, reason })}
        onSuccess={() => router.refresh()}
      />
    </>
  );
}
