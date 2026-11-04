"use client";

import { Lock, UserCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { DateTime } from "@/components/domain/date-time";
import { StatusBadge } from "@/components/domain/status-badge";
import { useStatusLabel } from "@/components/domain/status-text";
import { useCan } from "@/components/permissions-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorKey } from "@/lib/action-errors";
import { cn } from "@/lib/utils";
import { assignTicket, replyTicket, setTicketPriority, setTicketStatus } from "@/server/actions/finance";
import type { TicketDetail } from "@/server/queries/care";

export function TicketBadges({ ticket }: { ticket: TicketDetail }) {
  const label = useStatusLabel();
  return (
    <>
      <StatusBadge status={ticket.status} label={label(ticket.status)} />
      <StatusBadge status={ticket.priority} label={label(ticket.priority)} />
    </>
  );
}

const NEXT_STATUS: Record<string, string[]> = {
  open: ["in_progress", "pending_user", "resolved"],
  in_progress: ["pending_user", "resolved"],
  pending_user: ["in_progress", "resolved"],
  resolved: ["closed", "open"],
  closed: [],
};

export function TicketActions({ ticket, me }: { ticket: TicketDetail; me: string }) {
  const t = useTranslations("support");
  const label = useStatusLabel();
  const can = useCan();
  const router = useRouter();
  const [pending, start] = useTransition();

  function run(promise: Promise<{ ok: boolean }>, message: string) {
    start(async () => {
      const result = await promise;
      if (result.ok) {
        toast.success(message);
        router.refresh();
      } else {
        toast.error(t("actionFailed"));
      }
    });
  }

  const statuses = NEXT_STATUS[ticket.status] ?? [];
  return (
    <>
      {can("support.assign") && ticket.assignee_id !== me ? (
        <Button variant="outline" disabled={pending} onClick={() => run(assignTicket({ id: ticket.id, toMe: true }), t("assigned"))}>
          <UserCheck className="size-4" />
          {t("assignToMe")}
        </Button>
      ) : null}
      {can("support.manage") ? (
        <>
          <Select value={ticket.priority} onValueChange={(v) => run(setTicketPriority({ id: ticket.id, priority: v as "low" }), t("priorityChanged"))}>
            <SelectTrigger className="w-32" aria-label={t("colPriority")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["low", "normal", "high", "urgent"].map((p) => (
                <SelectItem key={p} value={p}>
                  {label(p)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {statuses.length > 0 ? (
            <Select value="" onValueChange={(v) => run(setTicketStatus({ id: ticket.id, status: v as "open" }), t("statusChanged"))}>
              <SelectTrigger className="w-40" aria-label={t("changeStatus")}>
                <SelectValue placeholder={t("changeStatus")} />
              </SelectTrigger>
              <SelectContent>
                {statuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {label(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </>
      ) : null}
    </>
  );
}

export function TicketThread({ ticket }: { ticket: TicketDetail }) {
  const t = useTranslations("support");
  const tErr = useTranslations("errors");
  const can = useCan();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const closed = ticket.status === "closed";

  function send() {
    if (!body.trim()) return;
    setError(null);
    start(async () => {
      const result = await replyTicket({ id: ticket.id, body, internal });
      if (result.ok) {
        setBody("");
        toast.success(internal ? t("noteSaved") : t("replySent"));
        router.refresh();
      } else {
        setError(tErr(errorKey(result.error.code)));
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-3">
        {ticket.sla_breached ? (
          <Alert variant="destructive">
            <AlertDescription>{t("slaBreachedBody")}</AlertDescription>
          </Alert>
        ) : null}
        <ol className="space-y-3" aria-label={t("conversation")}>
          {ticket.messages.map((m) => (
            <li key={m.id} className={cn("flex", m.author_type === "admin" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] space-y-1 rounded-lg border px-3 py-2",
                  m.is_internal ? "border-warning/40 bg-warning-soft" : m.author_type === "admin" ? "bg-primary/5" : "bg-card",
                )}
              >
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {m.is_internal ? <Lock className="size-3" aria-hidden /> : null}
                  <span className="font-medium text-foreground">
                    {m.author_type === "system" ? t("system") : (m.author_name ?? t(`author_${m.author_type}`))}
                  </span>
                  {m.is_internal ? <span>{t("internalNote")}</span> : null}
                  <DateTime value={m.created_at} relative />
                </p>
                <p className="text-sm whitespace-pre-wrap">{m.body}</p>
              </div>
            </li>
          ))}
        </ol>

        {can("support.manage") && !closed ? (
          <Card>
            <CardContent className="space-y-3 p-4">
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={internal ? t("notePlaceholder") : t("replyPlaceholder")}
                rows={4}
                maxLength={4000}
                aria-label={t("replyLabel")}
              />
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={internal} onCheckedChange={(v) => setInternal(v === true)} />
                  {t("internalToggle")}
                </label>
                <Button onClick={send} disabled={pending || !body.trim()}>
                  {internal ? t("addNote") : t("sendReply")}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">{t("details")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3 text-sm">
            <Row label={t("colRequester")}>
              {ticket.requester_name ?? "—"} <span className="text-muted-foreground capitalize">({ticket.requester_role})</span>
            </Row>
            <Row label={t("colAssignee")}>{ticket.assignee_name ?? t("unassigned")}</Row>
            <Row label={t("category")}>{t(`cat_${ticket.category}`)}</Row>
            <Row label={t("colSla")}>
              <DateTime value={ticket.sla_due_at} />
            </Row>
            <Row label={t("firstResponse")}>{ticket.first_response_at ? <DateTime value={ticket.first_response_at} relative /> : t("none")}</Row>
            <Row label={t("created")}>
              <DateTime value={ticket.created_at} />
            </Row>
            {ticket.trip_id ? (
              <Row label={t("trip")}>
                <Link href={`/trips/${ticket.trip_id}`} className="font-mono text-xs underline-offset-2 hover:underline">
                  {ticket.trip_id.slice(0, 8)}
                </Link>
              </Row>
            ) : null}
          </dl>
        </CardContent>
      </Card>
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
