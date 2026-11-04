export const REQUEST_ID_HEADER = "x-request-id";

const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Accepts a well-formed incoming request id, otherwise generates a new one. */
export function resolveRequestId(incoming: string | null | undefined): string {
  if (incoming && VALID_REQUEST_ID.test(incoming)) return incoming;
  return crypto.randomUUID();
}
