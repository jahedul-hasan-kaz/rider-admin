"use client";

import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorKey } from "@/lib/action-errors";
import { requestExport } from "@/server/actions/insight";
import type { ExportJob } from "@/server/queries/insight";

type Kind = "trips" | "payments" | "ledger" | "tickets" | "drivers";

export function ExportForm({ kinds, defaultFrom, defaultTo }: { kinds: Kind[]; defaultFrom: string; defaultTo: string }) {
  const t = useTranslations("exports");
  const tErr = useTranslations("errors");
  const router = useRouter();
  const [kind, setKind] = useState<Kind | undefined>(kinds[0]);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    if (!kind) return;
    setError(null);
    start(async () => {
      const result = await requestExport({ kind, from, to });
      if (result.ok) {
        toast.success(result.data.status === "ready" ? t("ready") : t("queued"));
        router.refresh();
      } else {
        setError(tErr(errorKey(result.error.code)));
      }
    });
  }

  if (kinds.length === 0) return <Alert><AlertDescription>{t("noKinds")}</AlertDescription></Alert>;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("newExport")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field className="w-44">
            <FieldLabel>{t("what")}</FieldLabel>
            <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kinds.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`kind_${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field className="w-40">
            <FieldLabel htmlFor="export-from">{t("from")}</FieldLabel>
            <Input id="export-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field className="w-40">
            <FieldLabel htmlFor="export-to">{t("to")}</FieldLabel>
            <Input id="export-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Button type="submit" disabled={pending || !kind}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />}
            {t("create")}
          </Button>
        </form>
        <FieldDescription className="mt-3">{t("privacy")}</FieldDescription>
        {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

/** Lists the caller's exports; while any is still being prepared the list refreshes itself every few seconds. */
export function ExportsList({ jobs }: { jobs: ExportJob[] }) {
  const t = useTranslations("exports");
  const label = useStatusLabel();
  const router = useRouter();
  const busy = jobs.some((j) => j.status === "queued" || j.status === "running");

  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [busy, router]);

  if (jobs.length === 0) return <EmptyState icon={FileSpreadsheet} title={t("empty")} description={t("emptyBody")} />;
  return (
    <Card>
      <CardContent className="divide-y p-0">
        {jobs.map((j) => (
          <div key={j.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0 space-y-0.5">
              <p className="font-medium">
                {t.has(`kind_${j.kind}`) ? t(`kind_${j.kind}`) : j.kind}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {j.params.from} → {j.params.to}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                <DateTime value={j.created_at} relative />
                {j.row_count !== null ? ` · ${t("rows", { count: j.row_count })}` : ""}
                {j.status === "ready" && j.expires_at ? ` · ${t("expires")} ` : ""}
                {j.status === "ready" && j.expires_at ? <DateTime value={j.expires_at} relative /> : null}
              </p>
              {j.error ? <p className="text-xs text-destructive">{j.error}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={j.status === "ready" ? "succeeded" : j.status} label={label(j.status === "ready" ? "succeeded" : j.status)} />
              {j.status === "ready" ? (
                <Button size="sm" asChild>
                  <a href={`/api/exports/${j.id}`} download>
                    <Download className="size-4" />
                    {t("download")}
                  </a>
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
