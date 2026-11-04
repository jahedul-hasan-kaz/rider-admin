import { expect, test, type Locator, type Page } from "@playwright/test";
import { createAppUser } from "./api-client";
import {
  bootstrapSuperAdmin,
  createZone,
  execSql,
  jwtSub,
  makeOnlineDriver,
  publishRuleSql,
  runSqlOne,
  signInAdmin,
  strongPassword,
  uniqueEmail,
} from "./helpers";

// Staff create / update / delete through the real UI: accounts, vehicles, a booked ride with a hand-assigned driver,
// cancelling it, alerts, and deleting an account. Each check confirms the database state, not only the toast.

const newSite = () => ({ lat: 5 + Math.random() * 30, lng: 70 + Math.random() * 40 });

/** Clicks once React has attached its handlers to the element. */
async function clickReady(trigger: Locator) {
  const handle = await trigger.elementHandle({ timeout: 15_000 });
  await trigger.page().waitForFunction((el) => Object.keys(el as object).some((k) => k.startsWith("__reactProps")), handle, { timeout: 15_000 });
  await trigger.click();
}

async function openDialog(page: Page, button: string | RegExp) {
  await clickReady(page.getByRole("button", { name: button }).first());
  const dlg = page.locator('[data-slot="dialog-content"]');
  await expect(dlg).toBeVisible();
  return dlg;
}

async function submit(dlg: Locator, confirm: string | RegExp, reason: string) {
  await dlg.getByLabel("Reason").fill(reason);
  await dlg.getByRole("button", { name: confirm }).last().click();
  await expect(dlg).toBeHidden({ timeout: 20_000 });
}

test.describe.configure({ mode: "serial" });

