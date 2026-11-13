# Passenger sign-in: email code (default) and phone code (optional)

Passengers sign in with a 6-digit one-time code. **Email works out of the box**, so no SMS gateway is needed to launch.
Phone (SMS) sign-in is an optional extra you switch on once you have a gateway. Either way, a new address or number gets
a plain `user` account; the app turns it into a passenger with `POST /api/v1/onboarding/passenger`.

## Email code (default)

The app calls Supabase `signInWithOtp({ email })`; Supabase emails a 6-digit code, and the app verifies it.

- **Local:** codes land in Mailpit at http://127.0.0.1:54324. The template is `supabase/templates/sign_in_code.html`
  (English and Bengali), used for both new addresses (`confirmation`) and returning ones (`magic_link`).
- **Hosted project:**
  1. **Authentication → Sign In / Providers → Allow new users to sign up**: on. **Email** provider: on.
  2. **Authentication → Emails → SMTP**: use your own sender (e.g. Resend, already used for staff email —
     `docs/integrations/notifications.md`). Supabase's built-in sender is rate-limited to a few emails an hour and is
     for testing only.
  3. **Authentication → Emails → Templates**: paste `sign_in_code.html` into both **Confirm signup** and **Magic Link**,
     subject "Your sign-in code". The template must contain `{{ .Token }}` (the code), not a link.
  4. **Authentication → Attack Protection → CAPTCHA**: turn on hCaptcha or Turnstile before opening sign-up publicly.
  5. Keep the email OTP length at 6 and expiry at one hour (matches `config.toml`).

## Phone code (optional, needs an SMS gateway)

Off by default. To offer it:

1. Set up the gateway in Supabase (below).
2. Build the passenger app with `EXPO_PUBLIC_PHONE_SIGN_IN=true`. The app then starts with the phone screen and keeps
   "Use email instead" as a fallback; without it, the app goes straight to email.

### Phone: local development

1. In `supabase/config.toml`, set `[auth.sms.twilio] enabled = true`. The test numbers under `[auth.sms.test_otp]`
   (`+8801700000001`, `+8801700000002`, code `123456`) never send an SMS, so the Twilio values can be anything:
   ```bash
   export SUPABASE_AUTH_SMS_TWILIO_ACCOUNT_SID=ACtest SUPABASE_AUTH_SMS_TWILIO_MESSAGE_SERVICE_SID=MGtest SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN=test
   ```
2. Restart: `pnpm db:stop && pnpm db:start`.
3. In the passenger app, enter `17 0000 0001` and the code `123456`.

### Phone: hosted project (staging, production)

Settings in the Supabase dashboard are separate from `config.toml`:

1. **Authentication → Sign In / Providers → Allow new users to sign up**: on.
2. **Authentication → Sign In / Providers → Phone**: enable, choose the SMS provider and enter its credentials.
   Twilio's Bangladesh coverage is limited; a local gateway (SSL Wireless, Banglalink, Robi, GP) needs a registered
   sender ID and a contract. Supabase's built-in providers are Twilio, Twilio Verify, MessageBird, Textlocal and Vonage;
   another gateway can be connected with the **Send SMS** auth hook.
3. **Authentication → Attack Protection → CAPTCHA**: turn on hCaptcha or Turnstile before opening sign-up to the public.
4. **Authentication → Rate Limits**: keep SMS and verification limits low (defaults match `config.toml`).
5. Never configure test phone numbers on a hosted project.

## What sign-up allows

Turning sign-up on lets anyone create a `user` account, by phone or email. Such an account can do nothing until it
finishes passenger or driver onboarding. Admin access still comes only from an invitation
(`private.handle_new_auth_user`), and roles are never changed from the app.
