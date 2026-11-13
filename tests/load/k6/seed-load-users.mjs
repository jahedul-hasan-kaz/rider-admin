// Creates N driver and N passenger accounts in the Supabase project named by the environment and prints
// { drivers: [{email, token}], passengers: [{email, token}] } as JSON. Uses the secret key: run it from a trusted machine.
//   SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… SUPABASE_SECRET_KEY=… node tests/load/k6/seed-load-users.mjs 200 > tokens.json
const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY } = process.env;
const n = Number(process.argv[2] ?? 50);
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SECRET_KEY) {
  console.error("Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY.");
  process.exit(1);
}
const password = `Load-${Math.random().toString(36).slice(2)}-Test9!`;

async function user(kind, i) {
  const email = `load.${kind}.${Date.now()}.${i}@example.test`;
  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!created.ok) throw new Error(`create ${email}: ${created.status}`);
  const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await login.json();
  return { email, token: body.access_token };
}

const drivers = [];
const passengers = [];
for (let i = 0; i < n; i += 1) {
  drivers.push(await user("drv", i));
  passengers.push(await user("pax", i));
}
console.log(JSON.stringify({ drivers, passengers }));
console.error("These are plain users: onboard and approve the drivers (admin panel) before running ride-flow.js.");
