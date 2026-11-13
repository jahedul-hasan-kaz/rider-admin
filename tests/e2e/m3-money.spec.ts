import { expect, test, type Locator, type Page } from "@playwright/test";
import { apiClient, createAppUser } from "./api-client";
import {
  bootstrapSuperAdmin,
  createZone,
  execSql,
  jwtSub,
  makeOnlineDriver,
  publishRuleSql,
  runSql,
  runSqlOne,
  signInAdmin,
  strongPassword,
  uniqueEmail,
} from "./helpers";

// M3 exit criteria (docs/spec/09-roadmap.md): reconciliation and reversal flows are tested and nothing allows a
// silent financial edit. Passenger and driver use the real REST API; two different admins use the UI.

type Api = ReturnType<typeof apiClient>;
const data = (r: { body: { data?: unknown } }) => r.body.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const place = (lat: number, lng: number, label: string) => ({ lat, lng, label });

/** A private patch of map for each test, so parallel specs and leftovers from earlier runs never share drivers. */
type Site = { lat: number; lng: number };
const newSite = (): Site => ({ lat: 5 + Math.random() * 30, lng: 70 + Math.random() * 40 });

async function makePassenger(baseURL: string): Promise<{ api: Api; id: string }> {
  const token = await createAppUser(uniqueEmail("pax"), strongPassword());
  const api = apiClient(baseURL, token);
  expect((await api.post("/onboarding/passenger", { full_name: "E2E Passenger" })).status).toBe(201);
  return { api, id: jwtSub(token) };
}

