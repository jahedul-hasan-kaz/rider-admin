import "server-only";
import { z } from "zod";
import type { AdminContext } from "@/server/auth/context";
import { AppError, fromPostgrestError } from "@/server/http/errors";

// Shared helpers for the typed admin readers: one RPC, one Zod parse.

export async function call<T extends z.ZodType>(
  promise: PromiseLike<{ data: unknown; error: unknown }>,
  schema: T,
): Promise<z.infer<T>> {
  const { data, error } = await promise;
  if (error) throw fromPostgrestError(error as Parameters<typeof fromPostgrestError>[0]);
  return schema.parse(data);
}

export const api = (ctx: AdminContext) => ctx.supabase.schema("api");

/** Cursor-paginated list payload. */
export const page = <T extends z.ZodType>(row: T) =>
  z.object({ rows: z.array(row), next_cursor: z.string().nullable().optional() });

export const num = z.number();

/**
 * Lists sort on the server by a whitelisted key from the URL. A stale or mistyped key (an old link or saved view)
 * must not break the page: on VALIDATION_FAILED the list is read again in its default order.
 */
export async function sortFallback<F extends { sort?: string }, R>(f: F, read: (f: F) => Promise<R>): Promise<R> {
  if (!f.sort) return read(f);
  try {
    return await read(f);
  } catch (error) {
    if (error instanceof AppError && error.code === "VALIDATION_FAILED") return read({ ...f, sort: undefined, cursor: undefined });
    throw error;
  }
}

/**
 * Starts a read now so it runs alongside the main read of a page instead of after it (every sequential round trip to
 * the database adds its full latency). Await the returned promise later; a failure surfaces there, not as an
 * unhandled rejection.
 */
export function early<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}
