"use client";

import { FileText, Image as ImageIcon, MapPinned, Paperclip, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { EVIDENCE_CONTENT_TYPES } from "@/lib/schemas/api";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser-client";
import { completeEvidenceUpload, openEvidence, startEvidenceUpload } from "@/server/actions/safety";
import { DateTime } from "@/components/domain/date-time";
import { ReasonDialog } from "@/components/domain/reason-dialog";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { Timeline, type TimelineItem } from "@/components/domain/timeline";
import { useCan } from "@/components/permissions-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { formatDuration } from "@/lib/format";
import { advanceIncident } from "@/server/actions/finance";
import type { EvidenceRow, IncidentDetail } from "@/server/queries/care";

export function IncidentBadges({ incident }: { incident: IncidentDetail }) {
  const label = useStatusLabel();
  return (
    <>
      <StatusBadge status={incident.severity} label={label(incident.severity)} />
      <StatusBadge status={incident.status} label={label(incident.status)} />
    </>
  );
}

const NEXT: Record<string, ("acknowledged" | "investigating" | "escalated" | "resolved" | "closed")[]> = {
  reported: ["acknowledged"],
  acknowledged: ["investigating", "resolved"],
  investigating: ["escalated", "resolved"],
  escalated: ["investigating", "resolved"],
  resolved: ["closed", "investigating"],
  closed: [],
};

export function IncidentActions({ incident }: { incident: IncidentDetail }) {
  const t = useTranslations("safety");
  const can = useCan();
  const router = useRouter();
  const [escalatedTo, setEscalatedTo] = useState("");
  if (!can("safety.manage")) return null;
  const options = NEXT[incident.status] ?? [];
  return (
    <>
      {options.map((status, i) => (
        <ReasonDialog
          key={status}
          trigger={<Button variant={i === 0 ? "default" : "outline"}>{t(`action_${status}`)}</Button>}
          title={t(`title_${status}`)}
          description={t(`body_${status}`)}
          confirmLabel={t(`action_${status}`)}
          successMessage={t("advanced")}
          presets={status === "acknowledged" ? ["Calling the reporter now", "Contacting the driver"] : []}
          onConfirm={(reason) => advanceIncident({ id: incident.id, status, note: reason, escalatedTo: status === "escalated" ? escalatedTo || undefined : undefined })}
          onSuccess={() => router.refresh()}
        >
          {status === "escalated" ? (
            <Field>
              <FieldLabel htmlFor="escalated-to">{t("escalatedTo")}</FieldLabel>
              <Input id="escalated-to" value={escalatedTo} onChange={(e) => setEscalatedTo(e.target.value)} maxLength={200} placeholder={t("escalatedToPlaceholder")} />
            </Field>
          ) : null}
        </ReasonDialog>
      ))}
    </>
  );
}

export function IncidentBody({ incident, evidence }: { incident: IncidentDetail; evidence: EvidenceRow[] }) {
  const t = useTranslations("safety");
  const label = useStatusLabel();
  const items: TimelineItem[] = incident.events.map((e) => ({
    id: e.id,
    title: label(e.to_status),
    meta: (
      <>
        {e.actor_name ?? t("system")} · <DateTime value={e.created_at} />
      </>
    ),
    body: e.note ?? undefined,
    tone: e.to_status === "resolved" || e.to_status === "closed" ? ("success" as const) : e.to_status === "reported" ? ("danger" as const) : ("default" as const),
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("timeline")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline items={items} />
        </CardContent>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("details")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <Row label={t("kind")}>{t(`kind_${incident.kind}`)}</Row>
              <Row label={t("reporter")}>
                {incident.reporter_name ?? "—"} <span className="text-muted-foreground capitalize">({incident.reporter_role})</span>
              </Row>
              <Row label={t("colAssignee")}>{incident.assignee_name ?? t("unassigned")}</Row>
              <Row label={t("colReported")}>
                <DateTime value={incident.reported_at} />
              </Row>
              <Row label={t("timeToAck")}>{incident.seconds_to_acknowledge !== null ? formatDuration(incident.seconds_to_acknowledge) : t("notYet")}</Row>
              {incident.description ? <Row label={t("description")}>{incident.description}</Row> : null}
              {incident.escalated_to ? <Row label={t("escalatedTo")}>{incident.escalated_to}</Row> : null}
              {incident.resolution ? <Row label={t("resolution")}>{incident.resolution}</Row> : null}
              {incident.trip_id ? (
                <Row label={t("trip")}>
                  <Link href={`/trips/${incident.trip_id}`} className="font-mono text-xs underline-offset-2 hover:underline">
                    {incident.trip_id.slice(0, 8)}
                  </Link>
                </Row>
              ) : null}
            </dl>
          </CardContent>
        </Card>
        <EvidenceCard incidentId={incident.id} evidence={evidence} closed={incident.status === "closed"} />
        {incident.location ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <MapPinned className="size-4" aria-hidden />
                {t("lastLocation")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="font-mono tabular">
                {incident.location.lat.toFixed(5)}, {incident.location.lng.toFixed(5)}
              </p>
              <a
                className="text-sm underline-offset-2 hover:underline"
                href={`https://www.openstreetmap.org/?mlat=${incident.location.lat}&mlon=${incident.location.lng}#map=17/${incident.location.lat}/${incident.location.lng}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("openMap")}
              </a>
              <p className="text-xs text-muted-foreground">{t("locationLogged")}</p>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Files attached to the incident (photos, PDFs, audio, video). Opening one is logged and gives a 60-second link. */
function EvidenceCard({ incidentId, evidence, closed }: { incidentId: string; evidence: EvidenceRow[]; closed: boolean }) {
  const t = useTranslations("safety");
  const can = useCan();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    const type = EVIDENCE_CONTENT_TYPES.find((x) => x === file.type);
    if (!type) {
      toast.error(t("evidenceType"));
      return;
    }
    setBusy(true);
    try {
      const started = await startEvidenceUpload({ incidentId, contentType: type });
      if (!started.ok) throw new Error("start");
      const { error } = await createSupabaseBrowserClient()
        .storage.from("safety-evidence")
        .uploadToSignedUrl(started.data.path, started.data.token, file, { contentType: type });
      if (error) throw error;
      const done = await completeEvidenceUpload({ incidentId, path: started.data.path, contentType: type, description: description || undefined });
      if (!done.ok) throw new Error("complete");
      toast.success(t("evidenceAdded"));
      setDescription("");
      router.refresh();
    } catch {
      toast.error(t("evidenceFailed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function open(id: string) {
    const result = await openEvidence({ id });
    if (result.ok) window.open(result.data.url, "_blank", "noopener,noreferrer");
    else toast.error(t("evidenceFailed"));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Paperclip className="size-4" aria-hidden />
          {t("evidence")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {evidence.length === 0 ? <p className="text-sm text-muted-foreground">{t("noEvidence")}</p> : null}
        <ul className="space-y-2">
          {evidence.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                {e.content_type.startsWith("image/") ? <ImageIcon className="size-4 shrink-0" aria-hidden /> : <FileText className="size-4 shrink-0" aria-hidden />}
                <span className="min-w-0">
                  <span className="block truncate">{e.description ?? t("evidenceUntitled")}</span>
                  <span className="text-xs text-muted-foreground">
                    {e.uploaded_by_name ?? "—"} · {fmtSize(e.size_bytes)} · <DateTime value={e.created_at} relative />
                  </span>
                </span>
              </span>
              {can("safety.view_evidence") ? (
                <Button variant="outline" size="sm" onClick={() => void open(e.id)}>
                  {t("evidenceOpen")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {can("safety.manage") && !closed ? (
          <div className="space-y-2 border-t pt-3">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("evidenceDescription")} maxLength={500} aria-label={t("evidenceDescription")} />
            <input
              ref={input}
              type="file"
              className="sr-only"
              accept={EVIDENCE_CONTENT_TYPES.join(",")}
              onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
              aria-label={t("evidenceUpload")}
            />
            <Button variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
              <Upload className="size-4" />
              {busy ? t("evidenceUploading") : t("evidenceUpload")}
            </Button>
            <p className="text-xs text-muted-foreground">{t("evidenceHelp")}</p>
          </div>
        ) : null}
        {evidence.length > 0 ? <p className="text-xs text-muted-foreground">{t("evidenceLogged")}</p> : null}
      </CardContent>
    </Card>
  );
}
