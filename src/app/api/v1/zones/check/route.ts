import { pointQuerySchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { fromZodError } from "@/server/http/errors";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// GET /api/v1/zones/check?lat=&lng= — is this point inside an active service zone?
export const GET = apiRoute(
  { roles: ["passenger", "driver", "user"], rateLimit: "read" },
  async ({ auth, requestId, request }) => {
    const query = pointQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) throw fromZodError(query.error);
    const data = await rpcOrThrow(
      auth.supabase.schema("api").rpc("check_zone", { p_lat: query.data.lat, p_lng: query.data.lng }),
    );
    return ok(data, requestId);
  },
);
