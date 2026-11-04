// Driver location ingest: each virtual driver posts a batch of 2 points every 4 seconds.
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";

const drivers = new SharedArray("drivers", () => JSON.parse(open(__ENV.TOKENS)).drivers);
const base = __ENV.BASE_URL || "http://localhost:3000";

export const options = {
  scenarios: { drivers: { executor: "constant-vus", vus: Number(__ENV.VUS || 100), duration: __ENV.DURATION || "2m" } },
  thresholds: { http_req_failed: ["rate<0.001"], http_req_duration: ["p(95)<150"] },
};

export default function run() {
  const d = drivers[(__VU - 1) % drivers.length];
  const now = Date.now();
  const points = [0, 1].map((i) => ({
    lat: 23.8 + Math.random() * 0.05,
    lng: 90.4 + Math.random() * 0.05,
    speed: 8,
    accuracy: 10,
    recorded_at: new Date(now - (1 - i) * 2000).toISOString(),
  }));
  const res = http.post(`${base}/api/v1/driver/location`, JSON.stringify({ points }), {
    headers: { Authorization: `Bearer ${d.token}`, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
  });
  check(res, { accepted: (r) => r.status === 200 || r.status === 429 });
  sleep(4);
}
