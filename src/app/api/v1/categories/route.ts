import { optionalPointQuerySchema } from "@/lib/schemas/api";
import { ok } from "@/server/http/envelope";
import { AppError, fromZodError } from "@/server/http/errors";
import { apiRoute, rpcOrThrow } from "@/server/http/handler";

// GET /api/v1/categories?lat=&lng= — active ride categories (422 outside service areas).
export const GET = apiRoute(
  { roles: ["passenger", "driver", "user"], rateLimit: "read" },
  async ({ auth, requestId, request }) => {
    const query = optionalPointQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) throw fromZodError(query.error);
    const data = await rpcOrThrow(
      auth.supabase.schema("api").rpc("list_active_categories", { p_lat: query.data.lat, p_lng: query.data.lng }),
    );
    if (!Array.isArray(data)) throw new AppError("INTERNAL");
    const response = ok(data, requestId);
    response.headers.set("Cache-Control", "private, max-age=60");
    return response;
  },
);
