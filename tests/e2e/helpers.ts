import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";

const MAILPIT = process.env.E2E_MAILPIT_URL ?? "http://127.0.0.1:54324";

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) from a base32 secret. */
export function totp(secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

/** Waits until the current TOTP window has ≥ 5 s left, so a code isn't reused or expired. */
export async function freshTotp(secret: string): Promise<string> {
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 5_000) await new Promise((r) => setTimeout(r, remaining + 250));
  return totp(secret);
}

export function uniqueEmail(prefix: string) {
  return `${prefix}.${Date.now()}.${randomBytes(3).toString("hex")}@e2e.test`;
}

export function strongPassword() {
  return `E2e-${randomBytes(9).toString("base64url")}!7a`;
}

/** Creates a local super admin through the bootstrap script (local Supabase only). */
export function bootstrapSuperAdmin(email: string, password: string) {
  execFileSync("node", ["scripts/dev-bootstrap-admin.mjs", email], {
    env: { ...process.env, DEV_ADMIN_PASSWORD: password },
    stdio: "ignore",
  });
}

/** Signs in with email and password. Two-factor is optional, so people who have not turned it on land on the app. */
export async function signInAdmin(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/(dashboard|change-password)/);
}

/** Profile → Security → Turn on: scans nothing, reads the secret, enters a code; returns the TOTP secret. */
export async function turnOnMfaInProfile(page: Page): Promise<string> {
  await page.goto("/profile");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Turn on" }).click();
  const secret = (await page.getByTestId("mfa-secret").textContent())!.trim();
  await page.getByLabel("Authentication code").fill(await freshTotp(secret));
  await expect(page.getByText("Two-factor authentication is on.").first()).toBeVisible();
  return secret;
}

/** Latest email to `to` from the local Mailpit inbox; returns the confirm link. */
export async function inviteLinkFor(to: string, baseURL: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`).then((r) => r.json());
    const id = search.messages?.[0]?.ID;
    if (id) {
      const message = await fetch(`${MAILPIT}/api/v1/message/${id}`).then((r) => r.json());
      const href = String(message.HTML).match(/href="([^"]*\/auth\/confirm[^"]*)"/)?.[1];
      if (href) {
        const url = new URL(href.replaceAll("&amp;", "&"));
        return new URL(url.pathname + url.search, baseURL).toString();
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No invitation email for ${to}`);
}

// --- M2 fixtures: direct SQL against the LOCAL database (never hosted) ---------------------------------

import { execFile, execFileSync as execFileSyncSql } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function withSqlFile<T>(sql: string, run: (file: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "ra-sql-"));
  const file = join(dir, "q.sql");
  writeFileSync(file, sql);
  try {
    return run(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs several statements as the database owner via psql (no rows returned). Local database only. */
export function execSql(sql: string): void {
  execFileSyncSql("docker", ["exec", "-i", "supabase_db_rider-admin", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
    input: sql,
    stdio: ["pipe", "ignore", "pipe"],
  });
}

/** Runs ONE statement as the database owner and returns its rows (the CLI allows a single statement). */
export function runSql<T = Record<string, unknown>>(sql: string): T[] {
  return withSqlFile(sql, (file) => {
    const out = execFileSyncSql("pnpm", ["exec", "supabase", "db", "query", "--local", "--file", file], { encoding: "utf8", shell: true });
    const start = out.indexOf("{");
    const parsed = JSON.parse(out.slice(start, out.lastIndexOf("}") + 1));
    return (parsed.rows ?? []) as T[];
  });
}

/** First row of the last statement; throws when there is none. */
export function runSqlOne<T = Record<string, unknown>>(sql: string): T {
  const [row] = runSql<T>(sql);
  if (!row) throw new Error("expected a row");
  return row;
}

/** Same, asynchronous: lets several SQL statements run at the same moment as API calls. */
export function runSqlAsync(sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), "ra-sql-"));
    const file = join(dir, "q.sql");
    writeFileSync(file, sql);
    execFile("pnpm", ["exec", "supabase", "db", "query", "--local", "--file", file], { shell: true }, (error) => {
      rmSync(dir, { recursive: true, force: true });
      if (error) reject(error);
      else resolve();
    });
  });
}

export function jwtSub(token: string): string {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()).sub as string;
}

/** A small active zone around (lat, lng), unique per call so tests can't collide. */
export function createZone(code: string, lat: number, lng: number, half = 0.05): string {
  const [row] = runSql<{ id: string }>(`
    insert into public.service_zones (code, name, boundary, area_km2, active)
    values ('${code}', '${code}',
      extensions.st_multi(extensions.st_geomfromtext('POLYGON((${lng - half} ${lat - half},${lng + half} ${lat - half},${lng + half} ${lat + half},${lng - half} ${lat + half},${lng - half} ${lat - half}))', 4326))::extensions.geography,
      10, true)
    returning id;`);
  return row!.id;
}

/** Publishes a fare rule straight in SQL (the UI flow is covered separately). */
export function publishRuleSql(zoneId: string) {
  execSql(`
    insert into public.fare_rules (category_id, zone_id, rule_version, status, base_fare, per_km, per_minute, minimum_fare, booking_fee,
      waiting_per_minute, free_waiting_minutes, cancellation_fee, platform_commission_pct, max_surge_multiplier, effective_from)
    select id, '${zoneId}', 1, 'active', 40, 20, 2, 60, 0, 2, 3, 30, 0.15, 1.5, now() - interval '1 minute'
    from public.vehicle_categories where code = 'bike';`);
}

/** An approved driver with an active bike, online at (lat, lng). Returns their access token. */
export async function makeOnlineDriver(createUser: (email: string, pw: string) => Promise<string>, lat: number, lng: number): Promise<string> {
  const email = uniqueEmail("drv");
  const token = await createUser(email, strongPassword());
  const id = jwtSub(token);
  execSql(`
    select private.promote_user_role('${id}', 'driver');
    insert into public.driver_profiles (user_id, onboarding_status, approved_at) values ('${id}', 'approved', now());
    insert into public.vehicles (driver_id, category_id, make, model, color, registration_number, year, status)
    select dp.id, (select id from public.vehicle_categories where code = 'bike'), 'Honda', 'CB', 'Red',
           'E2E-' || upper(substr(md5(random()::text), 1, 8)), 2022, 'active'
    from public.driver_profiles dp where dp.user_id = '${id}';
    update public.driver_profiles set current_vehicle_id = (select v.id from public.vehicles v where v.driver_id = driver_profiles.id),
           availability = 'online' where user_id = '${id}';
    insert into public.driver_live_locations (driver_id, location, recorded_at, updated_at)
    select id, private.point(${lat}, ${lng}), now(), now() from public.driver_profiles where user_id = '${id}';
  `);
  return token;
}
