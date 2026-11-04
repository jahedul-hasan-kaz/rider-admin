import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { TabLinks } from "@/components/domain/tab-links";
import { requirePagePermission } from "@/server/auth/context";
import { listAuditLogs, listChangeLog } from "@/server/queries/audit";
import { AuditActionsTable, ChangeLogTable } from "./audit-tables";

export const metadata: Metadata = { title: "Audit log" };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

// Tables whose changes are captured by audit.log_change (M0 scope).
const TABLES = [
  "public.profiles",
  "public.admin_profiles",
  "public.admin_invitations",
  "public.admin_template_assignments",
  "public.admin_permission_overrides",
  "public.permission_templates",
  "public.permission_template_items",
  "public.permissions",
];

export default async function AuditPage({ searchParams }: PageProps<"/audit">) {
  const [ctx, params, t] = await Promise.all([requirePagePermission("audit.view"), searchParams, getTranslations("audit")]);
  const tab = one(params.tab) === "changes" ? "changes" : "actions";
  const cursor = one(params.cursor);

  const [actions, changes] = await Promise.all([
    tab === "actions" ? listAuditLogs(ctx, { action: one(params.q), cursor }) : Promise.resolve(null),
    tab === "changes" ? listChangeLog(ctx, { table: one(params.table), cursor }) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader title={t("title")} description={t("subtitle")} />
      <TabLinks
        active={tab}
        tabs={[
          { key: "actions", label: t("tabActions"), href: "/audit" },
          { key: "changes", label: t("tabChanges"), href: "/audit?tab=changes" },
        ]}
      />
      {actions ? <AuditActionsTable rows={actions.rows} nextCursor={actions.next_cursor ?? null} /> : null}
      {changes ? <ChangeLogTable rows={changes.rows} nextCursor={changes.next_cursor ?? null} tables={TABLES} /> : null}
    </>
  );
}
