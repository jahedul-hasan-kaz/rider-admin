import "server-only";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { getApiContext, type ApiContext } from "@/server/auth/context";
import { log } from "@/server/log";
import type { AppRole } from "@/types/database";
import { fail } from "./envelope";
import { AppError, fromPostgrestError, fromZodError } from "./errors";
import { REQUEST_ID_HEADER, resolveRequestId } from "./request-id";

const MAX_BODY_BYTES = 64 * 1024;

/** Rate-limit classes from docs/spec/05-api.md §1 (limit per window seconds). */
export const RATE_LIMITS = {
  auth: { limit: 10, windowS: 60 },
  read: { limit: 120, windowS: 60 },
  write: { limit: 30, windowS: 60 },
  quote: { limit: 20, windowS: 60 },
  upload: { limit: 20, windowS: 60 },
  location: { limit: 2, windowS: 4 },
} as const;
export type RateLimitClass = keyof typeof RATE_LIMITS;

type RouteParams = { params: Promise<Record<string, string | string[]>> };

export type HandlerArgs<A> = {
  request: Request;
  requestId: string;
  params: Record<string, string | string[]>;
  auth: A;
  /** Parses the (already read) JSON body with a strict Zod schema. */
  body: <S extends z.ZodType>(schema: S) => z.infer<S>;
};

type Options<R extends AppRole | "public"> = {
  /** Roles allowed to call the route, or "public" for unauthenticated routes. */
  roles: readonly R[];
  rateLimit?: RateLimitClass;
  /** Requires an Idempotency-Key header; a retry with the same key replays the stored response. */
  idempotent?: boolean;
};

async function readBody(request: Request): Promise<string> {
  if (request.method === "GET" || request.method === "HEAD") return "";
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) throw new AppError("VALIDATION_FAILED", "Request body is too large.");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new AppError("VALIDATION_FAILED", "Request body is too large.");
  return text;
}

function bodyParser(text: string) {
  let parsed: unknown;
  let parseFailed = false;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parseFailed = true;
  }
  return <S extends z.ZodType>(schema: S): z.infer<S> => {
    if (parseFailed) throw new AppError("VALIDATION_FAILED", "Request body must be valid JSON.");
    const result = schema.safeParse(parsed);
    if (!result.success) throw fromZodError(result.error);
    return result.data;
  };
}

/**
 * The role claim is set when the token is issued. Onboarding promotes
 * `user → passenger | driver`, so a token minted just before still says `user`
 * until it refreshes. Only in that case, read the current role from the DB.
 */
async function refreshPromotedRole(auth: ApiContext, allowed: readonly string[]): Promise<ApiContext> {
  if (auth.role !== "user") throw new AppError("ROLE_NOT_ALLOWED");
  const { data, error } = await auth.supabase.schema("api").rpc("get_my_profile");
  if (error) throw fromPostgrestError(error);
  const role = (data as { role?: string } | null)?.role;
  if (!role || !allowed.includes(role)) throw new AppError("ROLE_NOT_ALLOWED");
  return { ...auth, role: role as ApiContext["role"] };
}

async function enforceRateLimit(auth: ApiContext, cls: RateLimitClass) {
  const { limit, windowS } = RATE_LIMITS[cls];
  const { data, error } = await auth.supabase.schema("api").rpc("check_rate_limit", {
    p_class: cls,
    p_limit: limit,
    p_window_s: windowS,
  });
  if (error) throw fromPostgrestError(error);
  if (typeof data === "number" && data > 0) throw new AppError("RATE_LIMITED", undefined, { retry_after: data });
}

/**
 * Wraps a mobile REST Route Handler (docs/spec/05-api.md §1): request id,
 * bearer auth, role check, rate limit, idempotency, error mapping to the
 * envelope, and access logging.
 */
