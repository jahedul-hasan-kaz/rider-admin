import { ok } from "@/server/http/envelope";
import { apiRoute } from "@/server/http/handler";
import { getSharedTrip } from "@/server/services/trip-share";

// GET /api/v1/share/{token} — public, read-only view of a shared trip (gap B5). No sign-in: the unguessable token is
// the credential. Unknown or expired links answer 404 without saying which.
export const GET = apiRoute({ roles: ["public"] }, async ({ requestId, params }) => {
  const token = typeof params.token === "string" ? params.token : "";
  const data = await getSharedTrip(token);
  const response = ok(data, requestId);
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
});
