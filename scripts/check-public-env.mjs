// Fails if a NEXT_PUBLIC_* variable looks like a secret (docs/spec/01-architecture.md §6).
// Scans .env.example and the source tree for NEXT_PUBLIC_ names.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set(["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
const SUSPICIOUS = /SECRET|SERVICE|PASSWORD|TOKEN|PRIVATE|KEY/;
const NAME = /NEXT_PUBLIC_[A-Z0-9_]+/g;

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) yield path;
  }
}

const sources = [".env.example", ...files("src")];
const offenders = new Set();
for (const file of sources) {
  for (const name of readFileSync(file, "utf8").match(NAME) ?? []) {
    if (SUSPICIOUS.test(name) && !ALLOWED.has(name)) offenders.add(`${name} (${file})`);
  }
}

if (offenders.size > 0) {
  console.error("Public env vars that look like secrets:\n  " + [...offenders].join("\n  "));
  process.exit(1);
}
console.log("public env check passed");
