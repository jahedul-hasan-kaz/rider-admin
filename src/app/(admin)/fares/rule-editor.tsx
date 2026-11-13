"use client";

import { Copy, History, Trash2 } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { FareBreakdown } from "@/components/domain/fare-breakdown";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { useCan } from "@/components/permissions-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorKey, fieldErrors } from "@/lib/action-errors";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { FareValues } from "@/lib/schemas/rides";
import { cloneFareRule, discardFareDraft, publishFareRule, retireFareRule, saveFareDraft, simulateFare } from "@/server/actions/rides";
import type { FareBreakdownData, FareRule } from "@/server/queries/rides";

const COMPONENTS = ["base", "distance", "time", "waiting", "surge"] as const;
type Component = (typeof COMPONENTS)[number];

type Form = {
  base_fare: string; per_km: string; per_minute: string; minimum_fare: string; booking_fee: string; waiting_per_minute: string;
  free_waiting_minutes: string; cancellation_fee: string; commission_pct: string; max_surge_multiplier: string;
};

const DEFAULTS: Form = {
  base_fare: "40", per_km: "20", per_minute: "2", minimum_fare: "60", booking_fee: "0", waiting_per_minute: "2",
  free_waiting_minutes: "3", cancellation_fee: "30", commission_pct: "15", max_surge_multiplier: "1.5",
};

function fromRule(r: FareRule): Form {
  return {
    base_fare: String(r.base_fare), per_km: String(r.per_km), per_minute: String(r.per_minute), minimum_fare: String(r.minimum_fare),
    booking_fee: String(r.booking_fee), waiting_per_minute: String(r.waiting_per_minute), free_waiting_minutes: String(r.free_waiting_minutes),
    cancellation_fee: String(r.cancellation_fee), commission_pct: String(Math.round(r.platform_commission_pct * 10000) / 100),
    max_surge_multiplier: String(r.max_surge_multiplier),
  };
}

/** Form → typed values (percent → fraction). Returns null while any field is not a valid number. */
function toValues(f: Form, comps: Set<Component>): FareValues | null {
  const n = (s: string) => (s.trim() === "" ? NaN : Number(s));
  const v = {
    base_fare: n(f.base_fare), per_km: n(f.per_km), per_minute: n(f.per_minute), minimum_fare: n(f.minimum_fare),
    booking_fee: n(f.booking_fee), waiting_per_minute: n(f.waiting_per_minute), free_waiting_minutes: n(f.free_waiting_minutes),
    cancellation_fee: n(f.cancellation_fee), platform_commission_pct: n(f.commission_pct) / 100,
    max_surge_multiplier: n(f.max_surge_multiplier), commissionable_components: [...comps],
  };
  const bad = Object.entries(v).some(([k, x]) => k !== "commissionable_components" && !Number.isFinite(x as number));
  if (bad || v.free_waiting_minutes % 1 !== 0) return null;
  return v as FareValues;
}

type Props = {
  rule: FareRule | null;
  categoryId: string;
  zoneId: string | null;
  categoryName: string;
  zoneName: string;
  siblings: FareRule[];
  zoneSurge: number;
};

