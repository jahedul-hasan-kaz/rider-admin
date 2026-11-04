import { expect, test } from "@playwright/test";
import { bootstrapSuperAdmin, execSql, freshTotp, runSqlOne, signInAdmin, strongPassword, turnOnMfaInProfile, uniqueEmail } from "./helpers";

// Two-factor is optional: off by default (password only), added and removed by the person in Profile → Security,
// and enforced again for everyone when the `require_admin_mfa` flag is on.

test("two-factor is optional and can be turned on and off in the profile", async ({ browser }) => {
  test.setTimeout(180_000);
  const email = uniqueEmail("m8");
  const password = strongPassword();
  bootstrapSuperAdmin(email, password);
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();

  // Off by default: the password alone gets you in, and the profile says so.
  await signInAdmin(page, email, password);
  await page.goto("/profile");
  await expect(page.getByText("Two-factor authentication is off.")).toBeVisible();

  // Turn on in the profile.
  const secret = await turnOnMfaInProfile(page);
  await expect(page.getByText("Two-factor authentication is on.").first()).toBeVisible();
  expect(runSqlOne<{ n: number }>(`select count(*)::int as n from auth.mfa_factors f join auth.users u on u.id = f.user_id where u.email = '${email}' and f.status = 'verified'`).n).toBe(1);

  // Sign out and in: now a code is asked for, and without it the app stays closed.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/mfa/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/mfa/); // still locked without the code
  await page.getByLabel("Authentication code").fill(await freshTotp(secret));
  await expect(page).toHaveURL(/\/dashboard/);

  // Turn off in the profile with a fresh code; the next sign-in is password only again.
  await page.goto("/profile");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Turn off" }).click();
  // A code is not reusable within its 30 s window, so wait for the next one.
  await page.waitForTimeout(31_000 - (Date.now() % 30_000));
  await page.getByLabel("Authentication code").fill(await freshTotp(secret));
  await expect(page.getByText("Two-factor authentication is off.").first()).toBeVisible();
  expect(runSqlOne<{ n: number }>(`select count(*)::int as n from auth.mfa_factors f join auth.users u on u.id = f.user_id where u.email = '${email}'`).n).toBe(0);

  await page.context().clearCookies();
  await signInAdmin(page, email, password);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});

test("when the organisation requires two-factor, set-up is forced and cannot be turned off", async ({ browser }) => {
  test.setTimeout(120_000);
  const email = uniqueEmail("m8req");
  const password = strongPassword();
  bootstrapSuperAdmin(email, password);
  execSql("update public.feature_flags set enabled = true where key = 'require_admin_mfa'");
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/mfa/); // set-up is shown, not the app
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/mfa/);
    const secret = (await page.getByTestId("mfa-secret").textContent())!.trim();
    await page.getByLabel("Authentication code").fill(await freshTotp(secret));
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/profile");
    await expect(page.getByText("cannot be turned off")).toBeVisible();
    await expect(page.getByRole("button", { name: "Turn off" })).toHaveCount(0);
  } finally {
    execSql("update public.feature_flags set enabled = false where key = 'require_admin_mfa'");
  }
});
