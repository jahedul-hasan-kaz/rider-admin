"use client";

import { Check, CheckCircle2, CircleAlert, X } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { DocumentChecklist } from "@/components/domain/checklist";
import { DateTime } from "@/components/domain/date-time";
import { DocumentViewer } from "@/components/domain/document-viewer";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { useDocumentTypeLabel } from "@/components/domain/status-text";
import { useCan } from "@/components/permissions-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { errorKey } from "@/lib/action-errors";
import { approveDriver, reviewDocument, verifyVehicle } from "@/server/actions/supply";
import type { ChecklistItem, DriverDetail } from "@/server/queries/supply";
import { approvalBlockers } from "../driver-sections";

type Item = ChecklistItem & { group: string; vehicleId: string | null };

/**
 * Split-view onboarding review (docs/spec/06-admin-ui.md §5.5): checklist on the
 * left, the selected document on the right. A approves, R rejects, → / ← move.
 */
export function ReviewWorkspace({ driver }: { driver: DriverDetail }) {
  const t = useTranslations();
  const docLabel = useDocumentTypeLabel();
  const can = useCan();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const items: Item[] = useMemo(
    () => [
      ...driver.documents.map((d) => ({ ...d, group: t("drivers.contact"), vehicleId: null })),
      ...driver.vehicles.flatMap((v) => v.documents.map((d) => ({ ...d, group: v.registration_number, vehicleId: v.id }))),
    ],
    [driver, t],
  );
  const reviewable = items.filter((i) => i.document_id);
  const firstPending = reviewable.find((i) => i.state === "pending") ?? reviewable[0] ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(firstPending?.document_id ?? null);
  const [rejecting, setRejecting] = useState(false);

  const selected = items.find((i) => i.document_id === selectedId) ?? null;
  const meta = driver.document_history.find((d) => d.id === selectedId) ?? null;
  const canReview = can("documents.review") && meta?.review_status === "pending" && !meta.superseded_at;

  const move = useCallback(
    (delta: number) => {
      const index = reviewable.findIndex((i) => i.document_id === selectedId);
      const next = reviewable[(index + delta + reviewable.length) % reviewable.length];
      if (next?.document_id) setSelectedId(next.document_id);
    },
    [reviewable, selectedId],
  );

  const approve = useCallback(() => {
    if (!meta || !canReview) return;
    startTransition(async () => {
      const result = await reviewDocument({ documentId: meta.id, decision: "approve", expectedVersion: meta.version });
      if (result.ok) {
        toast.success(t("documents.approvedToast"));
        router.refresh();
      } else {
        toast.error(t(`errors.${errorKey(result.error.code)}`));
      }
    });
  }, [meta, canReview, router, t]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el?.closest("input,textarea,select,[role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight") move(1);
      else if (e.key === "ArrowLeft") move(-1);
      else if (e.key.toLowerCase() === "a") approve();
      else if (e.key.toLowerCase() === "r" && canReview) setRejecting(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, approve, canReview]);

  const blockers = approvalBlockers(driver);
  const reviewableStatus = driver.onboarding_status === "submitted" || driver.onboarding_status === "under_review";
  const presets = t("documents.rejectPresets").split("|");

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <Card className="h-fit lg:sticky lg:top-20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t("drivers.approvalChecklist")}</CardTitle>
          <p className="text-xs text-muted-foreground">{t("documents.keyboardHint")}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <DocumentChecklist items={driver.documents} selectedId={selectedId} onSelect={(i) => setSelectedId(i.document_id)} />
          {driver.vehicles.map((v) => {
            const docsApproved = v.documents.every((d) => d.state === "approved");
            return (
              <div key={v.id} className="space-y-1 border-t pt-3">
                <p className="px-2 font-mono text-xs text-muted-foreground">
                  {v.registration_number} · {v.make} {v.model}
                </p>
                <DocumentChecklist items={v.documents} selectedId={selectedId} onSelect={(i) => setSelectedId(i.document_id)} />
                {v.status !== "active" && docsApproved && can("vehicles.verify") ? (
                  <ReasonDialog
                    trigger={
                      <Button size="sm" variant="outline" className="ml-2">
                        <Check className="size-3.5" />
                        {t("vehicles.verify")}
                      </Button>
                    }
                    title={t("vehicles.verifyTitle", { plate: v.registration_number })}
                    description={t("vehicles.verifyBody")}
                    confirmLabel={t("vehicles.verify")}
                    presets={["All vehicle documents verified"]}
                    successMessage={t("vehicles.verified")}
                    onConfirm={(reason) => verifyVehicle({ vehicleId: v.id, reason })}
                    onSuccess={() => router.refresh()}
                  />
                ) : v.status === "active" ? (
                  <p className="flex items-center gap-1 px-2 text-xs text-success">
                    <CheckCircle2 className="size-3.5" aria-hidden /> {t("vehicles.verified")}
                  </p>
                ) : null}
              </div>
            );
          })}

          {reviewableStatus && can("drivers.approve") ? (
            <div className="space-y-2 border-t pt-3">
              {blockers.ready ? (
                <p className="flex items-center gap-1.5 text-xs text-success">
                  <CheckCircle2 className="size-3.5" aria-hidden /> {t("drivers.ready")}
                </p>
              ) : (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CircleAlert className="size-3.5" aria-hidden />
                  {blockers.hasActiveVehicle ? t("drivers.blockers") : t("drivers.blockerVehicle")}
                </p>
              )}
              <ReasonDialog
                trigger={
                  <Button className="w-full" disabled={!blockers.ready}>
                    {t("drivers.approve")}
                  </Button>
                }
                title={t("drivers.approveTitle", { name: driver.full_name })}
                description={t("drivers.approveBody")}
                confirmLabel={t("drivers.approve")}
                presets={["All documents verified"]}
                successMessage={t("drivers.approved")}
                onConfirm={(reason) => approveDriver({ driverId: driver.id, reason })}
                onSuccess={() => router.push(`/drivers/${driver.id}` as Route)}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{selected ? docLabel(selected.document_type) : t("documents.noFile")}</p>
            {meta ? (
              <p className="text-xs text-muted-foreground">
                {selected?.group}
                {meta.document_number_masked ? ` · ${t("documents.number")} ${meta.document_number_masked}` : ""}
                {meta.issued_at ? ` · ${t("documents.issued")} ${meta.issued_at}` : ""}
                {meta.expires_at ? ` · ${t("documents.expires")} ${meta.expires_at}` : ""}
                {" · "}
                {t("documents.uploaded")} <DateTime value={meta.uploaded_at} relative />
              </p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => move(-1)} disabled={reviewable.length < 2}>
              ← {t("documents.prev")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => move(1)} disabled={reviewable.length < 2}>
              {t("documents.next")} →
            </Button>
            {canReview ? (
              <>
                <Button variant="outline" className="text-destructive" onClick={() => setRejecting(true)} disabled={pending}>
                  <X className="size-4" />
                  {t("documents.reject")}
                </Button>
                <Button onClick={approve} disabled={pending}>
                  <Check className="size-4" />
                  {t("documents.approve")}
                </Button>
              </>
            ) : null}
          </div>
        </div>
        <DocumentViewer documentId={selectedId} className="flex min-h-[480px] flex-col" />
      </Card>

      <ReasonDialog
        open={rejecting}
        onOpenChange={setRejecting}
        title={t("documents.rejectTitle", { type: selected ? docLabel(selected.document_type) : "" })}
        description={t("documents.rejectBody")}
        confirmLabel={t("documents.reject")}
        destructive
        presets={presets}
        successMessage={t("documents.rejectedToast")}
        onConfirm={(reason) =>
          reviewDocument({ documentId: meta!.id, decision: "reject", reason, expectedVersion: meta!.version })
        }
        onSuccess={() => router.refresh()}
      />
    </div>
  );
}
