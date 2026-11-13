"use client";

import { Search } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useCan } from "@/components/permissions-provider";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NAV_GROUPS, PROFILE_ITEM } from "./nav-config";

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el?.closest("input,textarea,select,[contenteditable=true],[role=dialog]"));
}

/** ⌘K / Ctrl K palette plus "g <key>" navigation and "?" help (spec §4.8). */
export function CommandPalette() {
  const t = useTranslations("nav");
  const router = useRouter();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const groups = useMemo(
    () =>
      NAV_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((i) => !i.permission || can(i.permission)),
      }))
        .concat([{ key: "profile", items: [PROFILE_ITEM] }])
        .filter((g) => g.items.length > 0),
    [can],
  );
  const shortcuts = useMemo(
    () =>
      new Map(
        groups
          .flatMap((g) => g.items)
          .filter((i) => i.shortcut)
          .map((i) => [i.shortcut!, i.href]),
      ),
    [groups],
  );

  useEffect(() => {
    let leader = false;
    let leaderTimer: ReturnType<typeof setTimeout> | undefined;

    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "?") {
        setHelpOpen(true);
        return;
      }
      if (leader) {
        leader = false;
        const href = shortcuts.get(e.key);
        if (href) router.push(href);
        return;
      }
      if (e.key === "g") {
        leader = true;
        clearTimeout(leaderTimer);
        leaderTimer = setTimeout(() => (leader = false), 1000);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(leaderTimer);
    };
  }, [router, shortcuts]);

  return (
    <>
      <Button
        variant="outline"
        className="h-9 w-9 justify-start gap-2 px-2 text-muted-foreground sm:w-64 sm:px-3"
        onClick={() => setOpen(true)}
        aria-label={t("openSearch")}
      >
        <Search className="size-4" />
        <span className="hidden flex-1 text-left sm:inline">{t("openSearch")}…</span>
        <kbd className="pointer-events-none hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">
          ⌘K
        </kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t("openSearch")}
        description={t("searchPlaceholder")}
      >
        <Command>
          <CommandInput placeholder={t("searchPlaceholder")} />
          <CommandList>
            <CommandEmpty>{t("noResults")}</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup
                key={group.key}
                heading={group.key === "profile" ? undefined : t(group.key)}
              >
                {group.items.map((item) => (
                  <CommandItem
                    key={item.href}
                    value={`${t(item.key)} ${item.href}`}
                    onSelect={() => {
                      setOpen(false);
                      router.push(item.href as Route);
                    }}
                  >
                    <item.icon aria-hidden />
                    {t(item.key)}
                    {item.shortcut ? <CommandShortcut>g {item.shortcut}</CommandShortcut> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("shortcutsTitle")}</DialogTitle>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt>
              <kbd className="rounded border bg-muted px-1.5 font-mono text-xs">⌘K</kbd>
            </dt>
            <dd>{t("shortcutPalette")}</dd>
            <dt>
              <kbd className="rounded border bg-muted px-1.5 font-mono text-xs">
                g d · g a · g u · g p
              </kbd>
            </dt>
            <dd>{t("shortcutGo")}</dd>
            <dt>
              <kbd className="rounded border bg-muted px-1.5 font-mono text-xs">/</kbd>
            </dt>
            <dd>{t("searchPlaceholder")}</dd>
            <dt>
              <kbd className="rounded border bg-muted px-1.5 font-mono text-xs">j k ↵</kbd>
            </dt>
            <dd>↑ ↓ ↵</dd>
            <dt>
              <kbd className="rounded border bg-muted px-1.5 font-mono text-xs">?</kbd>
            </dt>
            <dd>{t("shortcutHelp")}</dd>
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
