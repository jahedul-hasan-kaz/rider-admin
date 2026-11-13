"use client";

import { Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { useCan } from "@/components/permissions-provider";
import { Button } from "@/components/ui/button";
import { requestReversal } from "@/server/actions/finance";

export function ReversalButton({ transactionId }: { transactionId: string }) {
  const t = useTranslations("ledger");
  const can = useCan();
  const router = useRouter();
  if (!can("ledger.adjust_request")) return null;
  return (
    <ReasonDialog
      trigger={
        <Button variant="outline">
          <Undo2 className="size-4" />
          {t("requestReversal")}
        </Button>
      }
      title={t("reversalTitle")}
      description={t("reversalBody")}
      confirmLabel={t("reversalConfirm")}
      successMessage={t("reversalRequested")}
      destructive
      onConfirm={(reason) => requestReversal({ transactionId, reason })}
      onSuccess={() => router.push("/refunds")}
    />
  );
}
