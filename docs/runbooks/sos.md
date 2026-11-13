# Runbook: SOS and safety incidents

**You find out by:** the red banner on the Safety page (checked every 5 s, optional sound), a notification to everyone
holding `safety.view`, and the `sos_unacked` alert if nobody acknowledged it within 2 minutes (setting
`alerts.sos_unacked_s`).

## First ten minutes

1. **Open the incident** (Safety → the SOS row). Note the trip, the reporter's role, the last known location and the
   note they sent. Viewing the location is logged.
2. **Acknowledge it now** ("Acknowledge" + a note such as "Calling the driver"). This stops the response clock; do it
   before you investigate, not after.
3. **Call the reporter, then the other party**, using the phone numbers on the passenger or driver pages (reveal needs a
   reason and is logged).
4. If anyone may be in danger: call the police (999) and give them the location from the incident and the vehicle
   registration from the trip. Record who you called under **Escalate** (the "Escalated to" field).
5. Keep notes on every step. The system will not let you move an incident forward without one.

## Closing it

- **Resolve** with a plain description of what happened and what was done.
- If the trip is still running and unsafe, an admin with `trips.cancel` can end it from the trip page.
- If the driver should not take more rides, an admin with `drivers.suspend` suspends them (reason required).
- **Close** only when follow-up is finished. A resolved incident can be reopened.

## Confirm it is fixed

- The `sos_unacked` alert clears by itself once the incident is acknowledged.
- Safety page → Resolved tab shows the incident with its timeline and time-to-acknowledge.

## Notifications and evidence

- Everyone holding `safety.view` is also emailed, texted (if their profile has a phone) and pushed (if they registered a device) the
  moment an SOS is raised. Check Settings → Delivery if you suspect messages are not arriving: it shows failures with reasons.
  Make sure every on-call person has a phone number on their profile and the provider keys are configured
  (`NOTIFY_SMS_PROVIDER`, `NOTIFY_EMAIL_PROVIDER`, `NOTIFY_PUSH_PROVIDER`; the default `log` provider sends nothing).
- Photos, PDFs, audio and video can be attached to the incident by the reporter or by you (incident page → Evidence). Opening a file is
  logged and needs `safety.view_evidence`.
