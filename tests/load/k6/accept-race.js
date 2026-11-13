// Many drivers answer the same offer at once (set OFFER_ID to a pending offer made for many candidates, or use a
// test harness that offers to all of them). Exactly one 200 is allowed; everyone else gets 409, never a 5xx.
import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";
import { SharedArray } from "k6/data";

const drivers = new SharedArray("drivers", () => JSON.parse(open(__ENV.TOKENS)).drivers);
const base = __ENV.BASE_URL || "http://localhost:3000";
const won = new Counter("accepts_won");
const lost = new Counter("accepts_lost");

export const options = {
  scenarios: { race: { executor: "per-vu-iterations", vus: Math.min(drivers.length, 75), iterations: 1, maxDuration: "30s" } },
  thresholds: { accepts_won: ["count<=1"] },
};

export default function run() {
  const d = drivers[(__VU - 1) % drivers.length];
  const res = http.post(`${base}/api/v1/driver/offers/${__ENV.OFFER_ID}/accept`, "{}", {
    headers: { Authorization: `Bearer ${d.token}`, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
  });
  check(res, { "no server error": (r) => r.status < 500 });
  if (res.status === 200) won.add(1);
  else lost.add(1);
}
