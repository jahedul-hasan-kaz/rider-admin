import { NextResponse } from "next/server";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { uploadDocumentSchema } from "@/lib/schemas/admin-crud";
import { getAdminContext } from "@/server/auth/context";
import { AppError, fromZodError } from "@/server/http/errors";
import { log } from "@/server/log";
import { uploadDocumentForDriver } from "@/server/services/driver-documents";

const MAX_BYTES = 10 * 1024 * 1024;

// POST /api/admin/documents — staff upload a driver document (multipart: the fields below plus `file`). A route rather
// than a Server Action because files are larger than the Server Action body limit. Permission, validation and the
// audit entry are enforced by the database functions it calls, as the signed-in admin.
export async function POST(request: Request) {
  // getAdminContext() redirects to sign-in when the session has expired; a fetch() caller needs JSON instead.
  let ctx: Awaited<ReturnType<typeof getAdminContext>>;
  try {
    ctx = await getAdminContext();
  } catch (error) {
    if (isRedirectError(error)) {
      return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED", message: "Your session has ended. Sign in again.", details: {} } }, { status: 401 });
    }
    throw error;
  }
  try {
    if (!ctx.permissions.has("documents.manage")) throw new AppError("FORBIDDEN");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new AppError("VALIDATION_FAILED", undefined, { fields: [{ path: "file", message: "Choose a file to upload." }] });
    }
    if (file.size > MAX_BYTES) {
      throw new AppError("VALIDATION_FAILED", undefined, { fields: [{ path: "file", message: "The file must be 10 MB or smaller." }] });
    }
    const field = (k: string) => String(form.get(k) ?? "");
    const parsed = uploadDocumentSchema.safeParse({
      driverId: field("driverId"),
      documentType: field("documentType"),
      vehicleId: field("vehicleId"),
      documentNumber: field("documentNumber"),
      issuedAt: field("issuedAt"),
      expiresAt: field("expiresAt"),
      reason: field("reason"),
    });
    if (!parsed.success) throw fromZodError(parsed.error);
    const data = await uploadDocumentForDriver(ctx.supabase, parsed.data, file, MAX_BYTES);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const err = error instanceof AppError ? error : new AppError("INTERNAL");
    if (err.code === "INTERNAL") log.error({ err: error }, "staff document upload failed");
    return NextResponse.json({ ok: false, error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
}
