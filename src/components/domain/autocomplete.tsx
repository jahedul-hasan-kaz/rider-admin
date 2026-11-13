"use client";

import { Check, ChevronsUpDown, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { searchOptions, type OptionKind, type SearchOption } from "@/server/actions/options";

export type { SearchOption };

type Props = {
  value: string;
  onChange: (value: string, option: SearchOption | null) => void;
  /** Server-side search (the database filters and returns at most 20 matches). */
  source?: OptionKind;
  /** A fixed list (filtered locally while typing). */
  options?: SearchOption[];
  /** Label of the current value when it is not in `options` (server lists load only on open). */
  selectedLabel?: string;
  placeholder?: string;
  /** Shows a "clear" entry with this label (e.g. "All zones"). */
  clearLabel?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
};

/**
 * A searchable picker. Replaces plain dropdowns whose list can grow past a handful of items: type to narrow, arrow
 * keys and Enter to choose. Used for zones, vehicle types, passengers, drivers and long fixed lists.
 */
export function Autocomplete({ value, onChange, source, options, selectedLabel, placeholder, clearLabel, id, className, disabled, ...rest }: Props) {
  const t = useTranslations("common");
  const fallbackId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<SearchOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<SearchOption | null>(null);

  useEffect(() => {
    if (!source || !open) return;
    let live = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      const res = await searchOptions({ kind: source, query });
      if (live) {
        setRemote(res.ok ? res.data : []);
        setLoading(false);
      }
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [source, query, open]);

  const list = source ? remote : (options ?? []).filter((o) => !query || `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const current =
    (picked?.value === value ? picked : null) ?? (options ?? []).find((o) => o.value === value) ?? remote.find((o) => o.value === value) ?? null;
  const label = value ? (current?.label ?? selectedLabel ?? value) : (clearLabel ?? placeholder ?? "");

  function choose(option: SearchOption | null) {
    setPicked(option);
    onChange(option?.value ?? "", option);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id ?? fallbackId}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={rest["aria-label"]}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground", className)}
        >
          <span className="truncate">{label || placeholder}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-56 p-0">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder={t("typeToSearch")} />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t("searching")}
              </div>
            ) : (
              <CommandEmpty>{t("noMatches")}</CommandEmpty>
            )}
            <CommandGroup>
              {clearLabel && !query ? (
                <CommandItem value="__clear__" onSelect={() => choose(null)}>
                  <X className="size-4 opacity-60" />
                  {clearLabel}
                </CommandItem>
              ) : null}
              {!loading &&
                list.map((o) => (
                  <CommandItem key={o.value} value={o.value} onSelect={() => choose(o)}>
                    <Check className={cn("size-4", o.value === value ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{o.label}</span>
                    {o.hint ? <span className="ml-auto truncate pl-2 text-xs text-muted-foreground">{o.hint}</span> : null}
                  </CommandItem>
                ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
