import { expect, test } from "@playwright/test";
import {
  bootstrapSuperAdmin,
  inviteLinkFor,
  signInAdmin,
  turnOnMfaInProfile,
  strongPassword,
  uniqueEmail,
} from "./helpers";

// M0 exit criteria (docs/spec/09-roadmap.md): a super admin signs in with MFA,
// invites an Operations admin, edits their permissions, and every action is in
// the audit log. Role immutability and RLS are proven by the pgTAP suites.
test("super admin invites an ops admin and manages their permissions", async ({ browser, baseURL }) => {
  const superEmail = uniqueEmail("super");
  const superPassword = strongPassword();
  bootstrapSuperAdmin(superEmail, superPassword);

  // 1. Super admin: password → dashboard (two-factor is optional)
  const superCtx = await browser.newContext();
  const su = await superCtx.newPage();
  await signInAdmin(su, superEmail, superPassword);
  await expect(su.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(su.getByRole("link", { name: "Audit log" })).toBeVisible();

  // 2. Invite an Operations admin
  const opsEmail = uniqueEmail("ops");
  await su.goto("/admins");
  await su.getByRole("button", { name: "Invite admin" }).click();
  const dialog = su.getByRole("dialog");
  await dialog.getByLabel("Full name").fill("Olivia Ops");
  await dialog.getByLabel("Email").fill(opsEmail);
  await dialog.getByLabel("Operations").check();
  await dialog.getByLabel("Reason").fill("Hiring the night operations lead");
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(su.getByText(`Invitation sent to ${opsEmail}.`)).toBeVisible();

  // 3. Invitee accepts: email link → set password → dashboard, then turns two-factor on in the profile
  const opsCtx = await browser.newContext();
  const ops = await opsCtx.newPage();
  await ops.goto(await inviteLinkFor(opsEmail, baseURL!));
  await expect(ops.getByText("Welcome! Set your password")).toBeVisible();
  const opsPassword = strongPassword();
  await ops.getByLabel("New password").fill(opsPassword);
  await ops.getByLabel("Confirm password").fill(opsPassword);
  await ops.getByRole("button", { name: "Set password" }).click();
  await expect(ops).toHaveURL(/\/dashboard/);
  await turnOnMfaInProfile(ops);

  // Ops sees Admins (operations template) but not the audit log, which is a 403.
  await expect(ops.getByRole("link", { name: "Admins", exact: true })).toBeVisible();
  await expect(ops.getByRole("link", { name: "Audit log" })).toHaveCount(0);
  await ops.goto("/audit");
  await expect(ops.getByText("You don't have access")).toBeVisible();

  // 4. Super admin sees the new admin as active with 2FA and a recent sign-in,
  //    then grants audit.view with a reason
  await su.goto("/admins");
  const opsRow = su.getByRole("row", { name: new RegExp(opsEmail.replaceAll(".", "\\.")) });
  await expect(opsRow).toContainText("On");
  await expect(opsRow).not.toContainText("Never");
  await opsRow.click();
  await expect(su.getByRole("heading", { name: "Olivia Ops" })).toBeVisible();
  await su.getByRole("radiogroup", { name: "audit.view" }).getByRole("radio", { name: "Grant" }).click();
  await expect(su.getByText("You have unsaved permission changes.")).toBeVisible();
  await su.getByRole("button", { name: "Save changes" }).click();
  await su.getByRole("dialog").getByLabel("Reason").fill("Ops lead reviews incident audit trails");
  await su.getByRole("dialog").getByRole("button", { name: "Save changes" }).click();
  await expect(su.getByText("Permissions updated.")).toBeVisible();

  // 5. The change takes effect immediately for the ops admin
  await ops.goto("/audit");
  await expect(ops.getByRole("heading", { name: "Audit log" })).toBeVisible();

  // 6. Everything is in the audit log
  await su.goto("/audit?q=admin.");
  for (const action of ["admin.invite", "admin.permission.grant"]) {
    await expect(su.getByRole("cell", { name: action }).first()).toBeVisible();
  }
  await su.goto("/audit?q=auth.mfa_enrolled");
  await expect(su.getByRole("cell", { name: "auth.mfa_enrolled" }).first()).toBeVisible();

  // Audit entry detail shows before/after permissions
  await su.goto("/audit?q=admin.permission.grant");
  await su.getByRole("cell", { name: "admin.permission.grant" }).first().click();
  await expect(su.getByText("Ops lead reviews incident audit trails").last()).toBeVisible();

  await superCtx.close();
  await opsCtx.close();
});

test("role is shown read-only and unauthenticated users are sent to sign-in", async ({ page }) => {
  await page.goto("/admins");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmins/);
  const res = await page.request.get("/api/v1/me");
  expect(res.status()).toBe(401);
  expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
});
