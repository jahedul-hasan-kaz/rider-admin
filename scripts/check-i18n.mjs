// Fails if English and Bengali message files don't have the same keys.
import { readFileSync } from "node:fs";

const load = (f) => JSON.parse(readFileSync(f, "utf8"));
const keys = (o, prefix = "") =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

const en = new Set(keys(load("src/i18n/messages/en.json")));
const bn = new Set(keys(load("src/i18n/messages/bn.json")));
const missingBn = [...en].filter((k) => !bn.has(k));
const extraBn = [...bn].filter((k) => !en.has(k));

if (missingBn.length || extraBn.length) {
  if (missingBn.length) console.error("Missing in bn.json:\n  " + missingBn.join("\n  "));
  if (extraBn.length) console.error("Only in bn.json:\n  " + extraBn.join("\n  "));
  process.exit(1);
}
console.log(`i18n check passed (${en.size} keys)`);