/** Takes a ride as far as `stage`: "started" leaves it in progress, "completed" finishes it. */
async function ride(pax: Api, driver: Api, bike: string, stage: "started" | "completed", site: Site) {
  const quote = await pax.post("/quotes", { category_id: bike, pickup: place(site.lat, site.lng, "Zindabazar"), destination: place(site.lat + 0.03, site.lng + 0.03, "Airport Road") });
  expect(quote.status, JSON.stringify(quote.body)).toBe(201);
  const req = await pax.post("/rides", { quote_id: data(quote).id, payment_method: "cash" });
  expect(req.status, JSON.stringify(req.body)).toBe(201);
  const offer = await driver.get("/driver/offers/current");
  const accepted = await driver.post(`/driver/offers/${data(offer).offer_id}/accept`);
  const tripId = data(accepted).id as string;
  expect((await driver.post(`/driver/trips/${tripId}/arriving`)).status).toBe(200);
  expect((await driver.post(`/driver/trips/${tripId}/arrived`, { override: true })).status).toBe(200);
  expect((await driver.post(`/driver/trips/${tripId}/start`)).status).toBe(200);
  if (stage === "completed") {
    const points = Array.from({ length: 8 }, (_, i) => ({
      lat: site.lat + i * 0.004,
      lng: site.lng + i * 0.004,
      speed: 16,
      accuracy: 8,
      recorded_at: new Date(Date.now() - (160 - i * 20) * 1000).toISOString(),
    }));
    expect((await driver.post("/driver/location", { points })).status).toBe(200);
    const done = await driver.post(`/driver/trips/${tripId}/complete`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    return { tripId, requestId: data(req).id as string, fare: Number(data(done).final_fare) };
  }
  return { tripId, requestId: data(req).id as string, fare: 0 };
}

async function adminPage(browser: import("@playwright/test").Browser, label: string): Promise<Page> {
  const email = uniqueEmail(label);
  const password = strongPassword();
  bootstrapSuperAdmin(email, password);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await signInAdmin(page, email, password);
  return page;
}

/**
 * Clicks once React has attached its handlers to the element. A click before that is replayed after hydration, so a
 * retrying click would toggle a dialog shut again: wait for the element's own hydration marker instead.
 */
async function clickUntil(trigger: Locator, outcome: () => Promise<void>) {
  const handle = await trigger.elementHandle({ timeout: 15_000 });
  await trigger.page().waitForFunction((el) => Object.keys(el as object).some((k) => k.startsWith("__reactProps")), handle, { timeout: 15_000 });
  await trigger.click();
  await outcome();
}

test.describe.configure({ mode: "serial" });

test("money: settlement, cash dues, maker-checker refund, nightly verification", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const suffix = Date.now().toString(36);
  execSql("update public.refunds_adjustments set status = 'cancelled' where status in ('requested', 'awaiting_second_approval')"); // requests left by earlier runs
  const site = newSite();
  const zoneId = createZone(`m3a_${suffix}`, site.lat, site.lng);
  const refundReason = `Customer was overcharged by 20 (${suffix})`;
  publishRuleSql(zoneId);

  const pax = await makePassenger(baseURL!);
  const driverToken = await makeOnlineDriver(createAppUser, site.lat + 0.003, site.lng + 0.003);
  const driver = apiClient(baseURL!, driverToken);
  const { id: bike } = runSqlOne<{ id: string }>("select id from public.vehicle_categories where code = 'bike'");

  const { tripId, fare } = await ride(pax.api, driver, bike, "completed", site);
  expect(fare).toBeGreaterThan(60);

  // --- Settlement happened inside completion ---------------------------------------------------
  const settled = runSqlOne<{ payment: string; earning: number; commission: number; balance: number; txs: number }>(`
    select p.status::text as payment, e.net_earning::float8 as earning, e.commission_amount::float8 as commission,
           (select b.balance::float8 from public.ledger_account_balances b join public.ledger_accounts a on a.id = b.account_id
             where a.code = 'driver:' || p.driver_id || ':wallet') as balance,
           (select count(*)::int from public.ledger_transactions where trip_id = p.trip_id) as txs
    from public.payments p join public.driver_earnings e on e.trip_id = p.trip_id where p.trip_id = '${tripId}'`);
  expect(settled.payment).toBe("pending");
  expect(settled.txs).toBe(1);
  expect(settled.earning + settled.commission).toBeCloseTo(fare, 2);
  expect(settled.balance).toBeCloseTo(settled.earning - fare, 2); // cash held: the driver owes the platform

  // --- Driver confirms the cash (idempotent) ----------------------------------------------------
  expect((await pax.api.post(`/driver/trips/${tripId}/cash-collected`, {})).status).toBe(403);
  const confirmed = await driver.post(`/driver/trips/${tripId}/cash-collected`, {});
  expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
  expect(data(confirmed).status).toBe("succeeded");
  expect(data(await driver.post(`/driver/trips/${tripId}/cash-collected`, {})).status).toBe("succeeded");
  const wallet = await driver.get("/driver/wallet");
  expect(data(wallet).owes_platform).toBe(true);
  expect(Number(data(wallet).balance)).toBeCloseTo(settled.balance, 2);
  expect((await driver.get("/driver/earnings")).body.data).toHaveLength(1);

  // --- Admin A: payments, dues, deposit ---------------------------------------------------------
  const a = await adminPage(browser, "m3adminA");
  await a.goto("/payments");
  await expect(a.getByRole("heading", { name: "Payments" })).toBeVisible();
  await expect(a.getByRole("row", { name: /E2E Passenger/ }).first()).toBeVisible();

  const { name: driverName } = runSqlOne<{ name: string }>(`select full_name as name from public.profiles where id = '${jwtSub(driverToken)}'`);
  await a.goto("/payments?tab=dues");
  const dueRow = a.getByRole("row").filter({ hasText: driverName });
  await expect(dueRow).toBeVisible();
  const deposit = a.getByRole("dialog");
  await clickUntil(dueRow.getByRole("button", { name: "Record deposit" }), () => expect(deposit).toBeVisible({ timeout: 1500 }));
  await deposit.getByLabel("Receipt or transfer reference").fill("R-E2E-1");
  await deposit.getByRole("button", { name: "Record deposit" }).click();
  await expect(a.getByText("Deposit recorded.")).toBeVisible();
  await expect(a.getByRole("row").filter({ hasText: driverName })).toHaveCount(0);

  // --- Admin A requests a refund from the trip page ----------------------------------------------
  await a.goto(`/trips/${tripId}`);
  await expect(a.getByText("Money", { exact: true })).toBeVisible();
  await expect(a.getByText("Platform commission", { exact: true })).toBeVisible();
  const refund = a.getByRole("dialog");
  await clickUntil(a.getByRole("button", { name: "Request refund" }), () => expect(refund).toBeVisible({ timeout: 1500 }));
  await refund.getByLabel("Amount (৳)").fill("20");
  await refund.getByLabel("Reason").fill(refundReason);
  await refund.getByRole("button", { name: "Request refund" }).click();
  await expect(a).toHaveURL(/\/refunds/);
  await expect(a.getByText(refundReason)).toBeVisible();
  // The requester cannot approve their own request.
  await expect(a.getByText("You requested this, so someone else must approve it.")).toBeVisible();
  await expect(a.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);

  // --- Admin B approves ---------------------------------------------------------------------------
  const b = await adminPage(browser, "m3adminB");
  await b.goto("/refunds");
  await clickUntil(b.getByRole("button", { name: "Approve", exact: true }), () => expect(b.getByText("Approved.")).toBeVisible({ timeout: 2500 }));
  await b.goto("/refunds?tab=processed");
  await expect(b.getByText(refundReason)).toBeVisible();

  const after = runSqlOne<{ refunded: number; status: string; passenger_wallet: number }>(`
    select p.refunded_amount::float8 as refunded, p.status::text as status,
           (select b.balance::float8 from public.ledger_account_balances b join public.ledger_accounts a on a.id = b.account_id
             where a.code = 'passenger:' || p.passenger_id || ':wallet') as passenger_wallet
    from public.payments p where p.trip_id = '${tripId}'`);
  expect(after).toMatchObject({ refunded: 20, status: "partially_refunded", passenger_wallet: 20 });

  // --- Reversal through the UI, then the ledger still verifies -------------------------------------
  const { id: refundTx } = runSqlOne<{ id: string }>(`select id from public.ledger_transactions where kind = 'refund' and trip_id = '${tripId}'`);
  await a.goto(`/ledger/transactions/${refundTx}`);
  const reversal = a.getByRole("dialog");
  await clickUntil(a.getByRole("button", { name: "Request reversal" }), () => expect(reversal).toBeVisible({ timeout: 1500 }));
  await reversal.getByLabel("Reason").fill("The refund was sent for the wrong trip");
  await reversal.getByRole("button", { name: "Request reversal" }).click();
  await expect(a).toHaveURL(/\/refunds/);
  await b.goto("/refunds");
  await clickUntil(b.getByRole("button", { name: "Approve", exact: true }), () => expect(b.getByText("Approved.")).toBeVisible({ timeout: 2500 }));
  expect(runSqlOne<{ n: number }>(`select count(*)::int as n from public.ledger_transactions where kind = 'reversal'`).n).toBeGreaterThan(0);

  await a.goto("/ledger");
  await expect(a.getByText("Ledger verified").or(a.getByText("Not verified yet"))).toBeVisible();
  await clickUntil(a.getByRole("button", { name: "Verify now" }), () => expect(a.getByText("Every balance matches its entries.")).toBeVisible({ timeout: 4000 }));

  // --- No silent edits: even the database owner cannot rewrite history ------------------------------
  expect(() => runSql(`update public.ledger_entries set debit = debit + 1 where id = (select min(id) from public.ledger_entries)`)).toThrow();
  expect(() => runSql(`delete from public.ledger_transactions`)).toThrow();

  await a.context().close();
  await b.context().close();
});

