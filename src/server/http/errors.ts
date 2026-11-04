import type { PostgrestError } from "@supabase/supabase-js";
import type { ZodError } from "zod";

// Error codes and HTTP mapping from docs/spec/05-api.md §1.
const STATUS_BY_CODE = {
  VALIDATION_FAILED: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  ACCOUNT_SUSPENDED: 403,
  ROLE_NOT_ALLOWED: 403,
  DRIVER_NOT_APPROVED: 403,
  VEHICLE_NOT_ACTIVE: 403,
  MFA_REQUIRED: 403,
  PRIVILEGE_ESCALATION: 403,
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  LAST_SUPER_ADMIN: 409,
  SELF_LOCKOUT: 409,
  BUILTIN_TEMPLATE: 409,
  TEMPLATE_IN_USE: 409,
  IMMUTABLE_ROW: 409,
  APPEND_ONLY: 409,
  DELETE_FORBIDDEN: 409,
  INVALID_STATE_TRANSITION: 409,
  OFFER_NO_LONGER_AVAILABLE: 409,
  ACTIVE_REQUEST_EXISTS: 409,
  STALE_VERSION: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  QUOTE_EXPIRED: 409,
  ROLE_IMMUTABLE: 409,
  SELF_APPROVAL: 403,
  NOTHING_TO_PAY: 409,
  LEDGER_UNBALANCED: 500,
  OUT_OF_SERVICE_AREA: 422,
  PRICING_UNAVAILABLE: 422,
  PROMO_INVALID: 422,
  PIN_REQUIRED: 422,
  ACCOUNT_HAS_DUES: 409,
  INVALID_PIN: 422,
  PIN_LOCKED: 409,
  LOCATION_STALE: 422,
  TOO_FAR_FROM_PICKUP: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UPSTREAM_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof STATUS_BY_CODE;

export function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(STATUS_BY_CODE, value);
}

export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message?: string, details: Record<string, unknown> = {}) {
    super(message ?? code);
    this.name = "AppError";
    this.code = code;
    this.status = statusForCode(code);
    this.details = details;
  }
}

export function fromZodError(error: ZodError): AppError {
  const fields = error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  return new AppError("VALIDATION_FAILED", "Some fields are invalid.", { fields });
}

/**
 * Maps a PostgREST/RPC error to an AppError. Business errors are raised in SQL
 * as SQLSTATE P0001 with MESSAGE = '<CODE>' and optional JSON DETAIL.
 * Anything unrecognised becomes INTERNAL so DB internals never reach clients.
 */
export function fromPostgrestError(error: PostgrestError): AppError {
  if (error.code === "P0001" && isErrorCode(error.message)) {
    let details: Record<string, unknown> = {};
    if (error.details) {
      try {
        const parsed: unknown = JSON.parse(error.details);
        if (parsed && typeof parsed === "object") details = parsed as Record<string, unknown>;
      } catch {
        // DETAIL was not JSON; drop it rather than leak raw text.
      }
    }
    return new AppError(error.message, undefined, details);
  }
  if (error.code === "42501") return new AppError("FORBIDDEN");
  if (error.code === "PGRST116") return new AppError("NOT_FOUND");
  return new AppError("INTERNAL", undefined, { pg_code: error.code });
}
