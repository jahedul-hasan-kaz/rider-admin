"use client";

import { cn } from "@/lib/utils";
import { Archive, History, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { useCan } from "@/components/permissions-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { loadSettingHistory, setFlag, updateSetting } from "@/server/actions/insight";
import type { ArchiveRun, FeatureFlag, OutboxOverview, Setting } from "@/server/queries/insight";

const show = (v: unknown): string => (Array.isArray(v) ? v.join(", ") : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));

function parseValue(setting: Setting, raw: string): unknown {
  const type = setting.schema?.type;
  if (type === "number_list") return raw.split(",").map((x) => Number(x.trim()));
  if (type === "enum_list") return raw.split(",").map((x) => x.trim()).filter(Boolean);
  return Number(raw);
}

export function SettingsGroups({ settings }: { settings: Setting[] }) {
  const t = useTranslations("settings");
  const groups = new Map<string, Setting[]>();
  for (const s of settings) {
    const g = s.schema?.group ?? "Other";
    groups.set(g, [...(groups.get(g) ?? []), s]);
  }
  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([group, items]) => (
        <Card key={group}>
          <CardHeader>
            <CardTitle className="text-base">{t.has(`group_${group}`) ? t(`group_${group}`) : group}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {items.map((s) => (
              <SettingRow key={s.key} setting={s} />
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SettingRow({ setting }: { setting: Setting }) {
  const t = useTranslations("settings");
  const can = useCan();
  const router = useRouter();
  const [raw, setRaw] = useState(show(setting.value));
  const editable = setting.schema?.editable !== false && setting.schema?.type !== "json";
  const unit = setting.schema?.unit;
  const range = setting.schema?.min !== undefined && setting.schema?.max !== undefined ? t("range", { min: setting.schema.min, max: setting.schema.max }) : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="font-mono text-xs text-muted-foreground">{setting.key}</p>
        <p className="text-sm">{setting.description ?? "—"}</p>
        {range ? <p className="text-xs text-muted-foreground">{range}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-muted px-2 py-1 text-sm font-medium tabular">
          {setting.schema?.type === "json" ? t("structured") : `${show(setting.value)}${unit ? ` ${unit}` : ""}`}
        </span>
        {setting.is_default === false ? <span className="text-xs text-warning">{t("changed")}</span> : null}
        <HistoryButton settingKey={setting.key} />
        {editable && can("settings.manage") ? (
          <ReasonDialog
            trigger={
              <Button variant="outline" size="sm" aria-label={t("edit", { key: setting.key })}>
                <Pencil className="size-4" />
              </Button>
            }
            title={t("editTitle")}
            description={t("editBody", { key: setting.key })}
            confirmLabel={t("save")}
            successMessage={t("saved")}
            presets={["Pilot tuning", "Adjusting to observed behaviour"]}
            onConfirm={(reason) => updateSetting({ key: setting.key, value: parseValue(setting, raw), expectedVersion: setting.version, reason })}
            onSuccess={() => router.refresh()}
          >
            <Field>
              <FieldLabel htmlFor={`set-${setting.key}`}>{t("newValue")}</FieldLabel>
              <Input id={`set-${setting.key}`} value={raw} onChange={(e) => setRaw(e.target.value)} className="font-mono" />
              <FieldDescription>
                {setting.schema?.type === "number_list" ? t("listHelp") : setting.schema?.type === "enum_list" ? t("enumHelp", { values: (setting.schema.values ?? []).join(", ") }) : (range ?? "")}
                {setting.schema?.default !== undefined ? ` ${t("default", { value: show(setting.schema.default) })}` : ""}
              </FieldDescription>
            </Field>
          </ReasonDialog>
        ) : null}
      </div>
    </div>
  );
}

function HistoryButton({ settingKey }: { settingKey: string }) {
  const t = useTranslations("settings");
  const [rows, setRows] = useState<{ at: string; admin: string | null; before: unknown; after: unknown; reason: string | null }[] | null>(null);
  const [failed, setFailed] = useState(false);

  async function load(open: boolean) {
    if (!open) return;
    setRows(null);
    setFailed(false);
    const result = await loadSettingHistory({ key: settingKey });
    if (result.ok) setRows(result.data);
    else setFailed(true);
  }

  return (
    <Dialog onOpenChange={load}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={t("history", { key: settingKey })}>
          <History className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("historyTitle")}</DialogTitle>
          <DialogDescription className="font-mono">{settingKey}</DialogDescription>
        </DialogHeader>
      <DialogBody>
        {failed ? <p className="text-sm text-destructive">{t("historyFailed")}</p> : null}
        {rows === null && !failed ? <p className="text-sm text-muted-foreground">{t("loading")}</p> : null}
        {rows?.length === 0 ? <p className="text-sm text-muted-foreground">{t("noHistory")}</p> : null}
        <ul className="max-h-80 space-y-3 overflow-y-auto">
          {rows?.map((r, i) => (
            <li key={i} className="space-y-0.5 text-sm">
              <p>
                <span className="font-mono">{show(r.before)}</span> → <span className="font-mono font-medium">{show(r.after)}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {r.admin ?? "—"} · <DateTime value={r.at} relative />
              </p>
              {r.reason ? <p className="text-xs">{r.reason}</p> : null}
            </li>
          ))}
        </ul>
      </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function FlagsList({ flags, zones }: { flags: FeatureFlag[]; zones: { id: string; name: string }[] }) {
  return (
    <Card>
      <CardContent className="divide-y p-0">
        {flags.map((f) => (
          <FlagRow key={f.key} flag={f} zones={zones} />
        ))}
      </CardContent>
    </Card>
  );
}

function FlagRow({ flag, zones }: { flag: FeatureFlag; zones: { id: string; name: string }[] }) {
  const t = useTranslations("settings");
  const can = useCan();
  const router = useRouter();
  const [enabled, setEnabled] = useState(flag.enabled);
  const [pct, setPct] = useState(flag.rules.percentage === undefined ? "" : String(flag.rules.percentage));
  const [zoneIds, setZoneIds] = useState<string[]>(flag.rules.zone_ids ?? []);
  const manage = can("settings.manage");

  const rules = () => ({
    ...(pct.trim() === "" ? {} : { percentage: Number(pct) }),
    ...(zoneIds.length > 0 ? { zone_ids: zoneIds } : {}),
    ...(flag.rules.category_ids?.length ? { category_ids: flag.rules.category_ids } : {}),
  });
  const summary = [
    flag.rules.percentage !== undefined ? t("rulePercentage", { pct: flag.rules.percentage }) : null,
    flag.rules.zone_ids?.length ? t("ruleZones", { count: flag.rules.zone_ids.length }) : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
      <div className="min-w-0 space-y-0.5">
        <p className="font-mono text-sm font-medium">{flag.key}</p>
        <p className="text-sm text-muted-foreground">{flag.description}</p>
        {summary.length > 0 ? <p className="text-xs text-muted-foreground">{summary.join(" · ")}</p> : null}
        <p className="text-xs text-muted-foreground">
          {flag.updated_by_name ?? t("system")} · <DateTime value={flag.updated_at} relative />
        </p>
      </div>
      {manage ? (
        <ReasonDialog
          trigger={
            <Button variant="outline" size="sm">
              {/* Visual only: a real Switch is a <button> and cannot sit inside this button. */}
              <span aria-hidden className={cn("inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full p-px transition-colors", flag.enabled ? "bg-primary" : "bg-input")}>
                <span className={cn("block size-4 rounded-full bg-background shadow-sm transition-transform", flag.enabled ? "translate-x-[calc(100%-2px)]" : "translate-x-0")} />
              </span>
              {flag.enabled ? t("flagOn") : t("flagOff")}
            </Button>
          }
          title={t("flagTitle", { key: flag.key })}
          description={t("flagBody")}
          confirmLabel={t("save")}
          successMessage={t("saved")}
          onConfirm={(reason) => setFlag({ key: flag.key, enabled, rules: rules(), expectedVersion: flag.version, reason })}
          onSuccess={() => router.refresh()}
        >
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              {t("enabled")}
            </label>
            <Field>
              <FieldLabel htmlFor={`pct-${flag.key}`}>{t("percentage")}</FieldLabel>
              <Input id={`pct-${flag.key}`} inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="100" />
              <FieldDescription>{t("percentageHelp")}</FieldDescription>
            </Field>
            {zones.length > 0 ? (
              <Field>
                <FieldLabel>{t("zones")}</FieldLabel>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {zones.map((z) => (
                    <label key={z.id} className="flex items-center gap-1.5 text-sm">
                      <Checkbox checked={zoneIds.includes(z.id)} onCheckedChange={() => setZoneIds((prev) => (prev.includes(z.id) ? prev.filter((x) => x !== z.id) : [...prev, z.id]))} />
                      {z.name}
                    </label>
                  ))}
                </div>
                <FieldDescription>{t("zonesHelp")}</FieldDescription>
              </Field>
            ) : null}
          </div>
        </ReasonDialog>
      ) : (
        <span className="text-sm">{flag.enabled ? t("flagOn") : t("flagOff")}</span>
      )}
    </div>
  );
}

export function RetentionRuns({ settings, runs }: { settings: Setting[]; runs: ArchiveRun[] | null }) {
  const t = useTranslations("settings");
  return (
    <div className="space-y-4">
      <SettingsGroups settings={settings} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("archiveLog")}</CardTitle>
        </CardHeader>
        <CardContent>
          {runs === null ? (
            <p className="text-sm text-muted-foreground">{t("archiveNoAccess")}</p>
          ) : runs.length === 0 ? (
            <EmptyState icon={Archive} title={t("archiveEmpty")} description={t("archiveEmptyBody")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">{t("colWhen")}</th>
                    <th className="py-2 pr-4 font-medium">{t("colWhat")}</th>
                    <th className="py-2 pr-4 font-medium">{t("colRows")}</th>
                    <th className="py-2 pr-4 font-medium">{t("colChecksum")}</th>
                    <th className="py-2 font-medium">{t("colFile")}</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="py-2 pr-4">
                        <DateTime value={r.ran_at} relative />
                      </td>
                      <td className="py-2 pr-4">{r.kind === "partition" ? `${r.source} · ${r.partition}` : t("purged", { source: r.source })}</td>
                      <td className="py-2 pr-4 tabular">{r.row_count.toLocaleString()}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{r.checksum ?? "—"}</td>
                      <td className="py-2 text-xs">{r.kind !== "partition" ? "—" : r.exported ? t("fileStored", { size: Math.max(1, Math.round((r.file_bytes ?? 0) / 1024)) }) : t("filePending")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function DeliveryOverview({ overview }: { overview: OutboxOverview }) {
  const t = useTranslations("settings");
  const channels = ["email", "sms", "push"] as const;
  const count = (channel: string, status: string) => overview.counts.find((c) => c.channel === channel && c.status === status)?.count ?? 0;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("deliveryTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("deliveryHelp")}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">{t("colChannel")}</th>
                  <th className="py-2 pr-4 font-medium">{t("delivery_sent")}</th>
                  <th className="py-2 pr-4 font-medium">{t("delivery_queued")}</th>
                  <th className="py-2 font-medium">{t("delivery_failed")}</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c} className="border-t">
                    <td className="py-2 pr-4 font-medium">{t(`channel_${c}`)}</td>
                    <td className="py-2 pr-4 tabular">{count(c, "sent")}</td>
                    <td className="py-2 pr-4 tabular">{count(c, "queued") + count(c, "sending")}</td>
                    <td className={count(c, "failed") > 0 ? "py-2 font-medium text-danger tabular" : "py-2 tabular"}>{count(c, "failed")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("recentFailures")}</CardTitle>
        </CardHeader>
        <CardContent>
          {overview.recent_failures.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noFailures")}</p>
          ) : (
            <ul className="space-y-3">
              {overview.recent_failures.map((f) => (
                <li key={f.id} className="space-y-0.5 text-sm">
                  <p className="font-medium">
                    {t(`channel_${f.channel}`)} · {f.subject}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {f.error ?? "—"} · {t("attempts", { count: f.attempts })} · <DateTime value={f.created_at} relative />
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
