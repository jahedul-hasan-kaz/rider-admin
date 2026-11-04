#!/usr/bin/env node
// LOCAL DEVELOPMENT ONLY: creates a super admin in the local Supabase stack.
//
//   DEV_ADMIN_PASSWORD='…' pnpm dev:bootstrap-admin [email]
//
// Uses a system invitation (the only path that can create an admin), then
// creates the auth user through the local GoTrue admin API. Refuses to run
// against anything but a local Supabase. The password is never written to disk.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const email = (process.argv[2] ?? "admin@yopmail.com").toLowerCase();
const password = process.env.DEV_ADMIN_PASSWORD;
if (!password) {
  console.error("Set DEV_ADMIN_PASSWORD (12+ chars, upper, lower, digit, symbol).");
  process.exit(1);
}
if (!/^[^@\s'"]+@[^@\s'"]+\.[^@\s'"]+$/.test(email)) {
  console.error("Invalid email.");
  process.exit(1);
}

const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], { encoding: "utf8", shell: true }));
const apiUrl = new URL(status.API_URL);
if (!["127.0.0.1", "localhost"].includes(apiUrl.hostname)) {
  console.error(`Refusing to run against ${apiUrl.host}: local Supabase only.`);
  process.exit(1);
}

const sql = `
insert into public.admin_invitations (email, full_name, template_ids, reason, invited_by)
select '${email}', 'Super Admin', array[(select id from public.permission_templates where code = 'super_admin')], 'Local development bootstrap', null
where not exists (select 1 from public.admin_invitations where email = '${email}' and status = 'pending')
  and not exists (select 1 from public.profiles where email = '${email}');`;
const dir = mkdtempSync(join(tmpdir(), "ra-bootstrap-"));
const file = join(dir, "invite.sql");
writeFileSync(file, sql);
try {
  execFileSync("pnpm", ["exec", "supabase", "db", "query", "--local", "--file", file], { stdio: "ignore", shell: true });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const res = await fetch(`${status.API_URL}/auth/v1/admin/users`, {
  method: "POST",
  headers: {
    apikey: status.SECRET_KEY,
    Authorization: `Bearer ${status.SECRET_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const body = await res.json();
if (!res.ok) {
  console.error("Could not create the auth user:", body.msg ?? body.message ?? res.status);
  process.exit(1);
}
console.log(`Local super admin ready: ${email}. Sign in at http://localhost:3000/login and enrol 2FA.`);
