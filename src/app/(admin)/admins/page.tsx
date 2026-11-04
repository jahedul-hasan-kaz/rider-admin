import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/domain/page-header";
import { TabLinks } from "@/components/domain/tab-links";
import { requirePagePermission } from "@/server/auth/context";
import { getCatalogue, listAdmins, listInvitations } from "@/server/queries/admins";
import { AdminsTable } from "./admins-table";
import { InvitationsTable } from "./invitations-table";
import { InviteAdminDialog } from "./invite-admin-dialog";

export const metadata: Metadata = { title: "Admins" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function AdminsPage({ searchParams }: PageProps<"/admins">) {
  const [ctx, params, t] = await Promise.all([
    requirePagePermission("admins.view"),
    searchParams,
    getTranslations("admins"),
  ]);
  const tab = one(params.tab) === "invitations" ? "invitations" : "admins";
  const q = one(params.q);
  const status = one(params.status);
  const canInvite = ctx.permissions.has("admins.invite");

  const [admins, invitations, catalogue] = await Promise.all([
    tab === "admins" ? listAdmins(ctx, { q, status }) : Promise.resolve(null),
    listInvitations(ctx),
    canInvite ? getCatalogue(ctx) : Promise.resolve(null),
  ]);
  const pendingCount = invitations.filter((i) => i.status === "pending").length;

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        actions={
          catalogue ? (
            <InviteAdminDialog
              templates={catalogue.templates}
              isSuperAdmin={ctx.isSuperAdmin}
              canAssignTemplates={ctx.permissions.has("admins.manage_permissions")}
            />
          ) : null
        }
      />
      <TabLinks
        active={tab}
        tabs={[
          { key: "admins", label: t("tabAdmins"), href: "/admins" },
          { key: "invitations", label: t("tabInvitations"), href: "/admins?tab=invitations", count: pendingCount },
        ]}
      />
      {tab === "admins" && admins ? (
        <AdminsTable rows={admins} currentAdminId={ctx.userId} />
      ) : (
        <InvitationsTable rows={invitations} canCancel={canInvite} />
      )}
    </>
  );
}
