"use client";

import { getCoreRowModel, useReactTable, type ColumnDef, type RowData, type VisibilityState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useUrlParams } from "@/components/data-table/use-url-params";
import { useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Server sort key (the list RPC's `p_sort` whitelist). Makes the header a sort toggle. */
    sortKey?: string;
  }
}

/** Parses the `sort` URL param ("key" ascending, "-key" descending). */
function parseSort(value: string | null): { key: string; desc: boolean } | null {
  if (!value) return null;
  return value.startsWith("-") ? { key: value.slice(1), desc: true } : { key: value, desc: false };
}

/**
 * Renders a header or cell definition by calling it, not by mounting it as a component (what flexRender does).
 * Column definitions are rebuilt whenever translations or permissions change (e.g. after router.refresh()); as
 * components they would remount every cell and drop the state of dialogs opened inside rows.
 */
function render<C>(def: unknown, context: C): ReactNode {
  return typeof def === "function" ? ((def as (c: C) => ReactNode)(context)) : (def as ReactNode);
}

type Props<T> = {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  getRowId: (row: T) => string;
  /** Row click target. Ctrl/⌘-click opens it in a new tab. */
  getRowHref?: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty: ReactNode;
  pending?: boolean;
  caption?: string;
};

/**
 * One table for every list page (spec §4.1). Sorting, filtering and paging are
 * server-side and URL-driven; this component only renders and navigates.
 * Rows are keyboard navigable: j/k or ↑/↓ to move, Enter to open.
 */
export function DataTable<T>({ columns, data, getRowId, getRowHref, onRowClick, empty, pending, caption }: Props<T>) {
  const router = useRouter();
  const { searchParams, setParams } = useUrlParams();
  const sort = parseSort(searchParams.get("sort"));
  // none -> descending -> ascending -> none; changing the sort always returns to the first page.
  function toggleSort(key: string) {
    const next = sort?.key !== key ? `-${key}` : sort.desc ? key : null;
    setParams({ sort: next });
  }
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const storageKey = caption ? `rider-admin:columns:${caption}` : null;
  const [visibility, setVisibility] = useState<VisibilityState>({});
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      // Restoring the person's saved column choice after mount (the server cannot know it).
       
      if (raw) setVisibility(JSON.parse(raw) as VisibilityState);
    } catch {
      // Ignore unreadable or unavailable storage: every column simply shows.
    }
  }, [storageKey]);
  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel(), getRowId, state: { columnVisibility: visibility }, onColumnVisibilityChange: setVisibility });
  const toggleable = table.getAllLeafColumns().filter((c) => typeof c.columnDef.header === "string" && c.columnDef.header !== "");
  function setColumn(id: string, visible: boolean) {
    const next = { ...visibility, [id]: visible };
    setVisibility(next);
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Storage can be unavailable; the choice still applies until the page reloads.
      }
    }
  }
  const interactive = Boolean(getRowHref || onRowClick);

  function open(row: T, event?: MouseEvent | KeyboardEvent) {
    const href = getRowHref?.(row);
    if (href) {
      if (event && (event.metaKey || event.ctrlKey)) window.open(href, "_blank", "noopener");
      else router.push(href as Route);
    } else {
      onRowClick?.(row);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTableRowElement>, row: T) {
    const target = event.currentTarget;
    if (event.key === "Enter") {
      event.preventDefault();
      open(row, event);
    } else if (event.key === "j" || event.key === "ArrowDown") {
      event.preventDefault();
      (target.nextElementSibling as HTMLElement | null)?.focus();
    } else if (event.key === "k" || event.key === "ArrowUp") {
      event.preventDefault();
      (target.previousElementSibling as HTMLElement | null)?.focus();
    }
  }

  return (
    <div className="space-y-2">
      {toggleable.length > 4 ? (
        <div className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Columns">
                <Columns3 className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 p-2">
              <DropdownMenuLabel>Columns</DropdownMenuLabel>
              {toggleable.map((c) => (
                <label key={c.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <Checkbox checked={c.getIsVisible()} onCheckedChange={(v) => setColumn(c.id, v === true)} />
                  {String(c.columnDef.header)}
                </label>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    <div className={cn("overflow-hidden rounded-lg border bg-card transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      <Table>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id} className="hover:bg-transparent">
              {group.headers.map((header) => {
                const sortKey = header.column.columnDef.meta?.sortKey;
                const content = header.isPlaceholder ? null : render(header.column.columnDef.header, header.getContext());
                const active = sortKey !== undefined && sort?.key === sortKey ? sort : null;
                const Icon = active ? (active.desc ? ArrowDown : ArrowUp) : ArrowUpDown;
                return (
                  <TableHead
                    key={header.id}
                    className="h-10 text-xs font-semibold tracking-wide text-foreground/70 uppercase"
                    aria-sort={sortKey ? (active ? (active.desc ? "descending" : "ascending") : "none") : undefined}
                  >
                    {sortKey && !header.isPlaceholder ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(sortKey)}
                        className={cn(
                          "-mx-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 uppercase transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                          active && "text-foreground",
                        )}
                      >
                        {content}
                        <Icon className={cn("size-3.5", !active && "opacity-50")} aria-hidden />
                      </button>
                    ) : (
                      content
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody ref={bodyRef}>
          {table.getRowModel().rows.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="p-0">
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                tabIndex={interactive ? 0 : undefined}
                className={cn(interactive && "cursor-pointer focus-visible:bg-muted focus-visible:outline-none")}
                onClick={interactive ? (e) => {
                  if ((e.target as HTMLElement).closest("a,button,[role=menuitem]")) return;
                  open(row.original, e);
                } : undefined}
                onKeyDown={interactive ? (e) => onKeyDown(e, row.original) : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="h-12 [[data-density=compact]_&]:h-9 [[data-density=compact]_&]:py-1">
                    {render(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
    </div>
  );
}
