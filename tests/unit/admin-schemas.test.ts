import { describe, expect, it } from "vitest";
import { inviteAdminSchema, permissionOverrideSchema } from "@/lib/schemas/admins";
import { PERMISSIONS, isPermission } from "@/lib/permissions";

describe("permission catalogue", () => {
  it("has 62 unique permissions matching the DB seed", () => {
    expect(PERMISSIONS).toHaveLength(62);
    expect(new Set(PERMISSIONS).size).toBe(62);
  });

  it("rejects unknown codes", () => {
    expect(isPermission("ledger.view")).toBe(true);
    expect(isPermission("ledger.delete")).toBe(false);
  });
});

describe("admin schemas", () => {
  const base = { email: " New.Hire@Example.com ", fullName: "New Hire", reason: "Hiring for support" };

  it("normalises the invite email", () => {
    expect(inviteAdminSchema.parse(base).email).toBe("new.hire@example.com");
  });

  it("requires a meaningful reason", () => {
    expect(inviteAdminSchema.safeParse({ ...base, reason: "ok" }).success).toBe(false);
  });

  it("rejects unknown keys such as role", () => {
    expect(inviteAdminSchema.safeParse({ ...base, role: "admin" }).success).toBe(false);
  });

  it("only accepts catalogue permissions", () => {
    const override = { adminId: crypto.randomUUID(), effect: "grant", reason: "Needed for audits" };
    expect(permissionOverrideSchema.safeParse({ ...override, permission: "audit.view" }).success).toBe(true);
    expect(permissionOverrideSchema.safeParse({ ...override, permission: "root.all" }).success).toBe(false);
  });
});
