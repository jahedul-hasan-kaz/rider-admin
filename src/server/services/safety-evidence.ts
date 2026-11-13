import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { matchesContentType } from "@/server/services/driver-documents";
import { AppError } from "@/server/http/errors";
import { log } from "@/server/log";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";
import type { Database } from "@/types/database";

export const EVIDENCE_BUCKET = "safety-evidence";
export const EVIDENCE_MAX_BYTES = 15 * 1024 * 1024;
export const EVIDENCE_SIGNED_READ_SECONDS = 60;
export const EVIDENCE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf", "audio/mp4", "video/mp4"] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

type Client = SupabaseClient<Database>;

/** MP4 family files (audio and video) start with a size field then the "ftyp" box. */
function isMp4(bytes: Buffer) {
  return bytes.length > 12 && bytes.toString("ascii", 4, 8) === "ftyp";
}

export function evidenceMatchesType(bytes: Buffer, contentType: string): boolean {
  return contentType === "audio/mp4" || contentType === "video/mp4" ? isMp4(bytes) : matchesContentType(bytes, contentType);
}

/** Signed upload URL for a path the database reserved for this caller (storage RLS lets only the reporter or a safety manager write it). */
export async function createEvidenceUploadUrl(client: Client, path: string) {
  const { data, error } = await client.storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    log.error({ err: error }, "evidence signed upload url failed");
    throw new AppError("UPSTREAM_UNAVAILABLE", "Could not prepare the upload. Try again.");
  }
  return { uploadUrl: data.signedUrl, token: data.token, path: data.path };
}

/** Reads the uploaded object server-side, checks its real type by magic bytes and computes the SHA-256 that is stored. */
export async function verifyEvidence(path: string, contentType: string) {
  const admin = createSupabaseAdminClient("storage.verify");
  const { data, error } = await admin.storage.from(EVIDENCE_BUCKET).download(path);
  if (error || !data) {
    throw new AppError("VALIDATION_FAILED", undefined, { fields: [{ path: "file", message: "Upload the file before completing." }] });
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length === 0 || bytes.length > EVIDENCE_MAX_BYTES) {
    throw new AppError("VALIDATION_FAILED", undefined, { fields: [{ path: "file", message: "The file must be 15 MB or smaller." }] });
  }
  if (!evidenceMatchesType(bytes, contentType)) {
    throw new AppError("VALIDATION_FAILED", undefined, { fields: [{ path: "file", message: "The file content doesn't match its type." }] });
  }
  return { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
}

/** 60-second read URL, signed with the admin's own session (storage RLS: safety.view_evidence). */
export async function signedEvidenceUrl(client: Client, path: string) {
  const { data, error } = await client.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, EVIDENCE_SIGNED_READ_SECONDS);
  if (error || !data) throw new AppError("UPSTREAM_UNAVAILABLE", "Could not open the file.");
  return data.signedUrl;
}
