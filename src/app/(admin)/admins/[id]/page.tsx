import { CalendarDays, Clock, Mail, ShieldCheck, ShieldOff, TriangleAlert } from "lucide-react";
import { early } from "@/server/queries/rpc";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { z } from "zod";
import { CopyButton } from "@/components/domain/copy-button";
import { PageHeader } from "@/components/domain/page-header";
import { StatusBadge } from "@/components/domain/status-badge";
import { TabLinks } from "@/components/domain/tab-links";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatRelative } from "@/lib/format";
import { requirePagePermission, getAdminContext } from "@/server/auth/context";
import { AppError } from "@/server/http/errors";
import { getAdmin, getCatalogue } from "@/server/queries/admins";
import { listAuditLogs } from "@/server/queries/audit";
import { ActivityTimeline } from "./activity-timeline";
import { AdminStatusActions } from "./admin-status-actions";
import { PermissionEditor } from "./permission-editor";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminDetailPage({ params, searchParams }: PageProps<"/admins/[id]">) {
  const [{ id }, query, t, locale] = await Promise.all([params, searchParams, getTranslations(), getLocale()]);
  if (!z.uuid().safeParse(id).success) notFound();

  const self = await getAdminContext();
  const ctx = id === self.userId ? self : await requirePagePermission("admins.view");
  const tab = query.tab === "activity" && ctx.permissions.has("audit.view") ? "activity" : "permissions";

  const catalogueP = early(tab === "permissions" ? getCatalogue(ctx) : Promise.resolve(null));
  const activityP = early(tab === "activity" ? listAuditLogs(ctx, { entityId: id, limit: 100 }) : Promise.resolve(null));
  let admin;
  try {
    admin = await getAdmin(ctx, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const [catalogue, activity] = await Promise.all([catalogueP, activityP]);

  const isSelf = admin.id === ctx.userId;
  const statusLabel = t(`common.status${admin.status[0]!.toUpperCase()}${admin.status.slice(1)}`);

  return (
    <>
      <PageHeader
        title={admin.full_name}
        badge={
          <>
            <StatusBadge status={admin.status} label={statusLabel} />
            {admin.is_super_admin ? <Badge>{t("admins.superAdmin")}</Badge> : null}
            {isSelf ? <Badge variant="outline">{t("admins.you")}</Badge> : null}
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {admin.email ? (
              <span className="inline-flex items-center gap-1">
                <Mail className="size-3.5" aria-hidden />
                {admin.email}
                <CopyButton value={admin.email} />
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5" aria-hidden />
              {t("admins.memberSince", { date: formatDate(admin.created_at, locale) })}
            </span>
            <span className="inline-flex items-center gap-1">
              <Clock className="size-3.5" aria-hidden />
              {t("admins.lastLogin", {
                date: admin.last_login_at ? formatRelative(admin.last_login_at, locale) : t("common.never"),
              })}
            </span>
            <span className="inline-flex items-center gap-1">
              {admin.mfa_enrolled_at ? (
                <ShieldCheck className="size-3.5 text-success" aria-hidden />
              ) : (
                <ShieldOff className="size-3.5 text-warning" aria-hidden />
              )}
              2FA {admin.mfa_enrolled_at ? t("admins.mfaOn") : t("admins.mfaOff")}
            </span>
          </span>
        }
        actions={
          ctx.permissions.has("admins.suspend") && !isSelf && (!admin.is_super_admin || ctx.isSuperAdmin) ? (
            <AdminStatusActions adminId={admin.id} name={admin.full_name} status={admin.status} />
          ) : null
        }
      />

      {admin.status === "suspended" && admin.suspended_reason ? (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertDescription>{t("admins.suspendedBanner", { reason: admin.suspended_reason })}</AlertDescription>
        </Alert>
      ) : null}

      <TabLinks
        active={tab}
        tabs={[
          { key: "permissions", label: t("admins.tabPermissions"), href: `/admins/${id}` },
          ...(ctx.permissions.has("audit.view")
            ? [{ key: "activity", label: t("admins.tabActivity"), href: `/admins/${id}?tab=activity` }]
            : []),
        ]}
      />

      {catalogue ? (
        <PermissionEditor
          key={[
            ...admin.templates.map((x) => x.id),
            ...admin.overrides.map((o) => `${o.permission}:${o.effect}`),
          ].join("|")}
          admin={admin}
          catalogue={catalogue}
          canEdit={ctx.permissions.has("admins.manage_permissions")}
          isSuperAdmin={ctx.isSuperAdmin}
          isSelf={isSelf}
        />
      ) : null}
      {activity ? <ActivityTimeline rows={activity.rows} /> : null}
    </>
  );
}
