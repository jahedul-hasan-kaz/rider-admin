"use client";

import {
  Bell,
  BellRing,
  Check,
  CheckCheck,
  FileDown,
  IdCard,
  LifeBuoy,
  ShieldAlert,
  Siren,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { DateTime } from "@/components/domain/date-time";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { getMyNotifications, markNotificationsRead, type NotificationList } from "@/server/actions/notifications";

const POLL_MS = 60_000;
type Item = NotificationList["items"][number];

/** Icon and colour by what the notification is about (the kind is a free-form code such as "sos" or "export_ready"). */
function look(kind: string): { icon: LucideIcon; tone: string } {
  const k = kind.toLowerCase();
  if (k.includes("sos") || k.includes("safety") || k.includes("incident")) return { icon: ShieldAlert, tone: "bg-danger-soft text-danger" };
  if (k.includes("refund") || k.includes("payout") || k.includes("ledger") || k.includes("payment") || k.includes("adjust"))
    return { icon: Wallet, tone: "bg-warning-soft text-warning" };
  if (k.includes("export")) return { icon: FileDown, tone: "bg-info-soft text-info" };
  if (k.includes("document") || k.includes("driver") || k.includes("vehicle")) return { icon: IdCard, tone: "bg-primary/10 text-primary" };
  if (k.includes("ticket") || k.includes("support")) return { icon: LifeBuoy, tone: "bg-info-soft text-info" };
  if (k.includes("alert")) return { icon: Siren, tone: "bg-danger-soft text-danger" };
  return { icon: Bell, tone: "bg-muted text-muted-foreground" };
}

function isToday(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function NotificationsMenu() {
  const t = useTranslations("notifications");
  const router = useRouter();
  const [data, setData] = useState<NotificationList | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [ring, setRing] = useState(false);
  const lastUnread = useRef<number | null>(null);

  const load = useCallback(() => {
    getMyNotifications()
      .then((next) => {
        // Ring the bell when something new arrives (not on the first load).
        if (lastUnread.current !== null && next.unread > lastUnread.current) {
          setRing(true);
          setTimeout(() => setRing(false), 1200);
        }
        lastUnread.current = next.unread;
        setData(next);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  async function markRead(ids?: string[]) {
    // Optimistic: the list updates at once, the server catches up.
    setData((d) =>
      d
        ? {
            unread: ids ? Math.max(0, d.unread - d.items.filter((n) => ids.includes(n.id) && !n.read_at).length) : 0,
            items: d.items.map((n) => (!ids || ids.includes(n.id) ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)),
          }
        : d,
    );
    await markNotificationsRead(ids ? { ids } : {});
    load();
  }

  function openItem(n: Item) {
    if (!n.read_at) void markRead([n.id]);
    if (n.link) {
      setOpen(false);
      router.push(n.link as Route);
    }
  }

  const unread = data?.unread ?? 0;
  const items = (data?.items ?? []).filter((n) => tab === "all" || !n.read_at);
  const groups = [
    { key: "today", items: items.filter((n) => isToday(n.created_at)) },
    { key: "earlier", items: items.filter((n) => !isToday(n.created_at)) },
  ].filter((g) => g.items.length > 0);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) load();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t("unread", { count: unread })}>
          {unread > 0 ? <BellRing className={cn("size-4", ring && "animate-bell")} /> : <Bell className="size-4" />}
          {unread > 0 ? (
            <span className="absolute top-0.5 right-0.5 flex">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-60" />
              <span className="relative flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] leading-4 font-semibold text-white ring-2 ring-background">
                {unread > 9 ? "9+" : unread}
              </span>
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[23rem] overflow-hidden rounded-2xl p-0 shadow-xl">
        <div className="relative border-b bg-gradient-to-br from-primary/15 via-primary/5 to-transparent px-4 pt-4 pb-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-base font-semibold">{t("title")}</p>
              <p className="text-xs text-muted-foreground">{unread > 0 ? t("unread", { count: unread }) : t("empty")}</p>
            </div>
            {unread > 0 ? (
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => void markRead()}>
                <CheckCheck className="size-3.5" />
                {t("markAllRead")}
              </Button>
            ) : null}
          </div>
          <div className="mt-3 inline-flex rounded-full bg-background/70 p-0.5 text-xs shadow-xs ring-1 ring-border" role="tablist">
            {(["all", "unread"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn(
                  "rounded-full px-3 py-1 font-medium transition-all",
                  tab === k ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {k === "all" ? t("tabAll") : t("tabUnread", { count: unread })}
              </button>
            ))}
          </div>
        </div>

        {groups.length > 0 ? (
          <ScrollArea className="max-h-[26rem]">
            {groups.map((g) => (
              <section key={g.key} className="pb-1">
                <p className="sticky top-0 z-10 bg-popover/95 px-4 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur">
                  {t(g.key)}
                </p>
                <ul className="px-2">
                  {g.items.map((n, i) => {
                    const { icon: Icon, tone } = look(n.kind);
                    return (
                      <li
                        key={n.id}
                        className="group relative duration-300 animate-in fade-in-0 slide-in-from-right-2 fill-mode-both"
                        style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
                      >
                        <button
                          type="button"
                          onClick={() => openItem(n)}
                          className={cn(
                            "flex w-full items-start gap-3 rounded-xl px-2 py-2.5 text-left text-sm transition-colors hover:bg-muted",
                            !n.read_at && "bg-primary/[0.04]",
                          )}
                        >
                          <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", tone)}>
                            <Icon className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1 space-y-0.5 pr-6">
                            <span className={cn("block truncate", n.read_at ? "font-normal" : "font-semibold")}>{n.title}</span>
                            {n.body ? <span className="line-clamp-2 block text-xs text-muted-foreground">{n.body}</span> : null}
                            <span className="block text-[11px] text-muted-foreground">
                              <DateTime value={n.created_at} relative />
                            </span>
                          </span>
                        </button>
                        {!n.read_at ? (
                          <>
                            <span className="pointer-events-none absolute top-4 right-3 size-2 rounded-full bg-primary transition-opacity group-hover:opacity-0" aria-hidden />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="absolute top-2 right-1 size-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                              aria-label={t("markRead")}
                              onClick={() => void markRead([n.id])}
                            >
                              <Check className="size-3.5" />
                            </Button>
                          </>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </ScrollArea>
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <svg viewBox="0 0 120 90" className="h-20 w-28 text-primary" aria-hidden>
              <ellipse cx="60" cy="80" rx="38" ry="5" className="fill-muted" />
              <path d="M60 14c-14 0-24 10-24 25v14l-7 11h62l-7-11V39c0-15-10-25-24-25z" className="fill-primary/15 stroke-current" strokeWidth="2.5" strokeLinejoin="round" />
              <path d="M52 70a8 8 0 0016 0" fill="none" className="stroke-current" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M50 42l7 7 13-14" fill="none" className="stroke-current" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="95" cy="20" r="3" className="fill-primary/40" />
              <circle cx="22" cy="30" r="2" className="fill-primary/40" />
            </svg>
            <p className="text-sm font-medium">{tab === "unread" ? t("emptyUnread") : t("empty")}</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
