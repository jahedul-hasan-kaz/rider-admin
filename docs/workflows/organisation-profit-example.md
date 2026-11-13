# How the organisation makes money: 3 drivers, 10 passengers, one day

A real worked example. Every number was calculated by the platform's own fare function (`private.compute_fare`) using
the demo fare rules, then added up and cross-checked, so it matches what the system would record. All amounts are in BDT
(৳) and every ride is paid **in cash**.

**The short answer:** on this day the organisation earned **৳393.89 commission + ৳45.00 booking fees = ৳438.89**, spent
**৳154.00 on promotions**, and so kept **৳284.89** before its own running costs.

---

## 1. The people and the rates

**Drivers**

| Driver | Vehicle |
|---|---|
| Kamal | Bike |
| Sohel | Car |
| Anis | CNG |

**Passengers (10):** Nusrat, Farhana, Arif, Rakib, Tanjila, Shuvo, Mitu, Sadia, Tahmid, Ayesha. Each takes one ride.

**Fare rules used** (the demo rules)

| | Base | Per km | Per minute | Minimum fare | Booking fee | Free waiting | Waiting per min | **Commission** |
|---|---|---|---|---|---|---|---|---|
| Bike | 25 | 12 | 1 | 50 | 0 | 3 min | 2 | **15%** |
| Car | 60 | 30 | 3 | 150 | 10 | 3 min | 4 | **20%** |
| CNG | 40 | 20 | 2 | 90 | 5 | 3 min | 3 | **18%** |

**Promotions used:** `WELCOME50` (৳50 off) and `FRIDAY20` (20% off, at most ৳60). The platform pays for promotions;
the driver is never short because of a discount.

**Three rules to keep in mind**

1. **Commission is a percentage of the ride fare** (base + distance + time + waiting + surge). The booking fee is *not*
   in that amount: it goes to the organisation in full.
2. The fare is rounded to a whole taka, and a ride never costs less than the minimum fare.
3. A promotion lowers what the passenger pays, but the driver's earning and the commission are worked out on the
   **full fare before the discount**.

---

## 2. The ten rides

How each fare was built:

| # | Passenger | Driver | Trip | How the fare is calculated |
|---|---|---|---|---|
| 1 | Nusrat | Kamal (bike) | 6.0 km, 18 min | 25 + 6.0×12 + 18×1 = **115** |
| 2 | Farhana | Kamal (bike) | 3.2 km, 11 min | 25 + 38.40 + 11 = 74.40, rounded to **74**. Promo WELCOME50 takes off 50, so she pays **24** |
| 3 | Arif | Kamal (bike) | 8.5 km, 26 min, **surge ×1.20** (busy zone) | 25 + 102 + 26 = 153, plus 20% surge (30.60) = 183.60, rounded to **184** |
| 4 | Rakib | Kamal (bike) | 1.0 km, 5 min | 25 + 12 + 5 = 42, below the minimum, so it is lifted to **50** |
| 5 | Tanjila | Sohel (car) | 8.0 km, 25 min | 60 + 240 + 75 = 375, plus booking fee 10 = **385** |
| 6 | Shuvo | Sohel (car) | 12.4 km, 38 min, **waited 7 min** at pickup | 60 + 372 + 114 = 546, plus waiting (7 − 3 free = 4 min × 4 = 16) = 562, plus booking fee 10 = **572** |
| 7 | Mitu | Sohel (car) | 5.0 km, 16 min | 60 + 150 + 48 = 258, plus booking fee 10 = 268. Promo FRIDAY20 (20% = 53.60, rounded to 54) so she pays **214** |
| 8 | Sadia | Anis (CNG) | 4.5 km, 15 min | 40 + 90 + 30 = 160, plus booking fee 5 = **165** |
| 9 | Tahmid | Anis (CNG) | 7.0 km, 22 min | 40 + 140 + 44 = 224, plus booking fee 5 = **229** |
| 10 | Ayesha | Anis (CNG) | 3.0 km, 12 min | 40 + 60 + 24 = 124, plus booking fee 5 = 129. Promo WELCOME50 takes off 50, so she pays **79** |

Who gets what from each ride:

| # | Passenger pays the driver (cash) | Promo (platform pays) | Ride fare used for commission | Commission | Booking fee | **Driver earns** |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 115.00 | 0 | 115.00 | 17.25 | 0 | **97.75** |
| 2 | 24.00 | 50 | 74.00 | 11.10 | 0 | **62.90** |
| 3 | 184.00 | 0 | 184.00 | 27.60 | 0 | **156.40** |
| 4 | 50.00 | 0 | 50.00 | 7.50 | 0 | **42.50** |
| 5 | 385.00 | 0 | 375.00 | 75.00 | 10 | **300.00** |
| 6 | 572.00 | 0 | 562.00 | 112.40 | 10 | **449.60** |
| 7 | 214.00 | 54 | 258.00 | 51.60 | 10 | **206.40** |
| 8 | 165.00 | 0 | 160.00 | 28.80 | 5 | **131.20** |
| 9 | 229.00 | 0 | 224.00 | 40.32 | 5 | **183.68** |
| 10 | 79.00 | 50 | 124.00 | 22.32 | 5 | **101.68** |

On every ride the three shares add up to the full fare: **driver + commission + booking fee = fare before promo**
(ride 7: 206.40 + 51.60 + 10 = 268).

---

## 3. Totals per driver

