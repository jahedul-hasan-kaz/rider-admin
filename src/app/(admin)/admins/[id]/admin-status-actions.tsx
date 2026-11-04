"use client";

import { UserCheck, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { Button } from "@/components/ui/button";
import { reactivateAdmin, suspendAdmin } from "@/server/actions/admins/status";

export function AdminStatusActions({ adminId, name, status }: { adminId: string; name: string; status: string }) {
  const t = useTranslations("admins");
  const router = useRouter();

  if (status === "suspended") {
    return (
      <ReasonDialog
        trigger={
          <Button variant="outline">
            <UserCheck className="size-4" />
            {t("reactivate")}
          </Button>
        }
        title={t("reactivateTitle", { name })}
        description={t("reactivateBody")}
        confirmLabel={t("reactivate")}
        successMessage={t("reactivated", { name })}
        onConfirm={(reason) => reactivateAdmin({ adminId, reason })}
        onSuccess={() => router.refresh()}
      />
    );
  }

  return (
    <ReasonDialog
      trigger={
        <Button variant="outline" className="text-destructive">
          <UserX className="size-4" />
          {t("suspend")}
        </Button>
      }
      title={t("suspendTitle", { name })}
      description={t("suspendBody")}
      confirmLabel={t("suspend")}
      destructive
      confirmWord="SUSPEND"
      presets={["Left the company", "Security review", "Role change pending"]}
      successMessage={t("suspended", { name })}
      onConfirm={(reason) => suspendAdmin({ adminId, reason })}
      onSuccess={() => router.refresh()}
    />
  );
}
