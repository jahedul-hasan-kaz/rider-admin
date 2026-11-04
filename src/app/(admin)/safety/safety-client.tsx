"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { BellRing, ShieldAlert, Volume2, VolumeX } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CursorPagination } from "@/components/data-table/cursor-pagination";
import { DataTable } from "@/components/data-table/data-table";
import { DateTime } from "@/components/domain/date-time";
import { EmptyState } from "@/components/domain/empty-state";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/format";
import { loadSafetyQueue } from "@/server/actions/finance";
import type { IncidentRow } from "@/server/queries/care";

type Counts = { open: number; unacknowledged: number; critical: number };

/** A short two-tone alert generated in the browser (no audio file to ship or block). */
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.15;
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.25);
      osc.stop(ctx.currentTime + i * 0.25 + 0.2);
    });
    setTimeout(() => void ctx.close(), 1200);
  } catch {
    // Audio can be unavailable (autoplay policy, no device); the visual alert still shows.
  }
}

/**
 * The open-incident queue. It polls every 5 s so a new SOS is seen within seconds, and
 * raises a visible banner (and, if enabled, a sound) the moment an unacknowledged incident appears.
 */
export function SafetyQueue({ initialRows, initialCounts, live, nextCursor }: { initialRows: IncidentRow[]; initialCounts: Counts; live: boolean; nextCursor: string | null }) {
  const t = useTranslations("safety");
  const label = useStatusLabel();
  const [rows, setRows] = useState(initialRows);
  const [counts, setCounts] = useState(initialCounts);
  const [sound, setSound] = useState(false);
  const [alert, setAlert] = useState(false);
  const seen = useRef(new Set(initialRows.map((r) => r.id)));
  const soundRef = useRef(sound);
  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  const poll = useCallback(async () => {
    const result = await loadSafetyQueue();
    if (!result.ok) return;
    const fresh = result.data.rows.filter((r) => !seen.current.has(r.id) && r.status === "reported");
    for (const r of result.data.rows) seen.current.add(r.id);
    if (fresh.length > 0) {
      setAlert(true);
      if (soundRef.current) beep();
    }
    setRows(result.data.rows);
    setCounts(result.data.counts);
  }, []);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => void poll(), 5000);
    return () => clearInterval(timer);
  }, [live, poll]);

  const columns = useMemo<ColumnDef<IncidentRow, unknown>[]>(
    () => [
      {
        id: "incident",
        header: t("colIncident"),
        cell: ({ row }) => (
          <div>
            <p className="font-medium">
              <span className="text-muted-foreground tabular">#{row.original.incident_no}</span> {t(`kind_${row.original.kind}`)}
            </p>
            <p className="text-xs text-muted-foreground capitalize">{t("reportedBy", { name: row.original.reporter_name ?? "—", role: row.original.reporter_role })}</p>
          </div>
        ),
      },
      { id: "severity", meta: { sortKey: "severity" }, header: t("colSeverity"), cell: ({ row }) => <StatusBadge status={row.original.severity} label={label(row.original.severity)} /> },
      { id: "status", meta: { sortKey: "status" }, header: t("colStatus"), cell: ({ row }) => <StatusBadge status={row.original.status} label={label(row.original.status)} /> },
      { id: "assignee", header: t("colAssignee"), cell: ({ row }) => row.original.assignee_name ?? <span className="text-muted-foreground">{t("unassigned")}</span> },
      {
        id: "age",
        header: t("colOpen"),
        cell: ({ row }) =>
          row.original.open_seconds !== null ? (
            <span className={row.original.status === "reported" ? "font-medium text-danger tabular" : "tabular"}>{formatDuration(row.original.open_seconds)}</span>
          ) : row.original.seconds_to_acknowledge !== null ? (
            <span className="text-muted-foreground tabular">{t("acked", { time: formatDuration(row.original.seconds_to_acknowledge) })}</span>
          ) : (
            "—"
          ),
      },
      { id: "reported", meta: { sortKey: "reported_at" }, header: t("colReported"), cell: ({ row }) => <DateTime value={row.original.reported_at} relative /> },
    ],
    [t, label],
  );

  return (
    <div className="space-y-3">
      {alert || counts.unacknowledged > 0 ? (
        <Alert variant="destructive" role="alert">
          <BellRing className="size-4" />
          <AlertTitle>{t("unackedTitle", { count: counts.unacknowledged })}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{t("unackedBody")}</span>
            <Button variant="outline" size="sm" onClick={() => setAlert(false)}>
              {t("dismiss")}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {live ? (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{t("polling")}</span>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={sound}
            onClick={() => {
              const next = !sound;
              setSound(next);
              if (next) beep(); // also satisfies the browser's "user gesture" rule for audio
            }}
          >
            {sound ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            {sound ? t("soundOn") : t("soundOff")}
          </Button>
        </div>
      ) : null}
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        getRowHref={(r) => `/safety/${r.id}`}
        caption={t("title")}
        empty={<EmptyState icon={ShieldAlert} title={t("empty")} />}
      />
      <CursorPagination nextCursor={nextCursor} />
    </div>
  );
}