test("care: tickets, ratings and the SOS flow", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const suffix = Date.now().toString(36);
  const site = newSite();
  const zoneId = createZone(`m3b_${suffix}`, site.lat, site.lng);
  publishRuleSql(zoneId);

  const pax = await makePassenger(baseURL!);
  const driverToken = await makeOnlineDriver(createAppUser, site.lat + 0.003, site.lng + 0.003);
  const driver = apiClient(baseURL!, driverToken);
  const { id: bike } = runSqlOne<{ id: string }>("select id from public.vehicle_categories where code = 'bike'");

  const done = await ride(pax.api, driver, bike, "completed", site);

  // Ratings
  expect((await pax.api.post(`/trips/${done.tripId}/rate`, { score: 9 })).status).toBe(400);
  const rated = await pax.api.post(`/trips/${done.tripId}/rate`, { score: 2, comment: `Rushed and rude ${suffix}` });
  expect(rated.status, JSON.stringify(rated.body)).toBe(200);
  expect((await pax.api.post(`/trips/${done.tripId}/rate`, { score: 5 })).status).toBe(409);

  // A passenger opens a ticket; support replies in the UI
  const ticket = await pax.api.post("/support/tickets", { tripId: done.tripId, category: "payment", subject: `Question about my fare ${suffix}`, body: "Why was I charged this amount?" });
  expect(ticket.status, JSON.stringify(ticket.body)).toBe(201);
  const ticketId = data(ticket).id as string;
  expect((await pax.api.post("/support/tickets", { category: "bogus", subject: "x", body: "y" })).status).toBe(400);
  expect((await (await makePassenger(baseURL!)).api.get(`/support/tickets/${ticketId}`)).status).toBe(404);

  const admin = await adminPage(browser, "m3care");
  await admin.goto("/support");
  await clickUntil(admin.getByRole("row").filter({ hasText: `Question about my fare ${suffix}` }), () => expect(admin).toHaveURL(new RegExp("/support/[0-9a-f-]{36}"), { timeout: 1500 }));
  await expect(admin.getByText("Why was I charged this amount?")).toBeVisible();
  await admin.getByLabel("Reply", { exact: true }).fill("The fare is distance plus time, here is the breakdown.");
  await admin.getByRole("button", { name: "Send reply" }).click();
  await expect(admin.getByText("Reply sent.")).toBeVisible();
  await admin.getByLabel("Reply", { exact: true }).fill("Internal: checked the trail, fare is correct.");
  await admin.getByText("Internal note (not shown to the user)").click();
  await admin.getByRole("button", { name: "Add note" }).click();
  await expect(admin.getByText("Note saved.")).toBeVisible();

  const thread = data(await pax.api.get(`/support/tickets/${ticketId}`));
  expect(thread.messages).toHaveLength(2); // the question and the public reply: never the internal note
  expect(JSON.stringify(thread)).not.toContain("Internal: checked");

  // Low rating is moderated
  await admin.goto("/ratings");
  await expect(admin.getByText(`Rushed and rude ${suffix}`)).toBeVisible();
  const hide = admin.getByRole("dialog");
  await clickUntil(admin.getByRole("row").filter({ hasText: `Rushed and rude ${suffix}` }).getByRole("button", { name: "Hide" }), () => expect(hide).toBeVisible({ timeout: 1500 }));
  await hide.getByLabel("Reason").fill("Abusive language in the comment");
  await hide.getByRole("button", { name: "Hide" }).click();
  await expect(admin.getByText("Rating hidden.")).toBeVisible();

  // SOS during a ride in progress
  const pax2 = await makePassenger(baseURL!);
  const live = await ride(pax2.api, driver, bike, "started", site);
  expect((await pax.api.post(`/trips/${live.tripId}/sos`, {})).status).toBe(404); // not a participant
  const sos = await pax2.api.post(`/trips/${live.tripId}/sos`, { note: "Driver is taking a strange route" });
  expect(sos.status, JSON.stringify(sos.body)).toBe(200);
  const again = await pax2.api.post(`/trips/${live.tripId}/sos`, {});
  expect(data(again).id).toBe(data(sos).id);
  expect(data(again).repeat).toBe(true);

  await admin.goto("/safety");
  await expect(admin.getByRole("alert").filter({ hasText: "need acknowledging" })).toBeVisible();
  await clickUntil(admin.getByRole("row").filter({ hasText: "SOS" }).first(), () => expect(admin).toHaveURL(new RegExp("/safety/[0-9a-f-]{36}"), { timeout: 1500 }));
  await expect(admin.getByText("Driver is taking a strange route").first()).toBeVisible();
  const ack = admin.getByRole("dialog");
  await clickUntil(admin.getByRole("button", { name: "Acknowledge", exact: true }), () => expect(ack).toBeVisible({ timeout: 1500 }));
  await ack.getByLabel("Reason").fill("Calling the driver now");
  await ack.getByRole("button", { name: "Acknowledge", exact: true }).click();
  await expect(admin.getByText("Incident updated.")).toBeVisible();
  await expect(admin.getByText("Start investigating")).toBeVisible();

  await admin.context().close();
});

