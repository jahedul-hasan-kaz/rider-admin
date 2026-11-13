import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { apiClient, createAppUser, uploadDocument } from "./api-client";
import { bootstrapSuperAdmin, signInAdmin, strongPassword, uniqueEmail } from "./helpers";

// M1 exit criteria (docs/spec/09-roadmap.md): only approved drivers with active
// vehicles can go online; unauthorised access is rejected. The driver side runs
// through the real REST API and Storage; the admin side through the UI.

const DHAKA_BOX = {
  type: "Polygon",
  coordinates: [[[90.3, 23.7], [90.5, 23.7], [90.5, 23.9], [90.3, 23.9], [90.3, 23.7]]],
};
const IN_ZONE = { lat: 23.8, lng: 90.4 };
const OUT_OF_ZONE = { lat: 22.33, lng: 91.83 }; // Chattogram
const NEXT_YEAR = `${new Date().getFullYear() + 1}-12-31`;

test("driver onboards via the API, admin approves in the UI, driver goes online", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const suffix = Date.now().toString(36);

  // --- Admin: sign in, create an active service zone by uploading GeoJSON -----
  const adminEmail = uniqueEmail("m1admin");
  const adminPassword = strongPassword();
  bootstrapSuperAdmin(adminEmail, adminPassword);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await ctx.newPage();
  await signInAdmin(admin, adminEmail, adminPassword);

  await admin.goto("/zones/new");
  await admin.getByLabel("Code").fill(`e2e_${suffix}`);
  await admin.getByLabel("Name").fill(`E2E Dhaka ${suffix}`);
  await admin.getByLabel("Active (drivers can go online here)").click();
  await admin.locator('input[type="file"]').setInputFiles({
    name: "zone.geojson",
    mimeType: "application/geo+json",
    buffer: Buffer.from(JSON.stringify({ type: "Feature", properties: {}, geometry: DHAKA_BOX })),
  });
  await expect(admin.getByText(/Area: 45\d(\.\d+)? km²/)).toBeVisible();
  await admin.getByRole("button", { name: "Save zone" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Pilot launch zone" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Save zone" }).click();
  await expect(admin.getByText("Zone saved.")).toBeVisible();

  // --- Driver: sign up, onboard, vehicle, documents (REST + Storage) ----------
  const token = await createAppUser(uniqueEmail("driver"), strongPassword());
  const driver = apiClient(baseURL!, token);
  const driverName = `E2E Driver ${suffix}`;

  expect((await driver.post("/onboarding/driver", { full_name: driverName })).status).toBe(201);
  const categories = await driver.get("/categories");
  const bike = (categories.body.data as unknown as { id: string; code: string }[]).find((c) => c.code === "bike")!;

  // Strict input: unknown keys are rejected.
  const strict = await driver.post("/driver/vehicles", { category_id: bike.id, make: "Honda", model: "CB", color: "Red", registration_number: "X", year: 2022, role: "admin" });
  expect(strict.status).toBe(400);

  // Idempotency: the same key replays the first response instead of creating twice.
  const key = randomUUID();
  const vehicleBody = { category_id: bike.id, make: "Honda", model: "CB Hornet", color: "Red", registration_number: `DHA-${suffix}`.toUpperCase(), year: 2022 };
  const first = await driver.post("/driver/vehicles", vehicleBody, key);
  const replay = await driver.post("/driver/vehicles", vehicleBody, key);
  expect(first.status).toBe(201);
  expect(replay.body).toEqual(first.body);
  const vehicleId = (first.body.data as { vehicle_id: string }).vehicle_id;

  // A file whose bytes don't match its declared type is refused.
  const fake = await uploadDocument(driver, { document_type: "profile_photo" }, Buffer.from("%PDF-1.7 not really a jpeg"));
  expect(fake.status).toBe(400);
  expect(fake.body.error?.code).toBe("VALIDATION_FAILED");

  for (const type of ["profile_photo", "national_id", "driving_licence"]) {
    const res = await uploadDocument(driver, {
      document_type: type,
      expires_at: NEXT_YEAR,
      ...(type === "driving_licence" ? { document_number: "DK-0987654" } : {}),
    });
    expect(res.status, `${type}: ${JSON.stringify(res.body)}`).toBe(200);
  }
  for (const type of ["vehicle_registration", "fitness_certificate", "tax_token", "insurance"]) {
    const res = await uploadDocument(driver, { document_type: type, vehicle_id: vehicleId, expires_at: NEXT_YEAR });
    expect(res.status, `${type}: ${JSON.stringify(res.body)}`).toBe(200);
  }

  // Exit criterion: an unapproved driver cannot go online.
  const early = await driver.post("/driver/availability", { online: true, ...IN_ZONE });
  expect(early.status).toBe(403);
  expect(early.body.error?.code).toBe("DRIVER_NOT_APPROVED");

  const submitted = await driver.post("/driver/application/submit");
  expect(submitted.status).toBe(200);
  expect((submitted.body.data as { onboarding_status: string }).onboarding_status).toBe("submitted");

  // Drivers cannot use admin data paths.
  expect((await driver.get("/driver/onboarding")).status).toBe(200);
  expect((await apiClient(baseURL!, "not-a-token").get("/driver/onboarding")).status).toBe(401);

  // --- Admin: review every document, verify the vehicle, approve the driver ---
  await admin.goto("/drivers?tab=applications");
  await admin.getByRole("row", { name: new RegExp(driverName) }).click();
  await expect(admin.getByRole("heading", { name: driverName })).toBeVisible();

  // PII is masked and revealed only with a logged reason.
  await admin.getByRole("button", { name: "Reveal" }).first().click();
  await admin.getByRole("dialog").getByRole("button", { name: "Customer support call" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Reveal" }).click();
  await expect(admin.getByText("Revealed and logged.")).toBeVisible();
  await expect(admin.getByText(/\+8801\d{9}/)).toBeVisible();

  await admin.getByRole("link", { name: "Review application" }).click();
  await expect(admin.getByText("A approve · R reject · → next")).toBeVisible();
  // Approving moves the selection to the next pending document; wait for the
  // checklist to show one more "Approved" each time (polling keeps the network busy).
  const approvedItems = admin.getByRole("button", { name: /Approved · Expires/ });
  for (let i = 1; i <= 7; i++) {
    const approve = admin.getByRole("button", { name: "Approve", exact: true });
    await expect(approve).toBeEnabled();
    await approve.click();
    await expect(approvedItems).toHaveCount(i);
  }

  await admin.getByRole("button", { name: "Verify vehicle" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "All vehicle documents verified" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Verify vehicle" }).click();
  await expect(admin.getByText("Vehicle verified.").first()).toBeVisible();

  const approveDriver = admin.getByRole("button", { name: "Approve driver" });
  await expect(approveDriver).toBeEnabled();
  await approveDriver.click();
  await admin.getByRole("dialog").getByRole("button", { name: "All documents verified" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Approve driver" }).click();
  await expect(admin.getByText("Driver approved.")).toBeVisible();

  // --- Driver goes online only inside an active zone ------------------------
  const outside = await driver.post("/driver/availability", { online: true, ...OUT_OF_ZONE });
  expect(outside.status).toBe(422);
  expect(outside.body.error?.code).toBe("OUT_OF_SERVICE_AREA");
  const online = await driver.post("/driver/availability", { online: true, ...IN_ZONE });
  expect(online.status, JSON.stringify(online.body)).toBe(200);
  expect((online.body.data as { availability: string }).availability).toBe("online");

  await admin.reload();
  await expect(admin.getByText("Online").first()).toBeVisible();

  // --- Suspending the vehicle takes the driver offline -----------------------
  await admin.goto(`/vehicles/${vehicleId}`);
  await admin.getByRole("button", { name: "Suspend" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Accident reported" }).click();
  await admin.getByRole("dialog").getByRole("button", { name: "Suspend" }).click();
  await expect(admin.getByText("Vehicle suspended.")).toBeVisible();
  const again = await driver.post("/driver/availability", { online: true, ...IN_ZONE });
  expect(again.body.error?.code).toBe("VEHICLE_NOT_ACTIVE");

  await ctx.close();
});