| | Rides | Passengers paid the driver | Fare before promos | Promos | Commission | Booking fees | **Driver earned** | Driver keeps in hand | **Driver owes the organisation** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Kamal | 4 | 373.00 | 423.00 | 50 | 63.45 | 0 | **359.55** | 373.00 | **13.45** |
| Sohel | 3 | 1,171.00 | 1,225.00 | 54 | 239.00 | 30 | **956.00** | 1,171.00 | **215.00** |
| Anis | 3 | 473.00 | 523.00 | 50 | 91.44 | 15 | **416.56** | 473.00 | **56.44** |
| **All** | **10** | **2,017.00** | **2,171.00** | **154** | **393.89** | **45** | **1,732.11** | **2,017.00** | **284.89** |

How to read the last column: because passengers paid the **driver** in cash, each driver is holding more cash than they
earned. The difference is the organisation's share (commission and booking fees), reduced by the promotions the
organisation covered:

```
driver owes the organisation  =  commission + booking fees − promos
Kamal:   63.45 +  0.00 − 50 =  13.45
Sohel:  239.00 + 30.00 − 54 = 215.00
Anis:    91.44 + 15.00 − 50 =  56.44
```

Inside each driver's wallet the rides net off against each other. For example Farhana's ride (she paid ৳24 but Kamal
earned ৳62.90) is a ৳38.90 credit to Kamal, and Rakib's ride (Kamal earned ৳42.50 of the ৳50 he collected) is a debit
of ৳7.50. Kamal's wallet ends the day at **−৳13.45**.

---

## 4. The organisation's day

| | Amount |
|---|---:|
| Commission on 10 rides | 393.89 |
| Booking fees (car and CNG) | 45.00 |
| **Revenue** | **438.89** |
| Promotions funded (WELCOME50 ×2, FRIDAY20 ×1) | − 154.00 |
| **Kept before running costs** | **284.89** |

Per ride that is **৳28.49** on average (284.89 ÷ 10). Without promotions the day would have been ৳438.89, so
promotions took about **35%** of revenue (154 ÷ 438.89). That is the price paid to win the passengers who tried the
service with a discount.

---

## 5. Where the money physically goes

```
Passengers ──(2,017 cash)──▶ Drivers
                               │
        Drivers keep their earnings (1,732.11)
                               │
        Drivers deposit 284.89 ──▶ Organisation
          Kamal  13.45   Sohel 215.00   Anis 56.44
          (bKash, Nagad, bank or at the office; finance records each deposit)
```

- Each driver's **wallet** starts at 0. Completing a ride moves it by *(driver earning − cash collected)*, so it goes
  negative by the amount the driver owes.
- When the driver deposits, finance records it (Admin → Payments → Driver dues → Record deposit) and the wallet returns
  to 0.
- If a driver's wallet is ever **positive**, for example after many promo rides, incentives or cancellation fees, the
  organisation owes the driver and includes it in the weekly payout (balances of ৳500 or more are paid). Here all three
  wallets are negative, so no payout is due.

---

## 6. How it is recorded (one ride in the ledger)

The platform keeps a double-entry ledger: every ride posts lines that must balance exactly. Ride 7 (Mitu, the car ride
with the FRIDAY20 promo):

| Account | Debit | Credit |
|---|---:|---:|
| Driver Sohel's wallet (cash he collected) | 214.00 | |
| Promo expense (the organisation's discount cost) | 54.00 | |
| Driver Sohel's wallet (his earning) | | 206.40 |
| Commission revenue | | 51.60 |
| Booking fee revenue | | 10.00 |
| **Total** | **268.00** | **268.00** |

You can see these in **Admin → Ledger** (accounts `commission_revenue`, `booking_fee_revenue`, `promo_expense`) and
the day's totals on **Dashboard → Gross bookings, Platform revenue, Contribution per ride**. A nightly check confirms
the ledger balances; any difference raises an alert.

---

## 7. From "kept" to real profit

The ৳284.89 is the organisation's **contribution**: what the rides brought in after driver earnings and promotions. Real
profit also subtracts costs that are outside the platform's ledger, such as:

- Map and routing calls, SMS and email, hosting, payment fees (when digital payments arrive)
- Staff, support, office, marketing
- Refunds approved for passengers (recorded in the ledger as they happen)
- Driver incentives (also recorded in the ledger as approved adjustments)

A simple way to reason about it:

```
break-even rides per day  =  daily running costs  ÷  average contribution per ride
                          =  daily running costs  ÷  28.49      (from this example)
```

For instance, if daily running costs were ৳14,245, the organisation would need about 500 rides a day of this mix
to break even. Use your own costs; the 28.49 moves with the mix of vehicles (cars earn the most per ride because of the
higher commission and the booking fee), how many rides use promotions, and surge.

---

## 8. Levers that change the profit

| Lever | Effect |
|---|---|
| Commission % per vehicle type (Fare rules) | Directly changes revenue per ride |
| Booking fee (Fare rules) | Full revenue, no driver share |
| Surge (zone surge or automatic surge) | Raises the fare; commission grows with it |
| Promotions and their budgets (Promotions) | The main cost; budget limits cap it |
| Minimum fare | Lifts very short rides (ride 4: +৳8 fare, +৳1.20 commission) |
| Waiting charge | Pays the driver (and commission) for time lost at pickup |
| Cancellation fees | Charged to the passenger on late cancels; the driver receives the fee minus commission |
| Vehicle mix | Car and CNG rides carry a booking fee and a higher commission |

*Numbers computed on 2026-11-09 with the demo fare rules. Change a fare rule or promotion in the admin panel and the
same method gives new results.*
