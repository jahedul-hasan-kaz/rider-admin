import "server-only";
import pino from "pino";

// Never log PII or secrets (docs/spec/07-security.md §4).
const REDACT_PATHS = [
  "password",
  "*.password",
  "token",
  "*.token",
  "*.access_token",
  "*.refresh_token",
  "authorization",
  "*.authorization",
  "headers.authorization",
  "headers.cookie",
  "phone",
  "*.phone",
  "email",
  "*.email",
  "*.licence_number",
  "*.account_ref",
];

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "rider-admin" },
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  timestamp: pino.stdTimeFunctions.isoTime,
});
