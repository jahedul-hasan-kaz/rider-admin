"use client";

import { DocumentRowActions, DocumentViewButton } from "@/components/domain/crud-dialogs";
import { CheckCircle2, CircleAlert, History } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { DocumentChecklist } from "@/components/domain/checklist";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { PiiField } from "@/components/domain/pii-field";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { StatusBadge } from "@/components/domain/status-badge";
import { useDocumentTypeLabel, useStatusLabel } from "@/components/domain/status-text";
import { useCan } from "@/components/permissions-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { setCurrentVehicle, suspendVehicle, verifyVehicle } from "@/server/actions/supply";
import type { DriverDetail } from "@/server/queries/supply";
import { AvailabilityDot } from "../drivers-table";

export function DriverHeaderBadges({ driver }: { driver: DriverDetail }) {
  const label = useStatusLabel();
  return (
    <>
      <StatusBadge status={driver.onboarding_status} label={label(driver.onboarding_status)} />
      <AvailabilityDot availability={driver.availability} />
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-center gap-2 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** Approval blockers mirror private.driver_approval_blockers in SQL (UX only). */
export function approvalBlockers(driver: DriverDetail) {
  const docs = driver.documents.filter((d) => d.state !== "approved");
  const hasActiveVehicle = driver.vehicles.some((v) => v.status === "active");
  return { docs, hasActiveVehicle, ready: docs.length === 0 && hasActiveVehicle };
}

export function DriverOverview({ driver, canRevealPii }: { driver: DriverDetail; canRevealPii: boolean }) {
  const t = useTranslations("drivers");
  const docLabel = useDocumentTypeLabel();
  const statusLabel = useStatusLabel();
  const blockers = approvalBlockers(driver);
  const showChecklist = !["approved"].includes(driver.onboarding_status);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("contact")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl>
            <Row label={t("phone")}>
              <PiiField profileId={driver.user_id} field="phone" masked={driver.phone_masked} canReveal={canRevealPii} />
            </Row>
            <Row label={t("email")}>
              <PiiField profileId={driver.user_id} field="email" masked={driver.email_masked} canReveal={canRevealPii} />
            </Row>
            <Row label={t("licence")}>
              <PiiField
                profileId={driver.user_id}
                field="licence_number"
                masked={driver.licence_number_masked}
                canReveal={canRevealPii}
              />
            </Row>
            <Row label={t("licenceExpiry")}>{driver.licence_expiry ?? "—"}</Row>
            <Row label={t("homeZone")}>{driver.zone?.name ?? t("noZone")}</Row>
            {driver.live_location ? (
              <Row label={t("liveLocation")}>
                <span className="font-mono text-xs tabular">
                  {driver.live_location.lat.toFixed(5)}, {driver.live_location.lng.toFixed(5)}
                </span>{" "}
                · <DateTime value={driver.live_location.updated_at} relative />
              </Row>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      {showChecklist ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("approvalChecklist")}</CardTitle>
            <CardDescription>{blockers.ready ? t("ready") : t("blockers")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {blockers.ready ? (
              <p className="flex items-center gap-2 text-success">
                <CheckCircle2 className="size-4" aria-hidden /> {t("ready")}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {blockers.docs.map((d) => (
                  <li key={d.document_type} className="flex items-center gap-2">
                    <CircleAlert className="size-4 text-warning" aria-hidden />
                    {t("blockerDocument", { type: docLabel(d.document_type), state: statusLabel(d.state) })}
                  </li>
                ))}
                {!blockers.hasActiveVehicle ? (
                  <li className="flex items-center gap-2">
                    <CircleAlert className="size-4 text-warning" aria-hidden />
                    {t("blockerVehicle")}
                  </li>
                ) : null}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("tabDocuments")}</CardTitle>
          </CardHeader>
          <CardContent>
            <DocumentChecklist items={driver.documents} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function DriverDocuments({ driver }: { driver: DriverDetail }) {
  const t = useTranslations();
  const docLabel = useDocumentTypeLabel();
  const statusLabel = useStatusLabel();
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("drivers.approvalChecklist")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentChecklist items={driver.documents} />
          {driver.vehicles.map((v) => (
            <div key={v.id} className="mt-4 border-t pt-3">
              <p className="mb-1 px-2 font-mono text-xs text-muted-foreground">{v.registration_number}</p>
              <DocumentChecklist items={v.documents} />
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <History className="mr-1 inline size-4" aria-hidden />
            {t("documents.title")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {driver.document_history.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className="font-medium">{docLabel(d.document_type)}</span>
                <StatusBadge status={d.review_status} label={statusLabel(d.review_status)} />
                {d.superseded_at ? <Badge variant="outline">{t("documents.previousVersion")}</Badge> : null}
                {d.document_number_masked ? <span className="font-mono text-xs">{d.document_number_masked}</span> : null}
                <span className="ml-auto text-xs text-muted-foreground">
                  <DateTime value={d.uploaded_at} relative />
                </span>
                {d.uploaded_at ? (
                  <DocumentViewButton documentId={d.id} title={docLabel(d.document_type)} description={d.document_number_masked ?? undefined} />
                ) : null}
                {d.superseded_at ? null : <DocumentRowActions documentId={d.id} issuedAt={d.issued_at} expiresAt={d.expires_at} />}
                {d.rejection_reason ? <p className="w-full text-xs text-danger">{d.rejection_reason}</p> : null}
              </li>
            ))}
          </ul>
          {driver.document_history.length === 0 ? <p className="text-sm text-muted-foreground">{t("documents.noFile")}</p> : null}
        </CardContent>
      </Card>
    </div>
  );
}

export function DriverVehicles({ driver }: { driver: DriverDetail }) {
  const t = useTranslations();
  const label = useStatusLabel();
  const can = useCan();
  const router = useRouter();

  if (driver.vehicles.length === 0) return <EmptyState icon={History} title={t("drivers.noVehicles")} />;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {driver.vehicles.map((v) => {
        const docsApproved = v.documents.every((d) => d.state === "approved");
        const isCurrent = driver.current_vehicle_id === v.id;
        return (
          <Card key={v.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="font-mono text-base">
                    <Link href={`/vehicles/${v.id}` as Route} className="hover:underline">
                      {v.registration_number}
                    </Link>
                  </CardTitle>
                  <CardDescription>
                    {v.make} {v.model} · {v.color} · {v.year} · {v.category.name}
                  </CardDescription>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge status={v.status} label={label(v.status)} />
                  {isCurrent ? <Badge variant="secondary">{t("drivers.currentVehicle")}</Badge> : null}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <DocumentChecklist items={v.documents} />
              <div className="flex flex-wrap gap-2">
                {v.status !== "active" && can("vehicles.verify") && docsApproved ? (
                  <ReasonDialog
                    trigger={<Button size="sm">{v.status === "suspended" ? t("vehicles.reinstate") : t("vehicles.verify")}</Button>}
                    title={
                      v.status === "suspended"
                        ? t("vehicles.reinstateTitle", { plate: v.registration_number })
                        : t("vehicles.verifyTitle", { plate: v.registration_number })
                    }
                    description={t("vehicles.verifyBody")}
                    confirmLabel={v.status === "suspended" ? t("vehicles.reinstate") : t("vehicles.verify")}
                    successMessage={t("vehicles.verified")}
                    onConfirm={(reason) => verifyVehicle({ vehicleId: v.id, reason })}
                    onSuccess={() => router.refresh()}
                  />
                ) : null}
                {v.status === "active" && can("vehicles.verify") ? (
                  <ReasonDialog
                    trigger={
                      <Button size="sm" variant="outline" className="text-destructive">
                        {t("vehicles.suspend")}
                      </Button>
                    }
                    title={t("vehicles.suspendTitle", { plate: v.registration_number })}
                    description={t("vehicles.suspendBody")}
                    confirmLabel={t("vehicles.suspend")}
                    destructive
                    successMessage={t("vehicles.suspendedToast")}
                    onConfirm={(reason) => suspendVehicle({ vehicleId: v.id, reason })}
                    onSuccess={() => router.refresh()}
                  />
                ) : null}
                {v.status === "active" && !isCurrent && driver.availability === "offline" && can("vehicles.manage") ? (
                  <ReasonDialog
                    trigger={
                      <Button size="sm" variant="outline">
                        {t("drivers.makeCurrent")}
                      </Button>
                    }
                    title={t("drivers.makeCurrent")}
                    description={`${v.registration_number} · ${v.make} ${v.model}`}
                    confirmLabel={t("drivers.makeCurrent")}
                    onConfirm={(reason) => setCurrentVehicle({ driverId: driver.id, vehicleId: v.id, reason })}
                    onSuccess={() => router.refresh()}
                  />
                ) : null}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function DriverActivity({ driver }: { driver: DriverDetail }) {
  const t = useTranslations("drivers");
  const label = useStatusLabel();
  if (driver.events.length === 0) return <EmptyState icon={History} title={t("tabActivity")} />;
  return (
    <ol className="relative space-y-5 border-l pl-6">
      {driver.events.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute top-1.5 -left-[29px] size-2.5 rounded-full border-2 border-background bg-primary" aria-hidden />
          <p className="text-sm">
            <span className="font-medium">{e.kind === "onboarding" ? t("eventOnboarding") : t("eventAvailability")}</span>
            {": "}
            {e.old_status ? `${label(e.old_status)} → ` : ""}
            {label(e.new_status)}
          </p>
          <p className="text-xs text-muted-foreground">
            {e.actor_name ?? (e.actor_type === "system" ? t("actorSystem") : t("actorDriver"))} ·{" "}
            <DateTime value={e.created_at} relative />
          </p>
          {e.reason ? <p className="mt-1 text-sm">{e.reason}</p> : null}
        </li>
      ))}
    </ol>
  );
}