export function apiRoute<R extends AppRole | "public">(
  options: Options<R>,
  handler: (args: HandlerArgs<"public" extends R ? ApiContext | null : ApiContext>) => Promise<Response>,
) {
  return async (request: Request, route: RouteParams): Promise<Response> => {
    const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
    const started = performance.now();
    const routeKey = `${request.method} ${new URL(request.url).pathname}`;
    let status = 500;
    let idem: { auth: ApiContext; key: string } | null = null;

    try {
      const isPublic = (options.roles as readonly string[]).includes("public");
      let auth: ApiContext | null = null;
      if (!isPublic || request.headers.has("authorization")) {
        auth = await getApiContext(request, requestId);
        if (!isPublic && !(options.roles as readonly string[]).includes(auth.role)) {
          auth = await refreshPromotedRole(auth, options.roles as readonly string[]);
        }
      }
      if (auth && options.rateLimit) await enforceRateLimit(auth, options.rateLimit);

      const text = await readBody(request);

      if (options.idempotent) {
        if (!auth) throw new AppError("UNAUTHENTICATED");
        const key = request.headers.get("idempotency-key") ?? "";
        if (!/^[0-9a-fA-F-]{36}$/.test(key)) throw new AppError("IDEMPOTENCY_KEY_REQUIRED");
        const hash = createHash("sha256").update(text).digest("hex");
        const { data, error } = await auth.supabase.schema("api").rpc("idempotency_begin", {
          p_route: routeKey,
          p_key: key,
          p_request_sha256: hash,
        });
        if (error) throw fromPostgrestError(error);
        const state = data as { state: string; status?: number; response?: unknown };
        if (state.state === "replay") {
          status = state.status ?? 200;
          return NextResponse.json(state.response, {
            status,
            headers: { "Cache-Control": "no-store", [REQUEST_ID_HEADER]: requestId, "Idempotent-Replayed": "true" },
          });
        }
        if (state.state === "in_progress") {
          throw new AppError("IDEMPOTENCY_KEY_REUSED", "The original request is still being processed.");
        }
        idem = { auth, key };
      }

      const params = await route.params;
      const response = await handler({
        request,
        requestId,
        params,
        auth: auth as "public" extends R ? ApiContext | null : ApiContext,
        body: bodyParser(text),
      });
      status = response.status;
      if (idem) await storeIdempotentResponse(idem, routeKey, response);
      return response;
    } catch (error) {
      const appError = error instanceof AppError ? error : new AppError("INTERNAL");
      if (!(error instanceof AppError) || appError.code === "INTERNAL") {
        log.error({ err: error, requestId }, "unhandled api error");
      }
      status = appError.status;
      const retryAfter = appError.code === "RATE_LIMITED" ? String(appError.details.retry_after ?? 60) : undefined;
      const response = fail(appError, requestId, retryAfter ? { "Retry-After": retryAfter } : {});
      if (idem) {
        // Client errors are final and replayable; server errors stay retryable.
        if (status < 500) await storeIdempotentResponse(idem, routeKey, response);
        else await idem.auth.supabase.schema("api").rpc("idempotency_abandon", { p_route: routeKey, p_key: idem.key });
      }
      return response;
    } finally {
      log.info(
        { requestId, method: request.method, route: new URL(request.url).pathname, status, duration_ms: Math.round(performance.now() - started) },
        "api request",
      );
    }
  };
}

async function storeIdempotentResponse(idem: { auth: ApiContext; key: string }, routeKey: string, response: Response) {
  const payload = await response.clone().json().catch(() => null);
  const { error } = await idem.auth.supabase.schema("api").rpc("idempotency_complete", {
    p_route: routeKey,
    p_key: idem.key,
    p_status: response.status,
    p_response: payload,
  });
  if (error) log.warn({ err: error }, "idempotency response not stored");
}

/**
 * Generated RPC types mark parameters without SQL defaults as non-null, but the
 * functions accept NULL for "not provided". PostgREST also needs every argument
 * present to resolve the function, so optional inputs are sent as explicit null.
 */
export const orNull = <T>(value: T | undefined): T => (value ?? null) as T;

/** Calls an RPC and maps its error; returns the data. */
export async function rpcOrThrow<T>(promise: PromiseLike<{ data: T; error: Parameters<typeof fromPostgrestError>[0] | null }>) {
  const { data, error } = await promise;
  if (error) throw fromPostgrestError(error);
  return data;
}
