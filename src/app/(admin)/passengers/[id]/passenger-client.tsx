"use client";

import { History, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DateTime } from "@/components/domain/date-time";
import { PiiField } from "@/components/domain/pii-field";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { useCan } from "@/components/permissions-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorKey } from "@/lib/action-errors";
import { setPassengerStatus, updatePassenger } from "@/server/actions/supply";
import type { PassengerDetail } from "@/server/queries/supply";

export function PassengerBadges({ passenger }: { passenger: PassengerDetail }) {
  const t = useTranslations("passengers");
  const label = useStatusLabel();
  return (
    <>
      <StatusBadge status={passenger.status} label={label(passenger.status)} />
      {passenger.role === "user" ? <Badge variant="outline">{t("notOnboarded")}</Badge> : null}
    </>
  );
}

export function PassengerActions({ passenger }: { passenger: PassengerDetail }) {
  const t = useTranslations("passengers");
  const can = useCan();
  const router = useRouter();
  if (!can("passengers.suspend") || passenger.status === "deactivated") return null;
  const suspend = passenger.status === "active";
  return (
    <ReasonDialog
      trigger={
        <Button variant="outline" className={suspend ? "text-destructive" : undefined}>
          {suspend ? t("suspend") : t("reactivate")}
        </Button>
      }
      title={suspend ? t("suspendTitle", { name: passenger.full_name }) : t("reactivateTitle", { name: passenger.full_name })}
      description={suspend ? t("suspendBody") : t("reactivateBody")}
      confirmLabel={suspend ? t("suspend") : t("reactivate")}
      destructive={suspend}
      presets={suspend ? ["Abusive behaviour towards driver", "Payment fraud suspected", "Fake account"] : ["Appeal accepted"]}
      successMessage={suspend ? t("suspended") : t("reactivated")}
      onConfirm={(reason) => setPassengerStatus({ profileId: passenger.id, status: suspend ? "suspended" : "active", reason })}
      onSuccess={() => router.refresh()}
    />
  );
}

export function PassengerDetails({
  passenger,
  canRevealPii,
  canEdit,
}: {
  passenger: PassengerDetail;
  canRevealPii: boolean;
  canEdit: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(passenger.full_name);
  const [language, setLanguage] = useState(passenger.preferred_language === "bn" ? "bn" : "en");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{t("passengers.details")}</CardTitle>
        {canEdit && !editing ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
            {t("passengers.edit")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              startTransition(async () => {
                const result = await updatePassenger({
                  profileId: passenger.id,
                  fullName: name,
                  preferredLanguage: language,
                  expectedVersion: passenger.version,
                });
                if (result.ok) {
                  toast.success(t("passengers.saved"));
                  setEditing(false);
                  router.refresh();
                } else setError(t(`errors.${errorKey(result.error.code)}`));
              });
            }}
          >
            <FieldGroup>
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <Field>
                <FieldLabel htmlFor="p-name">{t("admins.fullName")}</FieldLabel>
                <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
              </Field>
              <Field>
                <FieldLabel htmlFor="p-lang">{t("profile.language")}</FieldLabel>
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger id="p-lang" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">{t("profile.english")}</SelectItem>
                    <SelectItem value="bn">{t("profile.bangla")}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <div className="flex gap-2">
                <Button type="submit" disabled={pending}>
                  {pending ? t("common.saving") : t("common.save")}
                </Button>
                <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={pending}>
                  {t("common.cancel")}
                </Button>
              </div>
            </FieldGroup>
          </form>
        ) : (
          <dl className="grid grid-cols-[8rem_1fr] items-center gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t("drivers.phone")}</dt>
            <dd>
              <PiiField profileId={passenger.id} field="phone" masked={passenger.phone_masked} canReveal={canRevealPii} />
            </dd>
            <dt className="text-muted-foreground">{t("drivers.email")}</dt>
            <dd>
              <PiiField profileId={passenger.id} field="email" masked={passenger.email_masked} canReveal={canRevealPii} />
            </dd>
            <dt className="text-muted-foreground">{t("profile.language")}</dt>
            <dd>{passenger.preferred_language === "bn" ? t("profile.bangla") : t("profile.english")}</dd>
            <dt className="text-muted-foreground">{t("passengers.colJoined")}</dt>
            <dd>
              <DateTime value={passenger.created_at} />
            </dd>
            <dt className="text-muted-foreground">{t("passengers.colLastSeen")}</dt>
            <dd>
              <DateTime value={passenger.last_seen_at} relative />
            </dd>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

export function PassengerHistory({ passenger }: { passenger: PassengerDetail }) {
  const t = useTranslations("passengers");
  const label = useStatusLabel();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          <History className="mr-1 inline size-4" aria-hidden />
          {t("history")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {passenger.status_events.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noHistory")}</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {passenger.status_events.map((e, i) => (
              <li key={i}>
                <p>
                  {e.old_status ? `${label(e.old_status)} → ` : ""}
                  <span className="font-medium">{label(e.new_status)}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {e.actor_name ?? "—"} · <DateTime value={e.created_at} relative />
                </p>
                {e.reason ? <p className="mt-0.5">{e.reason}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
