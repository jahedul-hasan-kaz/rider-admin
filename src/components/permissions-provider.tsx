"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { Permission } from "@/lib/permissions";

const PermissionsContext = createContext<ReadonlySet<Permission> | null>(null);

/**
 * Makes the signed-in admin's effective permissions available to client
 * components. UX only: hides controls the admin cannot use. The server and
 * database enforce every permission (docs/spec/02-roles-permissions.md §4).
 */
export function PermissionsProvider({ permissions, children }: { permissions: Permission[]; children: ReactNode }) {
  // Keyed by content: the server sends a new array on every refresh, and a new Set would invalidate every consumer.
  const key = [...permissions].sort().join("|");
  const set = useMemo(() => new Set(key ? (key.split("|") as Permission[]) : []), [key]);
  return <PermissionsContext value={set}>{children}</PermissionsContext>;
}

export function useCan() {
  const permissions = useContext(PermissionsContext);
  if (!permissions) throw new Error("useCan must be used inside PermissionsProvider");
  return useCallback((permission: Permission) => permissions.has(permission), [permissions]);
}

export function Can({ permission, children }: { permission: Permission; children: ReactNode }) {
  return useCan()(permission) ? children : null;
}
