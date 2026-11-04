import "server-only";
import { z } from "zod";
import { publicEnv } from "@/lib/env.public";
import { log } from "@/server/log";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";

// Delivers the notification outbox (docs/spec/04 §13, §14). The database queues; this worker sends and reports back.
// Providers are plain HTTPS calls (no SDKs) and every channel has a "log" provider that sends nothing, which is the
// default so a fresh environment never messages anyone by accident.

export type OutboxMessage = {
  id: string;
  channel: "email" | "sms" | "push";
  to: string | null;
  subject: string;
  body: string;
  link: string | null;
  attempts: number;
  tokens: string[] | null;
};

const claimSchema = z.array(
  z.object({
    id: z.uuid(),
    channel: z.enum(["email", "sms", "push"]),
    to: z.string().nullable(),
    subject: z.string(),
    body: z.string(),
    link: z.string().nullable(),
    attempts: z.number(),
    tokens: z.array(z.string()).nullable(),
  }),
);

type Env = Record<string, string | undefined>;
const timeout = () => AbortSignal.timeout(8000);

async function expectOk(res: Response, what: string) {
  if (!res.ok) throw new Error(`${what} responded ${res.status}`);
}

async function sendEmail(m: OutboxMessage, env: Env) {
  if (!m.to) throw new Error("no email address");
  const from = env.NOTIFY_FROM ?? "Rider Admin <no-reply@localhost>";
  const link = m.link ? `\n\n${publicEnv.NEXT_PUBLIC_APP_ENV === "production" ? "" : ""}${env.APP_BASE_URL ?? ""}${m.link}` : "";
  const text = `${m.body}${link}`;
  const provider = env.NOTIFY_EMAIL_PROVIDER ?? "log";
  if (provider === "resend") {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [m.to], subject: m.subject, text }),
      signal: timeout(),
    });
    return expectOk(res, "Resend");
  }
  if (provider === "mailpit") {
    // Local development: Mailpit's HTTP API catches the message so nothing leaves the machine.
    const res = await fetch(`${env.MAILPIT_URL ?? "http://127.0.0.1:54324"}/api/v1/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ From: { Email: "no-reply@localhost", Name: "Rider Admin" }, To: [{ Email: m.to }], Subject: m.subject, Text: text }),
      signal: timeout(),
    });
    return expectOk(res, "Mailpit");
  }
  log.info({ channel: "email", id: m.id, subject: m.subject }, "notification (log provider)");
}

async function sendSms(m: OutboxMessage, env: Env) {
  if (!m.to) throw new Error("no phone number");
  const provider = env.NOTIFY_SMS_PROVIDER ?? "log";
  if (provider === "twilio") {
    const sid = env.TWILIO_ACCOUNT_SID;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: m.to, From: env.TWILIO_FROM ?? "", Body: `${m.subject}: ${m.body}`.slice(0, 600) }),
      signal: timeout(),
    });
    return expectOk(res, "Twilio");
  }
  log.info({ channel: "sms", id: m.id }, "notification (log provider)");
}

async function sendPush(m: OutboxMessage, env: Env) {
  const tokens = m.tokens ?? [];
  if (tokens.length === 0) throw new Error("no device tokens");
  const provider = env.NOTIFY_PUSH_PROVIDER ?? "log";
  if (provider === "webhook") {
    // A small relay you run next to FCM/APNs: it receives the tokens and the message and does the platform-specific part.
    const res = await fetch(env.PUSH_WEBHOOK_URL ?? "", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.PUSH_WEBHOOK_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ tokens, title: m.subject, body: m.body, link: m.link }),
      signal: timeout(),
    });
    return expectOk(res, "Push relay");
  }
  log.info({ channel: "push", id: m.id, devices: tokens.length }, "notification (log provider)");
}

const SENDERS = { email: sendEmail, sms: sendSms, push: sendPush } as const;

/** Claims up to `limit` queued messages, sends them, and records each outcome. Safe to run concurrently. */
export async function runNotifyJob(limit = 20, env: Env = process.env): Promise<{ claimed: number; sent: number; failed: number }> {
  const admin = createSupabaseAdminClient("job.run");
  const { data, error } = await admin.schema("api").rpc("claim_notifications", { p_limit: limit });
  if (error) {
    log.error({ err: error }, "claiming notifications failed");
    throw new Error("claim failed");
  }
  const messages = claimSchema.parse(data);
  let sent = 0;
  let failed = 0;
  await Promise.all(
    messages.map(async (m) => {
      try {
        await SENDERS[m.channel](m, env);
        await admin.schema("api").rpc("finish_notification", { p_id: m.id, p_ok: true });
        sent += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : "send failed";
        log.warn({ id: m.id, channel: m.channel, attempts: m.attempts, err: message }, "notification delivery failed");
        await admin.schema("api").rpc("finish_notification", { p_id: m.id, p_ok: false, p_error: message });
        failed += 1;
      }
    }),
  );
  return { claimed: messages.length, sent, failed };
}
