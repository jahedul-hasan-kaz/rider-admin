import "server-only";
import { z } from "zod";

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  SUPABASE_SECRET_KEY: z.string().min(20),
  SUPABASE_DB_URL: z.string().optional(),
  APP_BASE_URL: z.url(),
  ROUTING_PROVIDER: z.enum(["barikoi", "google", "haversine"]).default("haversine"),
  ROUTING_API_KEY: z.string().optional(),
  SENTRY_DSN: z.url().optional(),
  INTERNAL_JOBS_SECRET: z.string().min(32).optional(),
  INTERNAL_JOBS_ALLOWED_IPS: z.string().optional(),
  NOTIFY_EMAIL_PROVIDER: z.enum(["log", "resend", "mailpit"]).default("log"),
  NOTIFY_FROM: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  MAILPIT_URL: z.url().optional(),
  NOTIFY_SMS_PROVIDER: z.enum(["log", "twilio"]).default("log"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),
  NOTIFY_PUSH_PROVIDER: z.enum(["log", "webhook"]).default("log"),
  PUSH_WEBHOOK_URL: z.url().optional(),
  PUSH_WEBHOOK_TOKEN: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/** Validated server-only environment. Throws on first use if misconfigured. */
export function serverEnv(): ServerEnv {
  if (!cached) {
    // `KEY=` in an env file means "not set", not an empty value.
    const env = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
    const parsed = serverEnvSchema.safeParse(env);
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Invalid server environment: ${fields}`);
    }
    cached = parsed.data;
  }
  return cached;
}
