import type { PostgrestError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, fromPostgrestError, fromZodError } from "@/server/http/errors";
import { resolveRequestId } from "@/server/http/request-id";

const pgError = (fields: Partial<PostgrestError>): PostgrestError =>
  ({ message: "", details: "", hint: "", code: "", name: "PostgrestError", ...fields }) as PostgrestError;

describe("fromPostgrestError", () => {
  it("maps a business error raised with P0001 and JSON detail", () => {
    const err = fromPostgrestError(
      pgError({ code: "P0001", message: "OFFER_NO_LONGER_AVAILABLE", details: '{"offer_id":"x"}' }),
    );
    expect(err.code).toBe("OFFER_NO_LONGER_AVAILABLE");
    expect(err.status).toBe(409);
    expect(err.details).toEqual({ offer_id: "x" });
  });

  it("drops non-JSON detail instead of leaking it", () => {
    const err = fromPostgrestError(pgError({ code: "P0001", message: "STALE_VERSION", details: "row 42 of table x" }));
    expect(err.details).toEqual({});
  });

  it("hides unknown database errors as INTERNAL", () => {
    const err = fromPostgrestError(pgError({ code: "23505", message: 'duplicate key value violates "secret_idx"' }));
    expect(err.code).toBe("INTERNAL");
    expect(err.message).not.toContain("secret_idx");
  });

  it("treats unknown P0001 messages as INTERNAL", () => {
    expect(fromPostgrestError(pgError({ code: "P0001", message: "something odd" })).code).toBe("INTERNAL");
  });

  it("maps insufficient_privilege to FORBIDDEN", () => {
    expect(fromPostgrestError(pgError({ code: "42501" })).status).toBe(403);
  });
});

describe("fromZodError", () => {
  it("returns field paths", () => {
    const result = z.object({ lat: z.number().min(-90).max(90) }).strict().safeParse({ lat: 200 });
    expect(result.success).toBe(false);
    const err = fromZodError(result.error!);
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(400);
    expect(err.details.fields).toEqual([expect.objectContaining({ path: "lat" })]);
  });
});

describe("resolveRequestId", () => {
  it("keeps a valid incoming id", () => expect(resolveRequestId("req_12345678")).toBe("req_12345678"));
  it("replaces unsafe ids", () => expect(resolveRequestId("bad id\n<script>")).toMatch(/^[0-9a-f-]{36}$/));
  it("generates when missing", () => expect(resolveRequestId(null)).toMatch(/^[0-9a-f-]{36}$/));
});
