# Scheduler for the background job

One endpoint does all the work that has to happen outside the database:

```
POST {APP_BASE_URL}/api/internal/jobs/notify
Authorization: Bearer {INTERNAL_JOBS_SECRET}
```

Each call, in this order:

1. sends up to 20 queued email, SMS and push messages (with back-off and give-up after five attempts),
2. removes files from Storage that belong to anonymised accounts,
3. moves finished CSV exports into the private `exports` bucket,
4. exports archived partitions to the `archive` bucket as gzip files with a checksum.

Everything is safe to run twice at once (rows are claimed with locks) and each part is isolated: if one fails, the rest still
run and the failure is logged. Housekeeping that lives in the database (rollups, surge, expiry, anonymisation, partition
maintenance) is run by `pg_cron` and needs nothing from you.

## What you provide

| Variable | Notes |
|---|---|
| `INTERNAL_JOBS_SECRET` | A long random string (32+ bytes). Compared in constant time. Without it the endpoint refuses everything. |
| `APP_BASE_URL` | The public URL of the deployed app. Used for links inside messages. |
| `INTERNAL_JOBS_ALLOWED_IPS` | Optional. Comma-separated caller IPs. Leave empty if your scheduler has no fixed IP. |

Generate a secret: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

## Choosing a scheduler

Pick whichever you already have. The call must happen **every minute** for the one-minute promises (export ready, a message
within a minute) to hold; every five minutes also works, just slower.

| Option | Cost | Notes |
|---|---|---|
| **Supabase `pg_cron` + `pg_net`** | Free | Keeps it all in one place. Enable the `pg_net` extension, store the secret in Vault, then `select cron.schedule('call-jobs', '* * * * *', $$select net.http_post(url := 'https://YOUR-APP/api/internal/jobs/notify', headers := jsonb_build_object('Authorization', 'Bearer ' \|\| (select decrypted_secret from vault.decrypted_secrets where name = 'internal_jobs_secret')))$$);` |
| **Vercel Cron** | Free tier runs once a day only; per-minute needs a paid plan | Add a `crons` entry; Vercel sends a `GET`, so this endpoint would need a small `GET` wrapper. Ask us to add it if you choose this. |
| **GitHub Actions** | Free | A workflow on `schedule:` with `curl -X POST ...`; the shortest interval is 5 minutes and runs can be delayed. Fine for staging. |
| **cron-job.org or similar** | Free | One HTTP job, every minute, with the bearer header. Easiest to start with. |

## Checking it works

```bash
curl -s -X POST "$APP_BASE_URL/api/internal/jobs/notify" -H "Authorization: Bearer $INTERNAL_JOBS_SECRET"
```

You should get `{"claimed":0,"sent":0,"failed":0,"purged":0,"uploaded":0,"archived":0}` (the numbers are work done). A `401`
means the secret is wrong; a `403` means the caller's IP is not on the allow-list. Then open **Settings → Delivery**
(delivery overview) to see messages move from queued to sent.
