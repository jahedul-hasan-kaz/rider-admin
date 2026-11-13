// Passengers request rides continuously; drivers poll for offers and take them through to completion.
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";

const users = new SharedArray("users", () => [JSON.parse(open(__ENV.TOKENS))]);
const base = __ENV.BASE_URL || "http://localhost:3000";
const CATEGORY = __ENV.CATEGORY_ID;

export const options = {
  scenarios: {
    passengers: { executor: "constant-vus", vus: Number(__ENV.PASSENGERS || 50), duration: __ENV.DURATION || "3m", exec: "passenger" },
    drivers: { executor: "constant-vus", vus: Number(__ENV.DRIVERS || 50), duration: __ENV.DURATION || "3m", exec: "driver" },
  },
  thresholds: { http_req_duration: ["p(95)<400"] },
};

const headers = (token) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() });
const pt = (lat, lng, label) => ({ lat, lng, label });

export function passenger() {
  const all = users[0].passengers;
  const p = all[(__VU - 1) % all.length];
  const lat = 23.8 + Math.random() * 0.05;
  const lng = 90.4 + Math.random() * 0.05;
  const quote = http.post(
    `${base}/api/v1/quotes`,
    JSON.stringify({ category_id: CATEGORY, pickup: pt(lat, lng, "A"), destination: pt(lat + 0.03, lng + 0.03, "B") }),
    { headers: headers(p.token) },
  );
  if (!check(quote, { "quote created": (r) => r.status === 201 })) {
    sleep(2);
    return;
  }
  const ride = http.post(`${base}/api/v1/rides`, JSON.stringify({ quote_id: quote.json("data.id"), payment_method: "cash" }), { headers: headers(p.token) });
  check(ride, { "ride requested": (r) => r.status === 201 || r.status === 409 });
  sleep(30);
}

export function driver() {
  const all = users[0].drivers;
  const d = all[(__VU - 1) % all.length];
  const offer = http.get(`${base}/api/v1/driver/offers/current`, { headers: headers(d.token) });
  const id = offer.json("data.offer_id");
  if (!id) {
    sleep(2);
    return;
  }
  const accepted = http.post(`${base}/api/v1/driver/offers/${id}/accept`, "{}", { headers: headers(d.token) });
  if (accepted.status !== 200) {
    sleep(1);
    return;
  }
  const trip = accepted.json("data.id");
  for (const step of ["arriving", "arrived", "start"]) {
    http.post(`${base}/api/v1/driver/trips/${trip}/${step}`, step === "arrived" ? JSON.stringify({ override: true }) : "{}", { headers: headers(d.token) });
  }
  sleep(5);
  http.post(`${base}/api/v1/driver/trips/${trip}/complete`, "{}", { headers: headers(d.token) });
  http.post(`${base}/api/v1/driver/trips/${trip}/cash-collected`, "{}", { headers: headers(d.token) });
}
