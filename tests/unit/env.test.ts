import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("serverEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("treats empty optional values as unset", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_value_123456");
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    vi.stubEnv("SENTRY_DSN", "");
    vi.stubEnv("INTERNAL_JOBS_SECRET", "");
    const { serverEnv } = await import("@/server/env");
    expect(serverEnv().SENTRY_DSN).toBeUndefined();
  });

  it("names invalid fields without printing values", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "short");
    vi.stubEnv("APP_BASE_URL", "http://localhost:3000");
    const { serverEnv } = await import("@/server/env");
    expect(() => serverEnv()).toThrow(/SUPABASE_SECRET_KEY/);
    expect(() => serverEnv()).not.toThrow(/short/);
  });
});
