#!/usr/bin/env node
// STAGING ONLY: creates the demo accounts in the project that .env.local points at, then
// sets their roles with supabase/seed/hosted-users.sql. Run AFTER `supabase db push`.
//
//   pnpm seed:hosted-users            (password defaults to DEMO_PASSWORD or Abcd@001)
//
// Existing auth users are left alone (passwords are not overwritten).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const env = { ...process.env };
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SECRET_KEY;
const dbUrl = env.SUPABASE_DB_URL;
if (!url || !key || !dbUrl) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_DB_URL in .env.local.");
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(url)) {
  console.error("This script is for a hosted project; for local use pnpm dev:bootstrap-admin.");
  process.exit(1);
}
const password = env.DEMO_PASSWORD ?? "Abcd@001";
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

for (const email of ["admin@yopmail.com", "rider@yopmail.com", "customer@yopmail.com"]) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) console.log(`created   ${email}`);
  else if (res.status === 422 || /already|registered|exists/i.test(body.msg ?? body.message ?? "")) console.log(`exists    ${email}`);
  else {
    console.error(`FAILED    ${email}: ${body.msg ?? body.message ?? res.status}`);
    process.exit(1);
  }
}

execFileSync("pnpm", ["exec", "supabase", "db", "query", "--db-url", dbUrl, "--file", "supabase/seed/hosted-users.sql"], { stdio: "inherit", shell: true });
console.log("Roles set. Sign in at your app URL.");
