#!/usr/bin/env node
// Runs a command against the LOCAL Supabase stack without touching .env.local:
//   pnpm with-local next build
//   pnpm with-local next start -p 3005
// Process env takes precedence over .env files in Next.js.
import { execFileSync, spawn } from "node:child_process";

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("Usage: pnpm with-local <command> [...args]");
  process.exit(1);
}

const status = JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], { encoding: "utf8", shell: true }));
const port = args.includes("-p") ? args[args.indexOf("-p") + 1] : "3000";

const child = spawn(cmd, args, {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_ENV: "local",
    SUPABASE_SECRET_KEY: status.SECRET_KEY,
    SUPABASE_DB_URL: status.DB_URL,
    APP_BASE_URL: process.env.APP_BASE_URL ?? `http://localhost:${port}`,
  },
});
child.on("exit", (code) => process.exit(code ?? 1));