test("authorisation: roles and strict input on the money and care API", async ({ baseURL }) => {
  const pax = await makePassenger(baseURL!);
  const site = newSite();
  const driverToken = await makeOnlineDriver(createAppUser, site.lat, site.lng);
  const driver = apiClient(baseURL!, driverToken);

  expect((await pax.api.get("/driver/wallet")).status).toBe(403);
  expect((await driver.get("/driver/wallet")).status).toBe(200);
  expect((await driver.post("/rides/00000000-0000-0000-0000-000000000000/promo", { code: "WELCOME" })).status).toBe(403);
  expect((await pax.api.post("/rides/00000000-0000-0000-0000-000000000000/promo", { code: "WELCOME" })).status).toBe(404);
  expect((await pax.api.post("/rides/00000000-0000-0000-0000-000000000000/promo", { code: "WELCOME", extra: 1 })).status).toBe(400);
  expect((await driver.put("/driver/payout-account", { method: "cheque", holder: "X Y", ref: "12345" })).status).toBe(400);
  const account = await driver.put("/driver/payout-account", { method: "bkash", holder: "Driver One", ref: "01711111234" });
  expect(account.status, JSON.stringify(account.body)).toBe(200);
  expect(data(account).payout_account.masked).toContain("•");
  expect(JSON.stringify(account.body)).not.toContain("01711111234");
  expect((await pax.api.get("/support/tickets")).status).toBe(200);
});
