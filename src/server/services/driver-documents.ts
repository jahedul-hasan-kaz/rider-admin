import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError, fromPostgrestError } from "@/server/http/errors";
import { log } from "@/server/log";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";
import type { Database } from "@/types/database";

export const DOCUMENTS_BUCKET = "driver-documents";
export const SIGNED_READ_SECONDS = 60;

type Client = SupabaseClient<Database>;

/** Signed upload URL for a path the database already reserved for this driver. */
export async function createUploadUrl(driverClient: Client, path: string) {
  const { data, error } = await driverClient.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    log.error({ err: error }, "signed upload url failed");
    throw new AppError("UPSTREAM_UNAVAILABLE", "Could not prepare the upload. Try again.");
  }
  return { uploadUrl: data.signedUrl, token: data.token, path: data.path };
}

const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  "image/jpeg": (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP",
  "application/pdf": (b) => b.length > 5 && b.toString("ascii", 0, 5) === "%PDF-",
};

/** True when the file's first bytes match the declared type (the extension is never trusted). */
export function matchesContentType(bytes: Buffer, contentType: string): boolean {
  return SIGNATURES[contentType]?.(bytes) ?? false;
}

/**
 * Reads the uploaded object server-side, checks its real type by magic bytes and
 * computes the SHA-256 we store. Uses the secret key because drivers cannot read
 * their own uploads back (docs/spec/03-database.md §6).
 */
export async function verifyUploadedDocument(path: string, contentType: string, maxBytes: number) {
  const admin = createSupabaseAdminClient("storage.verify");
  const { data, error } = await admin.storage.from(DOCUMENTS_BUCKET).download(path);
  if (error || !data) throw new AppError("VALIDATION_FAILED", "Upload the file before completing.", {
    fields: [{ path: "file", message: "Upload the file before completing." }],
  });

  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length === 0 || bytes.length > maxBytes) {
    throw new AppError("VALIDATION_FAILED", undefined, { fields: [{ path: "file", message: "The file must be 10 MB or smaller." }] });
  }
  if (!matchesContentType(bytes, contentType)) {
    throw new AppError("VALIDATION_FAILED", undefined, {
      fields: [{ path: "file", message: "The file content doesn't match its type. Upload a real JPEG, PNG, WebP or PDF." }],
    });
  }
  return { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}

/** 60-second read URL, signed with the admin's own session (storage RLS: documents.view). */
export async function createReadUrl(adminSessionClient: Client, path: string) {
  const { data, error } = await adminSessionClient.storage.from(DOCUMENTS_BUCKET).createSignedUrl(path, SIGNED_READ_SECONDS);
  if (error || !data) {
    log.error({ err: error }, "signed read url failed");
    throw new AppError("UPSTREAM_UNAVAILABLE", "Could not open the document. Try again.");
  }
  return data.signedUrl;
}

/**
 * Staff upload a document for a driver: the database reserves the record (as the admin, with documents.manage), the
 * server stores the file and checks its real type, then the database completes it with the same rules as the app.
 */
export async function uploadDocumentForDriver(
  adminSession: Client,
  input: { driverId: string; documentType: string; vehicleId: string | null; documentNumber: string; issuedAt: string | null; expiresAt: string | null; reason: string },
  file: File,
  maxBytes: number,
) {
  const reserved = await adminSession.schema("api").rpc("admin_create_document", {
    p_driver_id: input.driverId,
    p_document_type: input.documentType as Database["public"]["Enums"]["document_type"],
    p_vehicle_id: input.vehicleId as string,
    p_content_type: file.type,
    p_size_bytes: file.size,
  });
  if (reserved.error) throw fromPostgrestError(reserved.error);
  const { document_id: documentId, storage_path: path } = reserved.data as { document_id: string; storage_path: string };

  const bytes = Buffer.from(await file.arrayBuffer());
  const up = await createSupabaseAdminClient("storage.verify").storage.from(DOCUMENTS_BUCKET).upload(path, bytes, { contentType: file.type, upsert: false });
  if (up.error) {
    log.error({ err: up.error.message }, "document upload failed");
    throw new AppError("UPSTREAM_UNAVAILABLE", "Could not store the file. Try again.");
  }
  const checked = await verifyUploadedDocument(path, file.type, maxBytes);
  const done = await adminSession.schema("api").rpc("admin_complete_document", {
    p_document_id: documentId,
    p_sha256: checked.sha256,
    p_size_bytes: checked.size,
    p_document_number: (input.documentNumber || null) as string,
    p_issued_at: input.issuedAt as string,
    p_expires_at: input.expiresAt as string,
    p_reason: input.reason,
  });
  if (done.error) throw fromPostgrestError(done.error);
  return { id: documentId };
}