export function RuleEditor({ rule, categoryId, zoneId, categoryName, zoneName, siblings, zoneSurge }: Props) {
  const t = useTranslations();
  const locale = useLocale();
  const can = useCan();
  const router = useRouter();
  const label = useStatusLabel();
  const editable = !rule || rule.status === "draft";
  const [form, setForm] = useState<Form>(rule ? fromRule(rule) : DEFAULTS);
  const [comps, setComps] = useState<Set<Component>>(new Set((rule?.commissionable_components as Component[] | undefined) ?? COMPONENTS));
  const [note, setNote] = useState(rule?.change_note ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [publishing, setPublishing] = useState(false);
  const [mode, setMode] = useState<"now" | "later">("now");
  const [startsAt, setStartsAt] = useState("");

  const values = useMemo(() => toValues(form, comps), [form, comps]);
  const liveRule = siblings.find((r) => r.live_state === "active" && r.id !== rule?.id) ?? null;

  // --- Simulator ------------------------------------------------------------
  const [sim, setSim] = useState({ km: "5", min: "20", wait: "0", surge: "1" });
  const [result, setResult] = useState<{ breakdown: FareBreakdownData; compare?: FareBreakdownData } | null>(null);
  const [simError, setSimError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!values) return;
    const km = Number(sim.km), min = Number(sim.min), wait = Number(sim.wait), surge = Number(sim.surge);
    if (![km, min, wait, surge].every(Number.isFinite) || surge < 1) return;
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      const res = await simulateFare({
        values, distanceM: Math.round(km * 1000), durationS: Math.round(min * 60), waitingS: Math.round(wait * 60), surge,
        compareRuleId: liveRule?.id ?? null,
      });
      if (id !== seq.current) return; // a newer request superseded this one
      if (res.ok) {
        setResult(res.data as { breakdown: FareBreakdownData; compare?: FareBreakdownData });
        setSimError(null);
      } else {
        setSimError(t(`errors.${errorKey(res.error.code)}`));
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [values, sim, liveRule?.id, t]);

  function setField(key: keyof Form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function save() {
    if (!values) return;
    setErrors({});
    startTransition(async () => {
      const res = await saveFareDraft({
        id: rule?.id ?? null, categoryId, zoneId, values, changeNote: note || undefined, expectedVersion: rule?.version ?? null,
      });
      if (res.ok) {
        toast.success(t("fares.saved"));
        if (!rule) router.replace(`/fares/${res.data.id}` as Route);
        else router.refresh();
      } else {
        const f = fieldErrors(res.error);
        setErrors(f);
        if (!Object.keys(f).length) toast.error(t(`errors.${errorKey(res.error.code)}`));
      }
    });
  }

  function clone() {
    if (!rule) return;
    startTransition(async () => {
      const res = await cloneFareRule({ ruleId: rule.id });
      if (res.ok) {
        toast.success(t("fares.cloned"));
        router.push(`/fares/${res.data.id}` as Route);
      } else toast.error(t(`errors.${errorKey(res.error.code)}`));
    });
  }

  const numberField = (key: keyof Form, name: string, opts: { prefix?: string; suffix?: string; step?: string; error?: string } = {}) => (
    <Field data-invalid={Boolean(opts.error || errors[key]) || undefined}>
      <FieldLabel htmlFor={`f-${key}`}>{name}</FieldLabel>
      <div className="relative">
        {opts.prefix ? <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">{opts.prefix}</span> : null}
        <Input
          id={`f-${key}`}
          inputMode="decimal"
          value={form[key]}
          onChange={(e) => setField(key, e.target.value)}
          disabled={!editable}
          className={opts.prefix ? "pl-7 tabular" : "tabular"}
        />
        {opts.suffix ? <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">{opts.suffix}</span> : null}
      </div>
      {errors[key] ? <FieldError>{errors[key]}</FieldError> : null}
    </Field>
  );

  const pct = Number(form.commission_pct);
  const history = [...siblings].sort((a, b) => b.rule_version - a.rule_version);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {categoryName} · {zoneName}
          </span>
          {rule ? <StatusBadge status={rule.live_state === "ended" ? "retired" : rule.live_state} label={t(`fares.state${rule.live_state[0]!.toUpperCase()}${rule.live_state.slice(1)}`)} /> : null}
          {rule?.effective_from ? (
            <span className="text-xs text-muted-foreground">
              {t("fares.effective", { from: formatDateTime(rule.effective_from, locale) })}
              {rule.effective_to ? ` ${t("fares.to", { to: formatDateTime(rule.effective_to, locale) })}` : ""}
            </span>
          ) : null}
        </div>

        {!editable ? (
          <Alert>
            <AlertDescription>{t("fares.readOnly")}</AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("fares.groupRates")}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-3">
                {numberField("base_fare", t("fares.base"), { prefix: "৳" })}
                {numberField("per_km", t("fares.perKm"), { prefix: "৳" })}
                {numberField("per_minute", t("fares.perMinute"), { prefix: "৳" })}
                {numberField("minimum_fare", t("fares.minimum"), { prefix: "৳" })}
                {numberField("booking_fee", t("fares.bookingFee"), { prefix: "৳" })}
                {numberField("cancellation_fee", t("fares.cancellationFee"), { prefix: "৳" })}
                {numberField("waiting_per_minute", t("fares.waiting"), { prefix: "৳" })}
                {numberField("free_waiting_minutes", t("fares.freeWaiting"))}
              </div>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("fares.groupCommission")}</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  {numberField("commission_pct", t("fares.commission"), { suffix: "%" })}
                  {Number.isFinite(pct) ? (
                    <FieldDescription>{t("fares.commissionHelp", { pct, amount: formatMoney((200 * pct) / 100, locale).replace("৳", "") })}</FieldDescription>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  {numberField("max_surge_multiplier", t("fares.surgeCap"), { suffix: "×" })}
                  <FieldDescription>
                    {t("fares.surgeHelp")} {t("fares.surgeNote", { surge: zoneSurge })}
                  </FieldDescription>
                </div>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t("fares.components")}</legend>
                <div className="flex flex-wrap gap-4">
                  {COMPONENTS.map((c) => (
                    <label key={c} className="flex items-center gap-2 text-sm" htmlFor={`c-${c}`}>
                      <Checkbox
                        id={`c-${c}`}
                        checked={comps.has(c)}
                        disabled={!editable}
                        onCheckedChange={(on) =>
                          setComps((prev) => {
                            const next = new Set(prev);
                            if (on) next.add(c);
                            else next.delete(c);
                            return next;
                          })
                        }
                      />
                      {t(`fares.component${c[0]!.toUpperCase()}${c.slice(1)}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Field>
                <FieldLabel htmlFor="f-note">{t("fares.changeNote")}</FieldLabel>
                <Input id="f-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} disabled={!editable} />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-2">
          {editable && can("fares.manage") ? (
            <Button onClick={save} disabled={!values || pending}>
              {pending ? t("common.saving") : t("fares.save")}
            </Button>
          ) : null}
          {rule?.status === "draft" && can("fares.publish") ? (
            <Button variant="default" onClick={() => setPublishing(true)} disabled={!values || pending}>
              {t("fares.publish")}
            </Button>
          ) : null}
          {rule?.status === "draft" && !can("fares.publish") && can("fares.manage") ? (
            <span className="text-xs text-muted-foreground">{t("fares.needPublish")}</span>
          ) : null}
          {rule && rule.status !== "draft" && can("fares.manage") ? (
            <Button variant="outline" onClick={clone} disabled={pending}>
              <Copy className="size-4" />
              {t("fares.clone")}
            </Button>
          ) : null}
          {rule && (rule.status === "active" || rule.status === "scheduled") && rule.live_state !== "ended" && can("fares.publish") ? (
            <ReasonDialog
              trigger={<Button variant="outline" className="text-destructive">{t("fares.retire")}</Button>}
              title={t("fares.retireTitle", { version: rule.rule_version })}
              description={t("fares.retireBody")}
              confirmLabel={t("fares.retire")}
              destructive
              confirmWord="RETIRE"
              successMessage={t("fares.retired")}
              onConfirm={(reason) => retireFareRule({ ruleId: rule.id, reason })}
              onSuccess={() => router.refresh()}
            />
          ) : null}
          {rule?.status === "draft" && can("fares.manage") ? (
            <ReasonDialog
              trigger={
                <Button variant="ghost" className="text-destructive">
                  <Trash2 className="size-4" />
                  {t("fares.discard")}
                </Button>
              }
              title={t("fares.discardTitle")}
              description={t("fares.discardTitle")}
              confirmLabel={t("fares.discard")}
              destructive
              successMessage={t("fares.discarded")}
              onConfirm={(reason) => discardFareDraft({ ruleId: rule.id, reason })}
              onSuccess={() => router.push("/fares" as Route)}
            />
          ) : null}
        </div>

        {history.length > 1 ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="size-4" aria-hidden />
                {t("fares.history")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {history.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <a href={`/fares/${r.id}`} className="font-medium hover:underline">v{r.rule_version}</a>
                    <StatusBadge status={r.live_state === "ended" ? "retired" : r.live_state} label={label(r.live_state === "ended" ? "retired" : r.live_state)} />
                    <span className="text-xs text-muted-foreground">
                      {r.effective_from ? t("fares.effective", { from: formatDateTime(r.effective_from, locale) }) : ""}
                    </span>
                    {r.change_note ? <span className="text-xs">{r.change_note}</span> : null}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card className="h-fit xl:sticky xl:top-20">
        <CardHeader>
          <CardTitle className="text-base">{t("fares.simulator")}</CardTitle>
          <CardDescription>{t("fares.simHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("fares.presets")}>
            {[2, 5, 10].map((km) => (
              <Button key={km} type="button" size="sm" variant="outline" className="h-7" onClick={() => setSim((s) => ({ ...s, km: String(km), min: String(Math.round(km * 2.4)) }))}>
                {km} km
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {([["km", "simDistance"], ["min", "simDuration"], ["wait", "simWaiting"], ["surge", "simSurge"]] as const).map(([k, name]) => (
              <Field key={k}>
                <FieldLabel htmlFor={`s-${k}`}>{t(`fares.${name}`)}</FieldLabel>
                <Input id={`s-${k}`} inputMode="decimal" value={sim[k]} onChange={(e) => setSim((s) => ({ ...s, [k]: e.target.value }))} className="tabular" />
              </Field>
            ))}
          </div>
          {!values ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : simError ? (
            <p className="text-sm text-destructive">{simError}</p>
          ) : result ? (
            <div className="space-y-2">
              <FareBreakdown data={result.breakdown} compare={result.compare ?? null} />
              {liveRule ? (
                <p className="text-xs text-muted-foreground">
                  {result.compare && result.compare.total_amount === result.breakdown.total_amount ? t("fares.noChange") : t("fares.vsLive")}
                </p>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {rule && values ? (
        <ReasonDialog
          open={publishing}
          onOpenChange={setPublishing}
          title={t("fares.publishTitle", { version: rule.rule_version })}
          description={t("fares.publishBody")}
          confirmLabel={t("fares.publish")}
          confirmWord="PUBLISH"
          presets={["Pilot launch rates", "Seasonal adjustment", "Cost increase"]}
          successMessage={mode === "now" ? t("fares.publishedToast") : t("fares.scheduledToast")}
          onConfirm={(reason) =>
            publishFareRule({
              ruleId: rule.id,
              effectiveFrom: mode === "later" && startsAt ? new Date(startsAt).toISOString() : null,
              reason,
            })
          }
          onSuccess={() => router.refresh()}
        >
          <div className="space-y-3 rounded-md border p-3">
            <div className="flex gap-4 text-sm">
              {(["now", "later"] as const).map((m) => (
                <label key={m} className="flex items-center gap-2">
                  <input type="radio" name="when" checked={mode === m} onChange={() => setMode(m)} />
                  {m === "now" ? t("fares.publishNow") : t("fares.publishLater")}
                </label>
              ))}
            </div>
            {mode === "later" ? (
              <Field>
                <FieldLabel htmlFor="starts-at">{t("fares.effectiveFrom")}</FieldLabel>
                <Input id="starts-at" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </Field>
            ) : null}
            {liveRule && result ? (
              <p className="text-xs text-muted-foreground">
                {t("fares.reviewTitle")}: {result.compare ? `${formatMoney(result.compare.total_amount, locale)} → ${formatMoney(result.breakdown.total_amount, locale)}` : ""}
              </p>
            ) : null}
          </div>
        </ReasonDialog>
      ) : null}
    </div>
  );
}
