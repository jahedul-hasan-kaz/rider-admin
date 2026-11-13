# Rider platform workflow
## Passenger journey
### P1. Enable current location [partly built]
- What happens
  - The app asks for location permission and reads the phone's GPS. The backend checks the point is inside a service area.
- API call
  - GET /zones/check?lat={lat}&lng={lng}
- Rules
  - Rides can only start inside an active service zone (Gulshan & Banani, Dhanmondi, Uttara, Mirpur, Motijheel in the demo data).
- Note
  - The zone check is built. Reading GPS is a mobile-app job (app not built).
### P2. Choose pickup and destination [partly built]
- What happens
  - Pickup defaults to the current location. The passenger picks or types the destination. A place copied from Google Maps (e.g. '23.7806, 90.4074') is turned into latitude and longitude by the app.
- API call
  - No call yet: the points are sent with the quote in P3.
- Rules
  - Each point is latitude, longitude and an optional name (up to 200 characters).
  - The pickup must be inside a service zone; the destination may be outside it.
- Note
  - The API takes coordinates and names. Pasting 'lat, lng' is supported in the admin 'Book a ride' drawer today. Reading a full Google Maps share link (https://maps.app.goo.gl/...) and place search need the app plus a geocoding provider (Google Places or Barikoi), not built.
### P3. Search: see the fare and the drivers nearby [partly built]
- What happens
  - The passenger picks a vehicle type (Bike, Car, CNG). The system calculates the route distance and time, prices the ride from the live fare rule (including any surge) and counts the available drivers nearby.
- API call
  - POST /quotes  { category_id, pickup: {lat, lng, label}, destination: {lat, lng, label} }
- Returns
  - quote id
  - estimated fare and its breakdown
  - surge multiplier
  - number of available drivers nearby
  - quote expiry time
- Rules
  - The fare is frozen in the quote: the passenger pays what they were shown (plus waiting time or a changed route).
  - Distance and time come from Google Routes when configured, otherwise from an estimate.
- Note
  - Built: fare, surge and the COUNT of nearby drivers. Not built: showing each nearby driver on the passenger's map (needs a privacy-safe 'nearby drivers' endpoint that returns approximate positions only).
### P4. Request the ride [built]
- What happens
  - The passenger confirms the quote, chooses cash and can add a pickup note or a promo code. The request goes to dispatch.
- API call
  - POST /rides  { quote_id, payment_method: 'cash', pickup_note }   then optionally  POST /rides/{id}/promo  { code }
- Rules
  - ONE active request per passenger: a second request is refused until the first is cancelled, completed or expired.
  - Only cash is enabled (setting payments.enabled_methods). Digital payments are not built.
### P5. Driver matching [built]
- What happens
  - Dispatch offers the ride to the NEAREST free driver with the right vehicle type. That driver has 15 seconds to accept. If they decline or don't answer, the next nearest driver gets the offer. The search widens from 1.5 km to 3 km to 5 km. With nobody after 3 minutes the request closes as 'no driver found'.
- API call
  - GET /rides/{id}  (passenger watches the status: searching → matched)
- Rules
  - A ride is offered to one driver at a time; a driver gets one offer at a time.
  - Only approved, online drivers with a fresh location and an active vehicle of that type are offered rides.
  - Staff can re-dispatch, assign a specific driver or cancel from the admin panel (Ride requests).
- Who picks whom
  - Driver picks passenger: Built: the driver sees the offer (pickup, destination, fare, distance) and accepts or declines it (see D4).
  - Passenger picks driver: Not built. Today the system picks the nearest driver automatically, which is faster and fairer. If you want passengers to choose, the change is: show 3–5 nearby drivers with name, rating, vehicle and ETA after the quote, the passenger taps one, and that driver alone gets the offer (if they decline or time out, the passenger chooses again). The one-active-request and one-offer-per-driver locks stay the same.
### P6. Driver assigned: track the driver [built]
- What happens
  - The passenger sees the driver's name, rating, vehicle and plate, and follows the driver's progress: on the way → arrived.
- API call
  - GET /rides/{id}   (realtime channel 'ride:{id}' also announces each status change)
- Rules
  - If the pickup PIN feature flag is on, the passenger reads a 4-digit PIN to the driver at pickup (GET /rides/{id}/pin).
### P7. Cancel (the standard way) [built]
- What happens
  - Before the ride starts the passenger can cancel. The app first shows whether a fee applies, then cancels with a reason.
- API call
  - GET /rides/{id}/cancel-preview   then   POST /rides/{id}/cancel  { reason }
- Rules
  - Free while searching, and within 2 minutes of a driver being assigned.
  - Later, a cancellation fee applies (Bike 30, Car 50, CNG 40 in the demo fare rules). It is added to the passenger's next ride; the driver receives it minus the platform commission.
  - A ride that has started cannot be cancelled by the passenger.
  - After cancelling, the passenger is free to request again.
### P8. Ride in progress and completed [built]
- What happens
  - The driver starts the trip at pickup and completes it at the destination. The final fare is calculated from the frozen fare rule and the recorded route, time and waiting.
- API call
  - GET /rides/{id}   then   GET /trips/{id}/receipt
- Rules
  - SOS is available throughout the ride: POST /trips/{id}/sos alerts the safety team at once (with evidence upload).
### P9. Pay the driver [built]
- What happens
  - The passenger pays the final fare in cash to the driver (fare minus any promo discount, plus any cancellation fee owed from earlier).
- API call
  - GET /trips/{id}/receipt  (shows the amount to pay)
- Rules
  - The driver confirms the cash in their app (D7). Unconfirmed cash is flagged to finance after 24 hours.
- Note
  - bKash / Nagad / card payment is not built (needs merchant accounts); see docs/integrations/digital-payments.md.
### P10. Rate and review the driver [built]
- What happens
  - The passenger gives 1–5 stars and an optional comment. The driver can rate the passenger the same way.
- API call
  - POST /trips/{id}/rate  { score: 1-5, comment }
- Rules
  - Once per trip, within 7 days of completion (setting ratings.window_days).
  - Ratings feed the driver's average rating. Staff can hide abusive comments (Ratings page, with a reason).
### P11. Help after the ride [built]
- What happens
  - Lost item, overcharge or complaint: the passenger opens a support ticket. Staff can refund (approved by finance).
- API call
  - POST /support/tickets  { tripId, category, subject, body }
## Driver journey
### D1. Sign up and onboard [built]
- What happens
  - The driver creates an account, fills in details, adds a vehicle and uploads documents (NID, driving licence, profile photo, registration, fitness, tax token, insurance; route permit for CNG), then submits the application.
- API call
  - POST /onboarding/driver → PATCH /driver/details → POST /driver/vehicles → POST /driver/documents/upload-url + POST /driver/documents/{id}/complete → POST /driver/application/submit
### D2. Approval by the organisation [built]
- What happens
  - Operations reviews each document (approve or reject with a reason), verifies the vehicle and approves the driver. Staff can also create the driver and upload documents for them.
- Where in the admin panel
  - Admin panel → Drivers → Review application; Documents queue
- Rules
  - Expired documents suspend the driver automatically until renewed.
### D3. Go online [built]
- What happens
  - The driver goes online. The app sends the driver's location every few seconds so dispatch knows who is nearby.
- API call
  - POST /driver/availability  { online: true, lat, lng }   then   POST /driver/location  (batched points)
- Rules
  - A driver whose location stops updating for 2 minutes is taken offline automatically.
### D4. Pick a passenger (accept an offer) [built]
- What happens
  - The driver gets an offer showing the pickup, destination, fare and pickup distance, and has 15 seconds to accept or decline.
- API call
  - GET /driver/offers/current   then   POST /driver/offers/{id}/accept   or   POST /driver/offers/{id}/reject
- Rules
  - ONE pending offer and ONE active trip per driver: no new offers until the current trip ends or is cancelled.
  - If several drivers race to accept, exactly one wins; the others get 'offer no longer available'.
  - Declines and timeouts count towards the driver's acceptance rate.
### D5. Drive to the pickup and start [built]
- What happens
  - On the way → arrived (the system checks the driver is near the pickup) → start the trip (entering the passenger's PIN when that feature is on).
- API call
  - POST /driver/trips/{id}/arriving → POST /driver/trips/{id}/arrived → POST /driver/trips/{id}/start  { pin }
- Rules
  - Waiting at pickup beyond the free minutes (3 in the demo rules) is charged per minute.
### D6. Cancel (the standard way) [built]
- What happens
  - Before the trip starts the driver can cancel with a reason (e.g. passenger not reachable). The request closes and the passenger can request again.
- API call
  - POST /driver/trips/{id}/cancel  { reason }
- Rules
  - Cancellations count towards the driver's cancellation rate. Repeated late cancellations can lead to suspension by staff.
### D7. Complete the ride and collect cash [built]
- What happens
  - At the destination the driver completes the trip. The app shows the amount to collect; the driver takes the cash and confirms it.
- API call
  - POST /driver/trips/{id}/complete   then   POST /driver/trips/{id}/cash-collected
### D8. See earnings and wallet [built]
- What happens
  - The driver sees each trip's earning (fare minus platform commission) and their wallet: negative means they owe the organisation (cash they kept that includes the platform's share); positive means the organisation owes them.
- API call
  - GET /driver/earnings   and   GET /driver/wallet
### D9. Pay the organisation (cash dues) [built]
- What happens
  - Because passengers pay cash to the driver, the driver holds the platform's commission. The driver deposits it by bKash, Nagad, bank or at the office; finance records the deposit and it clears the dues.
- Where in the admin panel
  - Admin panel → Payments → Driver dues → Record deposit
- Rules
  - Finance reconciles cash and deposits; differences raise an alert.
### D10. Get paid by the organisation (payouts) [partly built]
- What happens
  - When a driver's wallet is positive (promo discounts the platform covered, incentives, cancellation fees), finance creates a weekly payout batch, a second finance person approves it, and the money is sent to the driver's verified bKash / Nagad / bank account and marked paid.
- API call
  - Driver: PUT /driver/payout-account  { method, holder, ref }
- Where in the admin panel
  - Admin panel → Payouts
- Rules
  - Only balances of at least 500 are paid (setting payouts.minimum_amount).
  - The person who creates a batch cannot approve it (maker–checker).
  - Sending the money is manual today (bKash merchant portal or bank upload); automatic payout needs a provider API, see docs/integrations/payout-provider.md.
## Money and profit
### How cash moves
- Passenger pays the full fare in cash to the driver
- Driver deposits the organisation's share (bKash, Nagad, bank or office)
- Organisation pays the driver what it owes (promo discounts, incentives, cancellation fees) in the weekly payout
### Fare
- fare = max(minimum fare, base + per_km × km + per_minute × minutes + waiting) × surge  + booking fee
### Who gets what
- driver
  - fare − platform commission (commission is a percentage of the fare, set per fare rule)
- organisation
  - platform commission + booking fee + commission share of cancellation fees
- organisation costs
  - promo discounts (the platform funds them), driver incentives, approved refunds
### Worked examples
- Bike, 6 km, 18 minutes, cash, no promo
  - fare: 25 + 6×12 + 18×1 = 115
  - passenger pays driver: 115
  - driver earning: 115 − 15% (17.25) = 97.75
  - organisation earns: 17.25
  - settlement: The driver holds 115 but earned 97.75, so the driver wallet shows −17.25: the driver deposits 17.25 to the organisation (D9).
- Same ride with promo WELCOME50 (platform pays the 50)
  - fare: 115
  - passenger pays driver: 65
  - driver earning: 97.75
  - organisation earns: 17.25 commission − 50 promo = −32.75 (a marketing cost)
  - settlement: The driver holds 65 but earned 97.75, so the wallet shows +32.75: the organisation pays the driver 32.75 in the next payout (D10).
- Car, 8 km, 25 minutes, cash
  - fare: 60 + 8×30 + 25×3 = 375, plus booking fee 10 = 385
  - passenger pays driver: 385
  - driver earning: 375 − 20% (75) = 300
  - organisation earns: 75 commission + 10 booking fee = 85
  - settlement: Driver wallet −85: deposited to the organisation.
### Organisation profit
- Revenue
  - Commission on every completed ride
  - Booking fee (car and CNG)
  - Commission share of passenger cancellation fees
- Minus
  - Promotions the platform funds
  - Driver incentives (approved adjustments)
  - Refunds
  - Running costs outside this system (maps, SMS, hosting, staff)
- Where to see it
  - Admin panel → Dashboard (gross bookings, platform revenue, contribution per ride), Analytics → Economics and Finance, Ledger (platform accounts).
### Controls
- Fares are frozen at quote time.
- Refunds and adjustments need a second approver from 5,000 up (setting finance.dual_approval_threshold).
- The ledger is checked every night; any imbalance raises an alert.
- Every staff action needs a reason and is written to the audit log.
## One-at-a-time rules
### passenger
- One active request at a time. To book another ride, cancel the current one (standard cancel, fee rules apply) or wait until it completes or expires.
### driver
- One pending offer and one active trip at a time. A new offer comes only after the current trip is completed or cancelled.
### race safety
- If many drivers accept the same ride at once, exactly one gets it (tested with 50 drivers at once).
## Not built yet
### Passenger and driver mobile apps
- The API they need is built; see docs/spec/05-api.md.
### Passenger chooses a specific driver
- Today: automatic nearest-driver dispatch, or staff assign a driver. Design for passenger choice is in P5.
### Nearby drivers drawn on the passenger's map
- Today: the quote returns the count of nearby drivers.
### Google Maps share links and place search
- Needs the app and a geocoding provider (Google Places or Barikoi).
### bKash / Nagad / card payment by the passenger
- Needs merchant accounts; see docs/integrations/digital-payments.md.
### Automatic payouts to drivers
- Today finance sends payouts by hand and marks them paid; see docs/integrations/payout-provider.md.
