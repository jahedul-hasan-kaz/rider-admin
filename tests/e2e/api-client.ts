import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

// Minimal driver-app client for E2E: real auth tokens, real REST calls, real Storage uploads.

type LocalStack = { API_URL: string; PUBLISHABLE_KEY: string; SECRET_KEY: string };
let stack: LocalStack | undefined;

export function localStack(): LocalStack {
  stack ??= JSON.parse(execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], { encoding: "utf8", shell: true }));
  return stack!;
}

/** Creates a confirmed auth user (local only) and returns an access token for it. */
export async function createAppUser(email: string, password: string): Promise<string> {
  const s = localStack();
  const created = await fetch(`${s.API_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: s.SECRET_KEY, Authorization: `Bearer ${s.SECRET_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, phone: `+8801${Math.floor(700000000 + Math.random() * 99999999)}` }),
  });
  if (!created.ok) throw new Error(`create user failed: ${created.status} ${await created.text()}`);
  return signInAppUser(email, password);
}

export async function signInAppUser(email: string, password: string): Promise<string> {
  const s = localStack();
  const res = await fetch(`${s.API_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: s.PUBLISHABLE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in failed: ${JSON.stringify(body)}`);
  return body.access_token as string;
}

export type ApiResponse = { status: number; body: { data?: Record<string, unknown>; error?: { code: string } } };

export function apiClient(baseURL: string, token: string) {
  async function call(method: string, path: string, body?: unknown, idempotencyKey: string = randomUUID()): Promise<ApiResponse> {
    const res = await fetch(new URL(`/api/v1${path}`, baseURL), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(method === "GET" ? {} : { "Idempotency-Key": idempotencyKey }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }
  return {
    get: (path: string) => call("GET", path),
    post: (path: string, body?: unknown, key?: string) => call("POST", path, body ?? {}, key),
    patch: (path: string, body: unknown) => call("PATCH", path, body),
    put: (path: string, body: unknown, key?: string) => call("PUT", path, body, key),
    delete: (path: string, body?: unknown, key?: string) => call("DELETE", path, body ?? {}, key),
  };
}

/** A tiny but real JPEG (valid SOI/JFIF header) for document uploads. */
export const TINY_JPEG = Buffer.from(
  "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffda0008010100003f00d2cf20ffd9",
  "hex",
);

/** Upload-url → PUT bytes → complete, exactly as the driver app will. */
export async function uploadDocument(
  api: ReturnType<typeof apiClient>,
  input: { document_type: string; vehicle_id?: string; document_number?: string; expires_at?: string },
  bytes: Buffer = TINY_JPEG,
) {
  const reserved = await api.post("/driver/documents/upload-url", {
    document_type: input.document_type,
    ...(input.vehicle_id ? { vehicle_id: input.vehicle_id } : {}),
    content_type: "image/jpeg",
    size: bytes.length,
  });
  if (reserved.status !== 201) throw new Error(`upload-url ${reserved.status}: ${JSON.stringify(reserved.body)}`);
  const { upload_url, document_id } = reserved.body.data as { upload_url: string; document_id: string };

  const put = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg", "x-upsert": "false" },
    body: new Uint8Array(bytes),
  });
  if (!put.ok) throw new Error(`storage upload ${put.status}: ${await put.text()}`);

  return api.post(`/driver/documents/${document_id}/complete`, {
    ...(input.document_number ? { document_number: input.document_number } : {}),
    ...(input.expires_at ? { expires_at: input.expires_at } : {}),
  });
}
