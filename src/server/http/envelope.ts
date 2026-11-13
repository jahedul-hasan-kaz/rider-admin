import { NextResponse } from "next/server";
import { AppError } from "./errors";
import { REQUEST_ID_HEADER } from "./request-id";

// Response envelope from docs/spec/05-api.md §1.

type Meta = { request_id: string; next_cursor?: string | null };

const NO_STORE = { "Cache-Control": "no-store" };

export function ok<T>(data: T, requestId: string, init: { status?: number; nextCursor?: string | null } = {}) {
  const meta: Meta = { request_id: requestId };
  if (init.nextCursor !== undefined) meta.next_cursor = init.nextCursor;
  return NextResponse.json(
    { data, meta },
    { status: init.status ?? 200, headers: { ...NO_STORE, [REQUEST_ID_HEADER]: requestId } },
  );
}

export function fail(error: AppError, requestId: string, extraHeaders: Record<string, string> = {}) {
  // INTERNAL errors carry only a reference; never internal details.
  const details = error.code === "INTERNAL" ? { ref: requestId } : error.details;
  return NextResponse.json(
    { error: { code: error.code, message: error.message, details }, meta: { request_id: requestId } },
    { status: error.status, headers: { ...NO_STORE, [REQUEST_ID_HEADER]: requestId, ...extraHeaders } },
  );
}
