import "server-only";
import { createHash } from "node:crypto";
import { log } from "@/server/log";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";

// Staging convenience: makes sure the demo accounts exist every time the app starts, so a fresh or reset database
// is usable straight away. Never runs in production unless SEED_DEMO_USERS=true is set on purpose.

const DEMO_EMAILS = ["admin@yopmail.com", "rider@yopmail.com", "customer@yopmail.com"] as const;

export function demoSeedEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.SEED_DEMO_USERS === "false") return false;
  if (env.SEED_DEMO_USERS === "true") return true;
  return env.NEXT_PUBLIC_APP_ENV !== "production";
}

export async function ensureDemoUsers(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const password = env.DEMO_PASSWORD || "Abcd@001";
  const admin = createSupabaseAdminClient("seed.demo");

  for (const email of DEMO_EMAILS) {
    // Existing sign-in identities are left alone: passwords are never overwritten.
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (!error) log.info({ email }, "demo user created");
    else if (!/already|registered|exists/i.test(error.message)) log.warn({ email, err: error.message }, "demo user could not be created");
  }

  const { data, error } = await admin.schema("api").rpc("seed_demo_users");
  if (error) {
    log.error({ err: error.message }, "demo seed failed");
    return;
  }
  log.info({ result: data }, "demo seed applied");
}

// ---------------------------------------------------------------------------
// Demo data (SEED_DEMO_DATA=true): staff with different permissions, passengers, drivers, rides, money, support,
// safety. supabase/migrations/20261111090000_demo_data_seed.sql does the work in phases; each phase runs once.
// ---------------------------------------------------------------------------

export function demoDataEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SEED_DEMO_DATA === "true" && demoSeedEnabled(env);
}

type Person = { email: string; name: string };
const RIDE_BATCHES = 6;
// A 1×1 PNG: every demo document gets a real (tiny) file so staff can open it.
const PLACEHOLDER_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqPpfDwAEbgH9WbnF6QAAAABJRU5ErkJggg==", "base64");

export async function ensureDemoData(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const admin = createSupabaseAdminClient("seed.demo");
  const seed = (phase: string, batch = 0, arg: Record<string, unknown> = {}) =>
    admin.schema("api").rpc("demo_seed", { p_phase: phase, p_batch: batch, p_arg: arg as never });

  const status = await seed("status");
  if (status.error) {
    log.error({ err: status.error.message }, "demo data: the demo_seed migration is not applied");
    return;
  }
  if (((status.data as { done: string[] }).done ?? []).includes("finish:0")) return;
  log.info("demo data: seeding (one time)");

  // 1. Who: staff are invited first, so their sign-in identities become admins with the right templates.
  const plan = await seed("plan");
  if (plan.error) throw new Error(`demo plan failed: ${plan.error.message}`);
  const people = plan.data as { staff: Person[]; passengers: Person[]; drivers: Person[] };
  const password = env.DEMO_PASSWORD || "Abcd@001";
  for (const p of [...people.staff, ...people.passengers, ...people.drivers]) {
    const { error } = await admin.auth.admin.createUser({ email: p.email, password, email_confirm: true, user_metadata: { full_name: p.name } });
    if (error && !/already|registered|exists/i.test(error.message)) log.warn({ email: p.email, err: error.message }, "demo user could not be created");
  }

  // 2. Setup, then the document files it asked for.
  const sha256 = createHash("sha256").update(PLACEHOLDER_PNG).digest("hex");
  const setup = await seed("setup", 0, { file_sha256: sha256 });
  if (setup.error) throw new Error(`demo setup failed: ${setup.error.message}`);
  for (const path of (setup.data as { documents?: string[] }).documents ?? []) {
    const up = await admin.storage.from("driver-documents").upload(path, PLACEHOLDER_PNG, { contentType: "image/png", upsert: true });
    if (up.error) log.warn({ path, err: up.error.message }, "demo document file not stored");
  }

  // 3. History, the live picture, money, support and safety, then dashboards.
  const steps: [string, number][] = [
    ...Array.from({ length: RIDE_BATCHES }, (_, i) => ["rides", i] as [string, number]),
    ["live", 0],
    ["money", 0],
    ["care", 0],
    ["finish", 0],
  ];
  for (const [phase, batch] of steps) {
    const res = await seed(phase, batch);
    if (res.error) throw new Error(`demo ${phase} ${batch} failed: ${res.error.message}`);
    const warnings = (res.data as { warnings?: string[] } | null)?.warnings ?? [];
    if (warnings.length > 0) log.warn({ phase, warnings }, "demo data: some optional items were skipped");
  }
  log.info("demo data: done");
}
