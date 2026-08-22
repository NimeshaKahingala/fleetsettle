# Suite 03 — Arrangement C (Trips & Charters): Happy Path

**Phase:** 1
**Depends on:** Suite 00 (setup)
**Source:** UC-20–UC-22, UC-40–UC-45, F-5.1–F-5.5

---

### HP-03-001: Create a trip — dates, customer, driver, fee

**Priority:** P0
**Source:** UC-40, UC-41, F-5.1
**Preconditions:** Vehicle BUS-5678 available for trip dates, customer "Royal College" exists, driver Ruwan assigned.

**Steps (corrected 22 Aug 2026 against `BookTripScreen.tsx` — a 3-step wizard `["Trip", "Driver", "Confirm"]`, not a single form):**
1. ACTION: Navigate to vehicle BUS-5678's calendar and tap a free date range (Jul 8–10), or Quick Add → New trip → choose the vehicle
   VERIFY: Screen title shows the vehicle's registration; step indicator reads "Step 1 of 3 · Trip"
2. ACTION: Step 1 ("Trip", level 1): dates default to today/the tapped date — adjust Start/End to Jul 8 – Jul 10; optionally choose customer "Royal College" (`EntityPicker`, "Customer (optional)"); optionally enter Destination and Agreed amount
   ACTION: Click "Next"
3. ACTION: Step 2 ("Driver", all optional, level 2/3 — U-2): optionally choose driver "Ruwan Jayasinghe"
   VERIFY: choosing a driver pre-fills "Driver trip fee" from that driver's own `driverTripFeeMinor`, only if the fee field hasn't already been touched
   ACTION: Click "Next"
4. ACTION: Step 3 ("Confirm"): if these dates overlap the vehicle's active daily lease, an alert reads "This pauses N day(s) of the daily lease — its expected income (Rs n) disappears"; a paperwork-expiry alert shows here too if one applies
   VERIFY: **no "customer advance" or "driver advance" field exists anywhere in this wizard as of 22 Aug 2026** — do not expect steps 8/9 below; a driver advance is recorded later, from the booked trip's own detail screen, not during booking
