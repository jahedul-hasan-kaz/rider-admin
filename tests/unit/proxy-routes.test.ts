import { describe, expect, it } from "vitest";
import { classifyPath, isIdleExpired, localDevCorsOrigin, safeNextPath } from "@/server/proxy/routes";

describe("classifyPath", () => {
  it.each([
    ["/api/v1/me", "api"],
    ["/api", "api"],
    ["/share/abc123", "public"],
    ["/shared", "admin"],
    ["/apiary", "admin"],
    ["/login", "public-auth"],
    ["/loginx", "admin"],
    ["/auth/callback", "public-auth"],
    ["/reset-password", "public-auth"],
    ["/mfa", "mfa"],
    ["/dashboard", "admin"],
    ["/", "admin"],
  ])("%s → %s", (path, kind) => {
    expect(classifyPath(path)).toBe(kind);
  });
});

describe("safeNextPath", () => {
  it("keeps same-origin relative paths with query", () => {
    expect(safeNextPath("/drivers?status=pending")).toBe("/drivers?status=pending");
  });

  it.each([null, "", "https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)"])(
    "rejects %s",
    (value) => {
      expect(safeNextPath(value)).toBe("/dashboard");
    },
  );
});

describe("isIdleExpired", () => {
  const now = 1_000_000_000_000;
  it("is false without a cookie", () => expect(isIdleExpired(undefined, now)).toBe(false));
  it("is false within the window", () => expect(isIdleExpired(String(now - 60_000), now)).toBe(false));
  it("is true after 30 minutes", () => expect(isIdleExpired(String(now - 31 * 60_000), now)).toBe(true));
  it("ignores garbage", () => expect(isIdleExpired("abc", now)).toBe(false));
});

describe("localDevCorsOrigin", () => {
  it("allows only localhost origins, and only in local", () => {
    expect(localDevCorsOrigin("http://localhost:8081", "local")).toBe("http://localhost:8081");
    expect(localDevCorsOrigin("http://127.0.0.1:19006", "local")).toBe("http://127.0.0.1:19006");
    expect(localDevCorsOrigin("http://localhost:8081", "staging")).toBeNull();
    expect(localDevCorsOrigin("http://localhost:8081", "production")).toBeNull();
    expect(localDevCorsOrigin("https://evil.example", "local")).toBeNull();
    expect(localDevCorsOrigin("http://localhost.evil.example:80", "local")).toBeNull();
    expect(localDevCorsOrigin(null, "local")).toBeNull();
  });
});
