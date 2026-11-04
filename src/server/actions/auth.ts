"use server";

import type { AuthError } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { z } from "zod";
import { LOCALE_COOKIE, toLocale } from "@/i18n/request";
import { emailInput } from "@/lib/schemas/admins";
import { serverEnv } from "@/server/env";
import { log } from "@/server/log";
import { IDLE_COOKIE, safeNextPath } from "@/server/proxy/routes";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

// Messages are keys under the "auth" namespace; the client translates them.
export type AuthResult<T = { redirectTo: string }> = { ok: true; data: T } | { ok: false; messageKey: string };

const fail = (messageKey: string): AuthResult<never> => ({ ok: false, messageKey });

const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,72}$/;

const passwordPair = z
  .strictObject({ password: z.string().regex(PASSWORD_RULE), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"] });

function authErrorKey(error: AuthError): string {
  if (error.status === 429 || error.code === "over_request_rate_limit" || error.code === "over_email_send_rate_limit") {
    return "rateLimited";
  }
  if (error.code === "weak_password" || error.code === "same_password") return "passwordWeak";
  if (error.code === "reauthentication_needed") return "passwordReauth";
  if (error.code === "mfa_verification_failed" || error.code === "mfa_challenge_expired") return "mfaInvalid";
  if (error.code === "invalid_credentials" || error.status === 400) return "invalidCredentials";
  // Network failures and unexpected auth errors must not look like a wrong password.
  log.error({ code: error.code, status: error.status, name: error.name }, "auth request failed");
  return "unavailable";
}

async function recordAuthEvent(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  event: "sign_in" | "mfa_enrolled" | "mfa_removed" | "mfa_verified" | "mfa_failed" | "password_changed" | "sign_out",
) {
  const { error } = await supabase.schema("api").rpc("record_admin_auth_event", { p_event: event });
  if (error) log.warn({ err: error, event }, "auth event not recorded");
}

type AdminState = {
  role: string;
  status: string;
  must_change_password: boolean;
  /** The session already satisfies the two-factor rule (a verified code, or two-factor is off and not required). */
  mfa_satisfied: boolean;
  mfa_enabled: boolean;
  mfa_required: boolean;
};

async function adminState(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>): Promise<AdminState | null> {
  const { data } = await supabase.schema("api").rpc("my_admin_context");
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  return {
    role: String(d.role),
    status: String(d.status),
    must_change_password: d.must_change_password === true,
    mfa_satisfied: d.mfa_satisfied === true,
    mfa_enabled: d.mfa_enabled === true,
    mfa_required: d.mfa_required === true,
  };
}

const signInSchema = z.strictObject({
  email: emailInput,
  password: z.string().min(1).max(200),
  next: z.string().max(500).optional(),
});

/** Step 1: password. Non-admins and suspended admins are signed out immediately. */
export async function signIn(input: unknown): Promise<AuthResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) {
    log.warn({ issues: parsed.error.issues.map((i) => `${i.path.join(".")}:${i.code}`) }, "sign-in input rejected");
    return fail("invalidCredentials");
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return fail(authErrorKey(error));

  const state = await adminState(supabase);
  if (!state || state.role !== "admin") {
    await supabase.auth.signOut({ scope: "local" });
    return fail("forbidden");
  }
  if (state.status !== "active") {
    await supabase.auth.signOut({ scope: "local" });
    return fail("suspended");
  }

  await recordAuthEvent(supabase, "sign_in");
  const next = safeNextPath(parsed.data.next);
  // Two-factor is optional: people who have not turned it on go straight in; the code page is only for those who did
  // (or everyone, when the organisation requires it).
  if (state.mfa_satisfied) {
    return { ok: true, data: { redirectTo: state.must_change_password ? `/change-password?next=${encodeURIComponent(next)}` : next } };
  }
  return { ok: true, data: { redirectTo: `/mfa?next=${encodeURIComponent(next)}` } };
}

/** Clears the session everywhere on this device and returns to sign-in. */
export async function signOut(reason?: "idle"): Promise<AuthResult> {
  const supabase = await createSupabaseServerClient();
  await recordAuthEvent(supabase, "sign_out");
  await supabase.auth.signOut({ scope: "local" });
  (await cookies()).delete(IDLE_COOKIE);
  return { ok: true, data: { redirectTo: reason === "idle" ? "/login?reason=idle" : "/login?reason=signed_out" } };
}

export type MfaEnrollment = { factorId: string; qrCode: string; secret: string };

/** Starts TOTP enrolment. Stale unverified factors are removed first. */
export async function startMfaEnrollment(): Promise<AuthResult<MfaEnrollment>> {
  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return fail("linkExpired");

  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return fail(authErrorKey(listError));
  if (factors.totp.some((f) => f.status === "verified")) return fail("mfaInvalid");

  for (const factor of factors.all.filter((f) => f.factor_type === "totp" && f.status === "unverified")) {
    await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Rider Admin ${new Date().toISOString().slice(0, 10)}`,
    issuer: "Rider Admin",
  });
  if (error) return fail(authErrorKey(error));
  return { ok: true, data: { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret } };
}

const verifySchema = z.strictObject({
  factorId: z.string().min(1).max(100),
  code: z.string().regex(/^\d{6}$/),
  enrolling: z.boolean(),
  next: z.string().max(500).optional(),
});

/** Step 2: TOTP code. Upgrades the session to AAL2. */
export async function verifyMfa(input: unknown): Promise<AuthResult> {
  const parsed = verifySchema.safeParse(input);
  if (!parsed.success) return fail("mfaInvalid");

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });
  if (error) {
    await recordAuthEvent(supabase, "mfa_failed");
    return fail(authErrorKey(error));
  }

  await recordAuthEvent(supabase, parsed.data.enrolling ? "mfa_enrolled" : "mfa_verified");
  const state = await adminState(supabase);
  const next = safeNextPath(parsed.data.next);
  const redirectTo = state?.must_change_password ? `/change-password?next=${encodeURIComponent(next)}` : next;
  return { ok: true, data: { redirectTo } };
}

/** Changes the password of the signed-in (AAL2) admin. */
export async function changePassword(input: unknown): Promise<AuthResult> {
  const parsed = passwordPair.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues.some((i) => i.path[0] === "confirm") ? "passwordMismatch" : "passwordWeak");
  }

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return fail("passwordReauth");
  const state = await adminState(supabase);
  if (!state?.mfa_satisfied) return fail("passwordReauth");

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return fail(authErrorKey(error));

  await recordAuthEvent(supabase, "password_changed");
  return { ok: true, data: { redirectTo: "/dashboard" } };
}

/** Sets a password from an invitation or recovery link session, then requires MFA. */
export async function setNewPassword(input: unknown): Promise<AuthResult> {
  const parsed = passwordPair.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues.some((i) => i.path[0] === "confirm") ? "passwordMismatch" : "passwordWeak");
  }

  const supabase = await createSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) return fail("linkExpired");

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return fail(authErrorKey(error));

  const state = await adminState(supabase);
  if (!state || state.role !== "admin" || state.status !== "active") {
    await supabase.auth.signOut({ scope: "local" });
    return fail(state?.status === "suspended" ? "suspended" : "forbidden");
  }

  await recordAuthEvent(supabase, "password_changed");
  // An invitation or recovery link signs the person in: without two-factor that is a full sign-in.
  await recordAuthEvent(supabase, "sign_in");
  // /mfa sends people without two-factor straight on (unless it is required), and asks the others for their code.
  return { ok: true, data: { redirectTo: "/mfa" } };
}

const resetSchema = z.strictObject({ email: emailInput });

/** Always reports success so the form can't be used to discover accounts. */
export async function requestPasswordReset(input: unknown): Promise<AuthResult<null>> {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) return { ok: true, data: null };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${serverEnv().APP_BASE_URL}/auth/confirm?next=/reset-password`,
  });
  if (error && (error.status === 429 || error.code?.startsWith("over_"))) return fail("rateLimited");
  if (error) log.warn({ err: error }, "password reset request failed");
  return { ok: true, data: null };
}

