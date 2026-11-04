# Email, SMS and push

Messages (staff invitations, SOS alerts, ticket updates, ride events) are written to a queue in the database first, so
nothing is lost if a provider is down. The scheduler ([scheduler.md](scheduler.md)) delivers them. The default provider for
every channel is `log`, which only writes a line to the server log; that is what staging uses until you set these.

## Email: Resend (built)

1. Create an account at resend.com, add and verify your sending domain (DNS records: SPF, DKIM).
2. Create an API key with "sending access".
3. Set:

```
NOTIFY_EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
NOTIFY_FROM=Rider Admin <no-reply@your-domain>
```

To use another email service, the adapter is one small function (`sendEmail` in `src/server/services/notify.ts`): tell us which.
Supabase Auth's own emails (password reset, invitations) are separate: configure custom SMTP in the Supabase dashboard
(Authentication → SMTP) with the same Resend credentials so those come from your domain too.

## SMS: Twilio (built)

```
NOTIFY_SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM=+1...   # or a Messaging Service sender
```

Bangladesh note: Twilio's reach and sender-ID rules there are limited. Local gateways (SSL Wireless, Banglalink, Robi,
GP) usually need a registered sender ID (mask) and a contract, which takes days. If you pick one, send us its HTTP API
document; it is the same shape as the Twilio adapter (one `fetch` call) and will take under an hour.

Phone numbers are stored in international format (`+8801...`); the adapter sends them as they are.

## Push: webhook relay (built), FCM/APNs direct (not built)

Push needs the mobile apps, which are out of scope here. The backend already stores device tokens
(`PUT /api/v1/me/devices`) and queues push messages. Delivery is a webhook so the platform-specific part stays outside this app:

```
NOTIFY_PUSH_PROVIDER=webhook
PUSH_WEBHOOK_URL=https://your-relay.example/send
PUSH_WEBHOOK_TOKEN=...
```

The relay receives `POST { tokens: string[], title, body, link }` with `Authorization: Bearer <token>` and must answer
`2xx` when the message is accepted. Anything else is retried with back-off. A relay can be a 30-line function on any host
that calls Firebase Cloud Messaging (HTTP v1) with a service-account key. When the mobile apps exist we can replace the relay
with a direct FCM adapter inside `sendPush`; that needs the Firebase project and its service-account JSON, and for iOS an
APNs key uploaded to Firebase.

## Checking it

1. Set the provider variables on the server and restart.
2. Invite a staff member to your own address (Admins → Invite): the email should arrive within a minute of the next
   scheduler call.
3. Settings → Delivery shows sent and failed counts, and the last failure reasons.
4. A message that fails five times is marked failed and stays visible there; it is never silently dropped.
