#!/usr/bin/env node
// Builds, from docs/workflows/ride-workflow.json:
//   ride-workflow.html      one file, opens by double-click (tabs + an interactive mind map)
//   ride-workflow.mindmap.md   Markdown outline for Markmap, XMind (File > Import), Obsidian
//   ride-workflow.opml      OPML outline for XMind, MindNode, FreeMind, OmniOutliner and most mind-map apps
//
//   node scripts/build-workflow-html.mjs
import { readFileSync, writeFileSync } from "node:fs";

const dir = "docs/workflows";
const json = JSON.parse(readFileSync(`${dir}/ride-workflow.json`, "utf8"));
const template = readFileSync(`${dir}/ride-workflow.template.html`, "utf8");

const STATUS = { built: "built", partial: "partly built", not_built: "not built" };
const tag = (s) => (s ? ` [${STATUS[s]}]` : "");
const leaf = (text) => ({ t: text });
const group = (t, kids, status) => ({ t, s: status, c: kids.filter(Boolean) });

function stepNode(s) {
  const kids = [];
  if (s.what_happens) kids.push(group("What happens", [leaf(s.what_happens)]));
  if (s.api) kids.push(group("API call", [leaf(s.api)]));
  if (s.where) kids.push(group("Where in the admin panel", [leaf(s.where)]));
  if (s.returns) kids.push(group("Returns", s.returns.map(leaf)));
  if (s.rules) kids.push(group("Rules", s.rules.map(leaf)));
  if (s.about_choosing_a_driver) {
    kids.push(group("Who picks whom", [leaf(`Driver picks passenger: ${s.about_choosing_a_driver.driver_picks_passenger}`), leaf(`Passenger picks driver: ${s.about_choosing_a_driver.passenger_picks_driver}`)]));
  }
  if (s.note) kids.push(group("Note", [leaf(s.note)]));
  return group(`${s.id}. ${s.title}`, kids, s.status);
}

const m = json.money_flow;
const tree = group("Rider platform workflow", [
  group("Passenger journey", json.passenger_flow.map(stepNode)),
  group("Driver journey", json.driver_flow.map(stepNode)),
  group("Money and profit", [
    group("How cash moves", [leaf("Passenger pays the full fare in cash to the driver"), leaf("Driver deposits the organisation's share (bKash, Nagad, bank or office)"), leaf("Organisation pays the driver what it owes (promo discounts, incentives, cancellation fees) in the weekly payout")]),
    group("Fare", [leaf(m.fare_formula)]),
    group("Who gets what", Object.entries(m.who_gets_what).map(([k, v]) => group(k.replaceAll("_", " "), [leaf(v)]))),
    group("Worked examples", m.worked_examples.map((e) => group(e.case, ["fare", "passenger_pays_driver", "driver_earning", "organisation_earns", "settlement"].filter((k) => e[k] !== undefined).map((k) => leaf(`${k.replaceAll("_", " ")}: ${e[k]}`))))),
    group("Organisation profit", [group("Revenue", m.organisation_profit.revenue.map(leaf)), group("Minus", m.organisation_profit.minus.map(leaf)), group("Where to see it", [leaf(m.organisation_profit.where_to_see_it)])]),
    group("Controls", m.controls.map(leaf)),
  ]),
  group("One-at-a-time rules", Object.entries(json.locks_and_fairness).map(([k, v]) => group(k.replaceAll("_", " "), [leaf(v)]))),
  group("Not built yet", json.not_built_yet.map((n) => group(n.item, [leaf(n.note)]))),
]);

// --- Markdown outline (Markmap / XMind / Obsidian)
const mdLines = [];
const md = (n, depth) => {
  if (depth === 0) mdLines.push(`# ${n.t}`);
  else if (depth <= 2) mdLines.push(`${"#".repeat(depth + 1)} ${n.t}${tag(n.s)}`);
  else mdLines.push(`${"  ".repeat(depth - 3)}- ${n.t}${tag(n.s)}`);
  (n.c ?? []).forEach((k) => md(k, depth + 1));
};
md(tree, 0);
writeFileSync(`${dir}/ride-workflow.mindmap.md`, mdLines.join("\n") + "\n");

// --- OPML outline
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const opml = (n, pad) => (n.c?.length ? `${pad}<outline text="${esc(n.t + tag(n.s))}">\n${n.c.map((k) => opml(k, pad + "  ")).join("")}${pad}</outline>\n` : `${pad}<outline text="${esc(n.t + tag(n.s))}"/>\n`);
writeFileSync(
  `${dir}/ride-workflow.opml`,
  `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head><title>${esc(json.title)}</title></head>\n  <body>\n${opml(tree, "    ")}  </body>\n</opml>\n`,
);

// --- HTML (the data is inlined; "</" would end the <script> block early)
const inline = (v) => JSON.stringify(v).replaceAll("</", "<\\/");
writeFileSync(`${dir}/ride-workflow.html`, template.replace("/*__DATA__*/", () => inline(json)).replace("/*__TREE__*/", () => inline(tree)));
console.log(`wrote ${dir}/ride-workflow.html, .mindmap.md and .opml`);
