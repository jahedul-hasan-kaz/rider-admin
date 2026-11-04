import type { ActionResult } from "@/server/actions/run";

export type ActionError = Extract<ActionResult<unknown>, { ok: false }>["error"];

const KNOWN = new Set([
  "VALIDATION_FAILED",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "MFA_REQUIRED",
  "PRIVILEGE_ESCALATION",
  "SELF_LOCKOUT",
  "LAST_SUPER_ADMIN",
  "BUILTIN_TEMPLATE",
  "TEMPLATE_IN_USE",
  "ALREADY_EXISTS",
  "NOT_FOUND",
  "STALE_VERSION",
  "SELF_APPROVAL",
  "NOTHING_TO_PAY",
  "PROMO_INVALID",
  "PIN_REQUIRED",
  "ACCOUNT_HAS_DUES",
  "INVALID_PIN",
  "PIN_LOCKED",
  "IMMUTABLE_ROW",
  "INVALID_STATE_TRANSITION",
  "UPSTREAM_UNAVAILABLE",
  "RATE_LIMITED",
  "INTERNAL",
]);

/** Translation key under "errors" for an action error code. */
export function errorKey(code: string): string {
  return KNOWN.has(code) ? code : "INTERNAL";
}

/** Field-level messages from a VALIDATION_FAILED error, keyed by path. */
export function fieldErrors(error: ActionError | null | undefined): Record<string, string> {
  const fields = error?.details?.fields;
  if (!Array.isArray(fields)) return {};
  const out: Record<string, string> = {};
  for (const f of fields) {
    if (f && typeof f === "object" && "path" in f && "message" in f) {
      out[String(f.path)] = String(f.message);
    }
  }
  return out;
}