5. ACTION: Click "Book trip" (the step's primary action; "Hold instead" is the separate non-commitment action if a hold was intended)
   VERIFY: Navigates to `/trips/:id`; status is `booked` (or `in_progress` once today falls within the trip's own dates — `deriveTripStatus`)
   VERIFY: Daily lease cards paused for Jul 8–10

**Assertions (post-test):**
- [ ] Trip record with status `booked` (or `in_progress` if dates have started)
- [ ] INV-1: Vehicle-days exclusively allocated to the trip
- [ ] Daily cards for Jul 8–10 are `paused_for_trip`, not visible on home screen
- [ ] **Not built (as of 22 Aug 2026)**: recording a customer advance at booking time — no such field exists; only a driver advance exists, and only post-booking (see HP-03-006 below)

---

### HP-03-002: Add trip costs — fuel, tolls, food

**Priority:** P0
**Source:** UC-41, F-5.2, §6.7
**Preconditions:** Trip in progress.

**Steps (corrected 22 Aug 2026 — trip detail has no cost-entry button of its own):**
1. ACTION: **There is no "Add Cost" action on trip detail as of 22 Aug 2026** — costs are recorded through the same vehicle-scoped Quick Add sheets used everywhere else ("Log a fuel fill", "Record expense"), choosing this trip's own vehicle (BUS-5678); there is no trip picker in either sheet, so trip attribution is inferred server-side from whatever container is open on that vehicle
2. ACTION: Quick Add → Fuel → vehicle BUS-5678 → amount 22,000; open the "Litres, borne by and photo" disclosure → litres 120 (no odometer field exists — see suite 02's HP-02-008)
   VERIFY: "Borne by" reads "Resolved automatically" (§6.7's arrangement-C default), not a literal "us" picker value
3. ACTION: Quick Add → Expense → vehicle BUS-5678 → category, amount 2,000 (tolls)
4. ACTION: Quick Add → Expense → vehicle BUS-5678 → category, amount 1,000 (crew food)
5. ACTION: Return to trip detail
   VERIFY: All three costs appear under trip detail's own "Costs" section (read from `GET /api/trip/:id/expense`); "Costs so far" total updates

**Assertions (post-test):**
- [ ] All costs attached to the trip container (read-only on trip detail; no write entry point there)
- [ ] Borne-by resolves per §6.7's arrangement-C default (no manual "us" selection exists as a distinct step)
- [ ] Fuel litres recorded; **odometer is not built on the fuel sheet as of 22 Aug 2026** (see suite 02)
- [ ] Trip running cost ("Costs so far") visible on trip detail page

---

### HP-03-003: Close trip — odometer, balance, driver payment

**Priority:** P0
**Source:** UC-44, F-5.3
**Preconditions:** Trip completed, costs recorded.

**Steps (corrected 22 Aug 2026 — `CloseTripSheet.tsx` is closing-date-and-odometer only; balance collection and driver reconciliation are separate actions, not part of the close sheet):**
1. ACTION: Navigate to trip detail; if a driver advance is still open against this trip, the primary "Close trip" action is blocked with a Dialog naming the block (INV-17) — settle it first via the driver's own history, then retry
2. ACTION: Click "Close trip" (opens `CloseTripSheet`, level 1 only)
3. ACTION: Closing date defaults to today; optionally check "Read the closing odometer now" and enter a reading + source (Photo/In person/Reported/At return)
4. ACTION: Click "Close trip" (the sheet's own submit button)
   VERIFY: Trip detail re-fetches and now shows status "Closed" with the closing date
5. ACTION: Separately, if the "Received" row shows an outstanding balance, tap it to open the same `CollectPaymentSheet` a lease due uses, and record the payment
6. ACTION: Separately, if a driver fee is still owed, reconcile it from the driver's own detail/history screen — trip detail has no driver-payment action of its own beyond "Record advance" (pre-close) and "Record late charge" (post-close, customer-side only)

**Assertions (post-test):**
- [ ] Trip closed; the close sheet itself records only the closing date and optional odometer
- [ ] Customer balance collection is a separate, later action, not part of closing
- [ ] Driver advance reconciled against fee (INV-17: can't close with unreconciled advance) — this part still holds
- [ ] Daily lease cards for paused dates remain paused (not restored)

---

### HP-03-004: Trip P&L shows correct profit

**Priority:** P0
**Source:** UC-44, F-5.4
**Preconditions:** Trip closed with all costs and payments.

**Steps (corrected 22 Aug 2026 — no persistent trip P&L screen exists; `TripDetailScreen.tsx`'s own comment: "`POST /{id}/close`'s response is the only place that computation is currently made, and it is not repeated on every later `GET`"):**
1. ACTION: Close the trip (as HP-03-003) while watching the network log
   VERIFY: `POST /api/trip/:id/close`'s response body carries the profit/costs/distance breakdown — inspect it directly, since nothing renders it afterward
2. ACTION: Reload trip detail (a fresh `GET`)
   VERIFY: **the closed trip's own P&L is not shown here** — only "Agreed", "Received", "Costs so far" and the closing date persist; this is a deliberate, recorded gap, not a bug to file

**Assertions (post-test):**
- [ ] Trip profit is computed correctly once, in the close response — confirm by reading that response's JSON directly (a live network-log check), not by finding a screen that shows it
- [ ] INV-30: Income recognises on closing date (in one accounting period)
- [ ] **Not built (as of 22 Aug 2026)**: any persistent trip P&L, fuel-efficiency (km/l), or per-km-profit display after closing

---

### HP-03-005: Trip pauses daily lease cards for those dates

**Priority:** P1
**Source:** UC-30, UC-41, §4.1
**Preconditions:** Trip booked for specific dates, daily lease active.

**Steps (corrected 22 Aug 2026 — Home only ever shows "today"; there is no way to view it "as of" an arbitrary past date, so use the vehicle calendar's own date-range view instead of "Home on Jul 8"):**
1. ACTION: Confirm trip for Jul 8–10 while today falls inside that range, so Home's own "today" view is directly checkable
   VERIFY: No day card for BUS-5678 on Home (`paused_for_trip`)
2. ACTION: Navigate to the vehicle's own Calendar (`VehicleCalendarScreen.tsx`)
   VERIFY: Jul 8–10 show the legend state "On a trip" (exact current label), not "Daily lease, lost" or an open/unscheduled state

**Assertions (post-test):**
- [ ] Trip days are system-set `paused_for_trip`
- [ ] No daily cards visible for paused days
- [ ] Paused days count as operated in the month decomposition

---

### HP-03-006: Record a driver advance against a booked trip

**Priority:** P1
**Source:** UC-41, UC-44, F-5.1
**Preconditions:** Trip booked with a driver assigned.

**Steps (corrected 22 Aug 2026 — retitled: **no customer-advance concept exists for trips as of 22 Aug 2026**, neither during booking nor after; only a driver advance exists, and only after booking):**
1. ACTION: Open the booked trip's own detail screen
2. ACTION: Under "Advance to him", click "Record advance" (only present while `canRecordAdvance` — a driver is assigned and the trip isn't already closed)
3. ACTION: In the sheet (title "Record trip advance"), enter 5,000 and save
   VERIFY: Advance recorded

**Assertions (post-test):**
- [ ] **Not built (as of 22 Aug 2026)**: a customer-side advance for a trip — "Received" only ever reflects the real `trip_fare` obligation, never a pre-payment/advance concept; do not test for one
- [ ] Driver advance recorded as money to be reconciled
- [ ] Advance appears in "Where is our cash" as held money
- [ ] Trip cannot close with unreconciled driver advance (INV-17)
