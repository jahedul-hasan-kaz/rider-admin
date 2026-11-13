import { pointQuerySchema } from "@/lib/schemas/api";
import { serverEnv } from "@/server/env";
import { ok } from "@/server/http/envelope";
import { fromZodError } from "@/server/http/errors";
import { apiRoute } from "@/server/http/handler";
import { reverseGeocode } from "@/server/services/places";

// GET /api/v1/places/reverse?lat=&lng= — the address at a point (pickup label, pinned destination). Gap B10.
export const GET = apiRoute({ roles: ["passenger"], rateLimit: "read" }, async ({ requestId, request }) => {
  const query = pointQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) throw fromZodError(query.error);
  const env = serverEnv();
  const data = await reverseGeocode(query.data, { provider: env.PLACES_PROVIDER, apiKey: env.PLACES_API_KEY ?? env.ROUTING_API_KEY });
  return ok(data, requestId);
});