test("staff create, edit and delete accounts, vehicles, rides and alerts", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = Date.now().toString(36);
  const site = newSite();
  const zoneId = createZone(`m7_${suffix}`, site.lat, site.lng);
  publishRuleSql(zoneId);

  const email = uniqueEmail("m7sa");
  const password = strongPassword();
  bootstrapSuperAdmin(email, password);
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await signInAdmin(page, email, password);

  // --- New passenger ---------------------------------------------------------
  const paxEmail = uniqueEmail("m7pax");
  const paxName = `M7 Passenger ${suffix}`;
  await page.goto("/passengers");
  let dlg = await openDialog(page, "New passenger");
  await dlg.getByLabel("Full name").fill(paxName);
  await dlg.getByLabel("Email").fill(paxEmail);
  const localPhone = `017${Math.floor(10_000_000 + Math.random() * 89_999_999)}`; // typed the local way
  await dlg.getByLabel("Phone").fill(localPhone);
  await submit(dlg, "Create", "Signed up by phone");
  const pax = runSqlOne<{ id: string; role: string; phone: string }>(`select id, role, phone from public.profiles where email = '${paxEmail}'`);
  expect(pax.role).toBe("passenger");
  expect(pax.phone).toBe(`+88${localPhone}`);

  // --- Edit contact ----------------------------------------------------------
  await page.goto(`/passengers/${pax.id}`);
  dlg = await openDialog(page, "Edit contact");
  await dlg.getByLabel("Full name").fill(`${paxName} Edited`);
  await dlg.getByLabel("New phone (optional)").fill(`+88017${Math.floor(10_000_000 + Math.random() * 89_999_999)}`);
  await submit(dlg, "Save", "Asked by phone");
  expect(runSqlOne<{ full_name: string }>(`select full_name from public.profiles where id = '${pax.id}'`).full_name).toBe(`${paxName} Edited`);

  // --- New driver, then a vehicle for them ----------------------------------
  const drvEmail = uniqueEmail("m7drv");
  await page.goto("/drivers");
  dlg = await openDialog(page, "New driver");
  await dlg.getByLabel("Full name").fill(`M7 Driver ${suffix}`);
  await dlg.getByLabel("Email").fill(drvEmail);
  await submit(dlg, "Create", "Signed up at the office");
  const drv = runSqlOne<{ id: string; onboarding_status: string }>(
    `select d.id, d.onboarding_status from public.driver_profiles d join public.profiles p on p.id = d.user_id where p.email = '${drvEmail}'`,
  );
  expect(drv.onboarding_status).toBe("draft");

  await page.goto(`/drivers/${drv.id}`);
  dlg = await openDialog(page, "Add vehicle");
  await dlg.getByLabel("Vehicle type").click();
  await page.getByRole("option").first().click();
  const plate = `M7-${suffix.slice(-5).toUpperCase()}`;
  await dlg.getByLabel("Registration number").fill(plate);
  await dlg.getByLabel("Make").fill("Honda");
  await dlg.getByLabel("Model").fill("CB Shine");
  await dlg.getByLabel("Colour").fill("Red");
  await submit(dlg, "Save", "Signed up at the office");
  const veh = runSqlOne<{ id: string }>(`select id from public.vehicles where driver_id = '${drv.id}'`);

  await page.goto(`/vehicles/${veh.id}`);
  dlg = await openDialog(page, "Retire vehicle");
  await submit(dlg, "Retire vehicle", "Vehicle sold");
  expect(runSqlOne<{ status: string }>(`select status from public.vehicles where id = '${veh.id}'`).status).toBe("inactive");

  // --- Book a ride for the passenger and hand-assign an online driver -------
  const driverToken = await makeOnlineDriver(createAppUser, site.lat + 0.002, site.lng + 0.002);
  const assignName = `M7 Assign ${suffix}`;
  execSql(`update public.profiles set full_name = '${assignName}' where id = '${jwtSub(driverToken)}'`);

  await page.goto(`/passengers/${pax.id}`);
  dlg = await openDialog(page, "Book a ride");
  await dlg.getByLabel("Vehicle type").click();
  await page.getByRole("option", { name: /bike/i }).first().click();
  await dlg.getByLabel("Pickup latitude").fill(`${site.lat}, ${site.lng}`); // pasted pair fills both boxes
  await expect(dlg.getByLabel("Pickup longitude")).toHaveValue(String(site.lng));
  await dlg.getByLabel("Destination latitude").fill(String(site.lat + 0.02));
  await dlg.getByLabel("Destination longitude").fill(String(site.lng + 0.02));
  await submit(dlg, "Book ride", "Phone booking");
  const req = runSqlOne<{ id: string; status: string; booked_by: string | null }>(
    `select id, status, booked_by from public.ride_requests where passenger_id = '${pax.id}' order by requested_at desc limit 1`,
  );
  expect(req.booked_by).not.toBeNull();
  expect(req.status).toBe("searching");

  await page.goto(`/requests/${req.id}`);
  dlg = await openDialog(page, "Assign a driver");
  await clickReady(dlg.getByLabel("Driver"));
  await page.getByPlaceholder("Type to search…").fill(assignName);
  await page.getByRole("option", { name: new RegExp(assignName) }).click();
  await submit(dlg, "Assign", "Nearest available driver");
  const trip = runSqlOne<{ id: string; status: string }>(`select id, status from public.trips where request_id = '${req.id}'`);
  expect(trip.status).toBe("driver_assigned");

  await page.goto(`/requests/${req.id}`);
  dlg = await openDialog(page, "Cancel request");
  await submit(dlg, "Cancel request", "The person asked for it");
  expect(runSqlOne<{ status: string }>(`select status from public.trips where id = '${trip.id}'`).status).toBe("cancelled_by_admin");

  // --- Alerts -----------------------------------------------------------------
  const alertTitle = `Road closed ${suffix}`;
  await page.goto("/alerts");
  dlg = await openDialog(page, "New alert");
  await dlg.getByLabel("Title").fill(alertTitle);
  await submit(dlg, "Raise alert", "Reported by a driver");
  await expect(page.getByText(alertTitle)).toBeVisible();
  const alertCard = page.locator("div").filter({ hasText: alertTitle }).filter({ has: page.getByRole("button", { name: "Resolve" }) }).last();
  await clickReady(alertCard.getByRole("button", { name: "Resolve" }));
  dlg = page.locator('[data-slot="dialog-content"]');
  await submit(dlg, "Resolve", "Road reopened");
  expect(runSqlOne<{ status: string }>(`select status from public.ops_alerts where title = '${alertTitle}'`).status).toBe("resolved");

  // --- Delete the passenger (type-to-confirm), restorable from Privacy -------
  await page.goto(`/passengers/${pax.id}`);
  dlg = await openDialog(page, "Delete account");
  await dlg.getByLabel("Reason").fill("The person asked for it");
  await dlg.getByLabel("Type DELETE to confirm").fill("DELETE");
  await dlg.getByRole("button", { name: "Delete account" }).last().click();
  await expect(dlg).toBeHidden({ timeout: 20_000 });
  expect(runSqlOne<{ status: string }>(`select status from public.profiles where id = '${pax.id}'`).status).toBe("deactivated");
  expect(runSqlOne<{ status: string }>(`select status from public.account_deletion_requests where user_id = '${pax.id}'`).status).toBe("pending");
});