export async function setLocale(locale: string): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, toLocale(locale), {
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV !== "development",
    maxAge: 60 * 60 * 24 * 365,
  });
}

const disableSchema = z.strictObject({ code: z.string().regex(/^\d{6}$/) });

/**
 * Turns two-factor off for the signed-in admin (Profile). A fresh code is required, so a walk-up session cannot remove
 * it, and it is refused while the organisation requires two-factor (feature flag `require_admin_mfa`).
 */
export async function disableMfa(input: unknown): Promise<AuthResult<{ done: true }>> {
  const parsed = disableSchema.safeParse(input);
  if (!parsed.success) return fail("mfaInvalid");

  const supabase = await createSupabaseServerClient();
  const state = await adminState(supabase);
  if (!state || state.role !== "admin" || state.status !== "active" || !state.mfa_satisfied) return fail("forbidden");
  if (state.mfa_required) return fail("mfaRequiredByPolicy");

  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return fail(authErrorKey(listError));
  const verified = factors.totp.filter((f) => f.status === "verified");
  if (verified.length === 0) return { ok: true, data: { done: true } };

  const check = await supabase.auth.mfa.challengeAndVerify({ factorId: verified[0]!.id, code: parsed.data.code });
  if (check.error) {
    await recordAuthEvent(supabase, "mfa_failed");
    return fail(authErrorKey(check.error));
  }
  for (const factor of factors.all.filter((f) => f.factor_type === "totp")) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (error) return fail(authErrorKey(error));
  }
  await recordAuthEvent(supabase, "mfa_removed");
  return { ok: true, data: { done: true } };
}
