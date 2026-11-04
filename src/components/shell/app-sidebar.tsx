"use client";

import { CarFront, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCan } from "@/components/permissions-provider";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useCallback, useEffect, useState } from "react";
import { publicEnv } from "@/lib/env.public";
import { cn } from "@/lib/utils";
import { getNavCounts, type NavCounts } from "@/server/actions/nav";
import { NAV_GROUPS, PROFILE_ITEM, type NavItem } from "./nav-config";

const ENV_CLASS = {
  production: "bg-danger text-white",
  staging: "bg-warning text-black",
  local: "bg-neutral-soft text-neutral",
} as const;

const COUNTS_POLL_MS = 60_000;

/** Pending-work badges, refreshed every minute while the tab is visible. */
function useNavCounts(): NavCounts {
  const pathname = usePathname();
  const [counts, setCounts] = useState<NavCounts>({});
  useEffect(() => {
    const load = () => {
      if (document.visibilityState === "visible") getNavCounts().then(setCounts).catch(() => undefined);
    };
    load();
    const timer = setInterval(load, COUNTS_POLL_MS);
    return () => clearInterval(timer);
  }, [pathname]); // also refresh after navigating (e.g. after reviewing a document)
  return counts;
}

const COLLAPSED_KEY = "rider-admin:nav-collapsed";

/** Which nav groups the person folded away, remembered in this browser. */
function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY);
      // Restoring the saved choice after mount (the server cannot know it).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setCollapsed(JSON.parse(raw) as string[]);
    } catch {
      // Unavailable storage: every group starts open.
    }
  }, []);
  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
      } catch {
        // The choice still applies until the page reloads.
      }
      return next;
    });
  }, []);
  return { collapsed, toggle };
}

function isActive(pathname: string, href: string) {
  if (href === "/admins") return pathname === "/admins" || /^\/admins\/(?!templates)[^/]+/.test(pathname);
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar() {
  const t = useTranslations();
  const pathname = usePathname();
  const can = useCan();
  const env = publicEnv.NEXT_PUBLIC_APP_ENV;

  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || can(i.permission)) })).filter(
    (g) => g.items.length > 0,
  );
  const counts = useNavCounts();
  const { collapsed, toggle } = useCollapsedGroups();
  const { state, isMobile, setOpenMobile } = useSidebar();
  // On phones the menu is a panel over the page: close it once a page is chosen.
  useEffect(() => {
    setOpenMobile(false);
  }, [pathname, setOpenMobile]);

  const renderItem = (item: NavItem) => {
    const count = item.countKey ? counts[item.countKey] : undefined;
    return (
      <SidebarMenuItem key={item.href}>
        <SidebarMenuButton asChild isActive={isActive(pathname, item.href)} tooltip={t(`nav.${item.key}`)}>
          <Link href={item.href}>
            <item.icon aria-hidden />
            <span>{t(`nav.${item.key}`)}</span>
          </Link>
        </SidebarMenuButton>
        {count ? <SidebarMenuBadge className="tabular">{count > 99 ? "99+" : count}</SidebarMenuBadge> : null}
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem className={isMobile ? "pr-10" : undefined}>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                <span className="flex aspect-square size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <CarFront className="size-4" aria-hidden />
                </span>
                <span className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">{t("common.appName")}</span>
                  <span
                    className={cn("w-fit rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider", ENV_CLASS[env])}
                    data-testid="env-ribbon"
                  >
                    {t(`env.${env}`)}
                  </span>
                </span>
              </Link>
            </SidebarMenuButton>
            {isMobile ? (
              <button
                type="button"
                onClick={() => setOpenMobile(false)}
                aria-label={t("common.closeMenu")}
                className="absolute top-1/2 right-0 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <X className="size-5" />
              </button>
            ) : null}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group) => {
          const hasActive = group.items.some((i) => isActive(pathname, i.href));
          // The group with the current page always shows; in icon-only mode every item shows.
          const open = state === "collapsed" || hasActive || !collapsed.includes(group.key);
          const pending = group.items.reduce((sum, i) => sum + (i.countKey ? (counts[i.countKey] ?? 0) : 0), 0);
          const contentId = `nav-group-${group.key}`;
          return (
            <SidebarGroup key={group.key} className="py-1">
              <SidebarGroupLabel asChild>
                <button
                  type="button"
                  onClick={() => toggle(group.key)}
                  aria-expanded={open}
                  aria-controls={contentId}
                  disabled={hasActive}
                  className="group/label w-full cursor-pointer gap-1 rounded-md transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <ChevronRight className={cn("size-3.5! transition-transform duration-200", open && "rotate-90")} aria-hidden />
                  <span className="flex-1 text-left">{t(`nav.${group.key}`)}</span>
                  {!open && pending > 0 ? (
                    <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary tabular duration-200 animate-in zoom-in-50">
                      {pending > 99 ? "99+" : pending}
                    </span>
                  ) : null}
                </button>
              </SidebarGroupLabel>
              <div
                id={contentId}
                className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-out", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}
              >
                <SidebarGroupContent className="overflow-hidden" inert={!open}>
                  <SidebarMenu>{group.items.map(renderItem)}</SidebarMenu>
                </SidebarGroupContent>
              </div>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>{renderItem(PROFILE_ITEM)}</SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
