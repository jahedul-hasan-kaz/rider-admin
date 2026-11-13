"use client";

import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";

/**
 * Table state lives in the URL (spec §4.1): shareable views, working back
 * button. Changing a filter resets the cursor to the first page.
 */
export function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const setParams = useCallback(
    (updates: Record<string, string | null | undefined>, { resetCursor = true } = {}) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === undefined || value === "") next.delete(key);
        else next.set(key, value);
      }
      if (resetCursor && !("cursor" in updates)) next.delete("cursor");
      const query = next.toString();
      startTransition(() => {
        router.replace((query ? `${pathname}?${query}` : pathname) as Route, { scroll: false });
      });
    },
    [pathname, router, searchParams],
  );

  return { searchParams, setParams, pending };
}
