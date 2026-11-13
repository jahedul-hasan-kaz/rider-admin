"use client";

import { Autocomplete } from "@/components/domain/autocomplete";
import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DensityToggle } from "./density";
import { SavedViews } from "./saved-views";
import { useUrlParams } from "./use-url-params";

export function Toolbar({ children, filterKeys = [] }: { children: ReactNode; filterKeys?: string[] }) {
  const t = useTranslations("common");
  const { searchParams, setParams } = useUrlParams();
  const active = filterKeys.some((k) => searchParams.get(k));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {active ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setParams(Object.fromEntries(filterKeys.map((k) => [k, null])))}
        >
          <X className="size-4" />
          {t("clearFilters")}
        </Button>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        <SavedViews />
        <DensityToggle />
      </div>
    </div>
  );
}

/** Debounced (300 ms) server-side search bound to a URL param. "/" focuses it. */
export function ToolbarSearch({ param = "q", placeholder }: { param?: string; placeholder: string }) {
  const { searchParams, setParams } = useUrlParams();
  const urlValue = searchParams.get(param) ?? "";
  const [value, setValue] = useState(urlValue);
  const [syncedUrlValue, setSyncedUrlValue] = useState(urlValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // Follow external URL changes (back button, "Clear filters") during render.
  if (syncedUrlValue !== urlValue) {
    setSyncedUrlValue(urlValue);
    setValue(urlValue);
  }

  useEffect(() => {
    if (value === urlValue) return;
    const timer = setTimeout(() => setParams({ [param]: value.trim() || null }), 300);
    return () => clearTimeout(timer);
  }, [value, urlValue, param, setParams]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (e.key === "/" && !el?.closest("input,textarea,select,[contenteditable=true]")) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative w-full sm:w-72">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-8"
      />
    </div>
  );
}

const ALL = "__all__";

export function ToolbarSelect({
  param,
  allLabel,
  options,
}: {
  param: string;
  allLabel: string;
  options: { value: string; label: string }[];
}) {
  const { searchParams, setParams } = useUrlParams();
  const value = searchParams.get(param) ?? ALL;

  // Long lists get a type-to-filter picker instead of a plain dropdown.
  if (options.length > 5) {
    return (
      <Autocomplete
        className="w-full sm:w-52"
        aria-label={allLabel}
        value={value === ALL ? "" : value}
        options={options}
        clearLabel={allLabel}
        onChange={(v) => setParams({ [param]: v || null })}
      />
    );
  }

  return (
    <Select value={value} onValueChange={(v) => setParams({ [param]: v === ALL ? null : v })}>
      <SelectTrigger className="w-full sm:w-44" aria-label={allLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
