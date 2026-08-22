# Suite 01 — Arrangement A (Monthly Rental): Happy Path

**Phase:** 1
**Depends on:** Suite 00 (setup)
**Fixture:** `fixtures/seed-data.yaml` + `fixtures/golden-g3-mileage.yaml`
**Source:** UC-10–UC-19, F-2.1–F-2.8

---

### HP-01-001: Start a monthly rental with mileage terms

**Priority:** P0
**Source:** UC-10, F-2.1, W-15, W-16, W-19, W-24, W-30
**Preconditions:**
- Vehicle CAR-1234 active, arrangement A, no active lease
- Customer "Anil Rajapaksa" exists
- Mileage package "Standard 100km" exists

**Steps (corrected 22 Aug 2026 — starting a rental is a 7-step wizard, `StartLeaseScreen.tsx`, `["Customer", "Money", "Term", "Mileage", "Reminders", "Condition", "Confirm"]`; it's reached from the vehicle's calendar now, not a "Start Rental" button on the vehicle page):**
1. ACTION: Navigate to vehicle CAR-1234's Calendar and tap a free day (or use whatever current entry point reaches `StartLeaseScreen`)
   VERIFY: Screen title shows the vehicle's registration; step indicator reads "Step 1 of 7 · Customer"
2. ACTION: Step "Customer": choose "Anil Rajapaksa" via the Customer `EntityPicker`; click Next
3. ACTION: Step "Money": enter "Monthly amount" 70,000, "Due day of month" 12, "Deposit (optional)" 50,000; click Next
   VERIFY: Due day defaults to the start date's own day-of-month (U-3) until changed
4. ACTION: Step "Term": set "Start date" "2026-01-12"; click Next
5. ACTION: Step "Mileage": choose mileage package "Standard 100km" via its own picker
   VERIFY: "Daily km limit" and "Excess fee per km" auto-populate (100 / 25) — editable, but this lease keeps its own independent copy from here on
6. ACTION: Enter "Odometer at handover (km)" 45,000; choose odometer source "In person" (exact label — not the raw `in_person` value)
   VERIFY: Next is disabled until both the reading and a source are set, when a mileage limit is active; click Next
7. ACTION: Step "Reminders": set reminder timing if offered; click Next
8. ACTION: Step "Condition": optionally capture condition photos (level 2/3, skippable); click Next
9. ACTION: Step "Confirm": review, then click "Start rental" (the wizard's final action — not "Confirm")
    VERIFY: Navigates to the new lease; vehicle now shows as on an active lease

**Assertions (post-test):**
- [ ] `Lease` record with status `active`
- [ ] `Customer` linked to the lease
- [ ] `MileageTerms` as independent copy (editing package later won't change this lease)
- [ ] `PaymentSchedule` generated with due day 12
- [ ] First billing period: 12 Jan – 11 Feb = 31 days (inclusive both ends)
- [ ] First period allowance = 3,100 km (31 × 100)
- [ ] `Deposit(held)` = 50,000 AND `DepositMovement(taken)` recorded
- [ ] `OdometerReading` with source = `in_person` (INV-19)
- [ ] Confirmation message queued (UC-80) stating km per day, not per month
- [ ] INV-1: Vehicle-day shows exactly one arrangement
- [ ] INV-4: Deposit not in income

---

### HP-01-002: Collect the month's rent — full payment

**Priority:** P0
**Source:** UC-11, F-2.2
**Preconditions:** Active lease on CAR-1234, rent due for current period.

**Steps (corrected 22 Aug 2026 — `CollectPaymentSheet.tsx` is a two-step enter-then-preview flow, amount is not pre-filled, and there is no "who received" field on this sheet):**
1. ACTION: Navigate to Home
   VERIFY: The "Rent due" aside section lists the customer's card, with "Due since {date}" or "Due on {date}" depending on whether the due date has passed (GAP-138)
2. ACTION: Tap the due card (opens sheet titled "Collect payment")
   VERIFY: "Date" defaults to today; the "Amount received" `AmountPad` starts empty, not pre-filled with 70,000
3. ACTION: Enter amount: 70,000, save the pad
   VERIFY: Moves to an allocation-preview step showing how the amount applies across open dues
4. ACTION: Click "Confirm" (not "Confirm Payment")
   VERIFY: Due status changes to "paid"; the card no longer appears on Home once the read reflects it

**Assertions (post-test):**
- [ ] `Receipt` record created
- [ ] `DueAllocation` linking receipt to the due
- [ ] `HeldCash(+)` for the receiver
- [ ] Queued reminder cancelled (INV-12) with reason logged
- [ ] Receiver's held cash increased (feeds UC-75)

---

### HP-01-003: Read odometer and assess mileage — under allowance

**Priority:** P1
**Source:** UC-14, F-2.3, W-12
**Preconditions:** Active lease with mileage terms, end of first billing period.

**Steps (corrected 22 Aug 2026 — sheet is titled "Read the odometer", triggered via Lease actions → "Read odometer", not a "Mileage section"):**
1. ACTION: On lease detail, open Lease actions → "Read odometer"
2. ACTION: Enter "Reading (km)": 47,650 (driven 2,650 km from handover of 45,000)
3. ACTION: Choose source chip: "In person" (exact label)
4. ACTION: Click "Save reading" (not "Save")
   VERIFY: The sheet's own result view shows "Driven" 2,650 km, "Allowance" 3,100 km, "Excess" 0 km · Rs 0
   VERIFY: No separate "under allowance" message beyond Excess reading 0 — this is the same result view HP-01-004 uses, not a distinct happy-path screen
   VERIFY: NO excess due created (Excess km is 0, so nothing is charged)

**Assertions (post-test):**
- [ ] `OdometerReading` with source stored (INV-19)
- [ ] `MileageAssessment` shows driven < allowance
- [ ] No `Due(excess)` created
- [ ] INV-7: Rent unchanged despite under-use
- [ ] INV-8: Allowance = 100 × days_in_period, no carry-forward

---

### HP-01-004: Read odometer and charge excess

**Priority:** P0
**Source:** UC-14, F-2.3, W-16, W-24
**Preconditions:** Second billing period, handover at 45,000, previous reading at 47,650.

**Steps (corrected 22 Aug 2026 — **there is no separate "Charge Excess" action**: `ReadOdometerSheet.tsx`'s result view only has a "Done" button; saving the reading is the whole write, and the excess due — or its auto-waiver, if below `BusinessSettings`' threshold — is created as part of that same mutation):**
1. ACTION: Lease actions → "Read odometer"
2. ACTION: Enter "Reading (km)": 51,240
3. ACTION: Choose source chip: "Photo"
4. ACTION: Click "Save reading"
   VERIFY: The result view shows "Driven", "Allowance" and "Excess" (km · Rs amount) in one place — this is the whole confirmation, not a preview awaiting a further charge action
   VERIFY: If the excess amount is below the business's auto-waive threshold, the result view instead reads "Below the auto-waive threshold — recorded as waived automatically" (no separate waive step either)
5. ACTION: Click "Done"

**Assertions (post-test):**
- [ ] `MileageAssessment(period, final)` created
- [ ] `Due(excess)` with correct amount, created automatically by the same write as the reading — **not** a two-step "assess then charge" flow
- [ ] Excess = (driven - allowance) × rate_per_km
- [ ] INV-7: Rent amount unchanged — mileage only adds
- [ ] INV-8: Allowance = daily_limit × days in THIS period

---

### HP-01-005: Adjust or waive a small excess

**Priority:** P1
**Source:** UC-15, F-2.4, W-17
**Preconditions:** An excess due exists on a lease.

**Steps (corrected 22 Aug 2026 — one sheet handles adjustments and waivers together, `AdjustObligationSheet.tsx`, title "Adjust or waive"):**
1. ACTION: On the lease, open Lease actions → "Adjust or waive"
2. ACTION: Choose the "Waive" type chip (direction is pinned negative — not independently settable; other chips are Goodwill/Rounding/Agreed discount/Late fee/Extra charge)
3. ACTION: Enter "Amount" 340 (the full excess — there is no separate "waive in full" vs "partial" toggle, the amount you enter decides that)
4. ACTION: Enter "Reason": "goodwill — small amount" (`NoteField`)
5. ACTION: Click "Save adjustment" (not "Save")
   VERIFY: Due marked as waived
   VERIFY: Waiver amount and reason displayed

**Assertions (post-test):**
- [ ] Waiver is a recorded adjustment, NOT a deletion
- [ ] The month shows: excess was 340, you waived 340 (both visible)
- [ ] Waiver appears in annual "goodwill given" total
- [ ] INV-14: Waiver is NOT in the write-off bucket

---

### HP-01-006: Renew lease at a new rate

**Priority:** P1
**Source:** UC-17, F-2.5
**Preconditions:** Active lease nearing term.

**Steps (corrected 22 Aug 2026 — `RenewLeaseSheet.tsx` has no effective-date field at all; the next billing period is the only option, not a choice to set):**
1. ACTION: On lease detail, Lease actions → "Renew" (sheet title "Renew")
2. ACTION: Enter "New monthly amount": 75,000 (optionally "Daily km limit"/"Excess fee per km" too, to renew mileage terms in the same action)
3. ACTION: Click "Save new terms" (not "Save")
   VERIFY: New rate confirmed, effective the next billing period automatically — there is no step 4 to skip, it was never a field

**Assertions (post-test):**
- [ ] Old periods keep their old figure (70,000)
- [ ] New periods use 75,000
- [ ] Billing cycle does not shift unless start day deliberately changed

---

### HP-01-007: Close the lease — full wizard

**Priority:** P0
**Source:** UC-16, F-2.6, W-26, W-29, W-30
**Preconditions:** Active lease with some history, deposit held, at least one billing period complete.

**Steps (corrected 22 Aug 2026 — the real wizard is 5 steps, `CloseLeaseScreen.tsx`, `["Stop & final period", "Closure summary", "Condition", "Deposit", "Close out"]`; closing date, final-period mode and (optional) closing odometer are all captured together on step 1, and the lease is actually closed by that step's own submit, not deferred to the end):**
1. ACTION: On lease detail, "Close the lease"
   VERIFY: Screen title is the customer's name; step indicator "Step 1 of 5 · Stop & final period"
2. **Step 1 — "Stop & final period":**
   ACTION: Set "Closing date": today
   ACTION: Under "This final period", choose "Charge the days used" (pro-rated — matches the doc's original intent exactly; the other two chips are "Charge the full period" and "An agreed figure", the latter revealing an "Agreed amount" field)
   ACTION: Optionally check "Read the closing odometer now" and enter "Closing odometer (km)" plus a source
   ACTION: Click "Stop the clock" (this step's own primary action — it submits the close mutation immediately)
   VERIFY: Lease moves to `closing`; no further dues generated
3. **Step 2 — "Closure summary":**
   VERIFY: Shows "Total unpaid" from earlier periods, this period's amount, and open incidents if any — no separate excess-mileage line was found in this refresh pass; confirm at test time whether one exists
   ACTION: Click "Next"
4. **Step 3 — "Condition":** optionally capture return photos; click "Next"
5. **Step 4 — "Deposit":** if a deposit exists, choose an action — "Refund" / "Retain" / "Hold" (not "Refund in full" as a distinct choice; "Refund" is the full-refund case) — "Retain" reveals an "Amount to retain" field; set "Date" and optional "Reason"; click "Settle deposit" (skips straight to Next with no deposit)
6. **Step 5 — "Close out":** confirms "This marks the vehicle available again and closes the lease for good"; click "Close out" (not "Close")
   VERIFY: Vehicle status changes to available

**Assertions (post-test):**
- [ ] `Lease(closed)` status
- [ ] `Due(final period)` with correct pro-rated amount
- [ ] Closing odometer, if entered, produces a final mileage assessment — confirm this is real and not assumed; not independently re-verified against source in this pass
- [ ] `ConditionPhotoSet(return)` linked to handover set, if photos were captured
- [ ] `DepositSettlement` record, if a deposit existed
- [ ] **Not independently confirmed in this refresh pass**: whether a customer-facing statement is generated on close (see HP-01-008 below — no statement UI was found anywhere in the client)
- [ ] Lease in `closing` generates NO new dues

---

### HP-01-008: Customer statement generation

**Priority:** P2
**Source:** UC-19, F-2.8
**Preconditions:** Lease with payment history.

**Not built (as of 22 Aug 2026).** No "Statement" action exists on lease or customer detail, and no statement screen or export exists anywhere in `web/src` for a customer — the only "statement" text in the whole client is on the driver-facing `MineScreen.tsx`. Owner-only CSV export (`ExportTransactionsScreen.tsx`, "Export transactions (CSV)") is the closest thing that exists, and it isn't customer-scoped or shareable in the sense this case describes.

**Steps:** none — kept as a description of intended behaviour (F-2.8) rather than a runnable case until this ships.

**Assertions (post-test):**
- [ ] **Not built**: nothing to assert yet. Re-check this case once a statement flow exists.

---

### HP-01-009: Start rental with unlimited mileage (blank limit)

**Priority:** P1
**Source:** UC-10, F-2.1, W-16
**Preconditions:** Vehicle available, customer exists.

**Steps (corrected 22 Aug 2026 — the mileage step's own picker has a real "Unlimited" chip; there's no blank field to leave empty):**
1. ACTION: Start the 7-step rental wizard (HP-01-001) for a vehicle
2. ACTION: Fill in customer, amount, dates as usual through the Money/Term steps
3. ACTION: On the Mileage step, choose the "Unlimited" chip (not a blank field — `mileageChoice = "none"`)
4. ACTION: Continue to Confirm and click "Start rental"
   VERIFY: Rental created without mileage terms

**Assertions (post-test):**
- [ ] No odometer prompt appears anywhere in this lease
- [ ] No mileage assessment is ever triggered
- [ ] The feature stays out of the way when unused

---

### HP-01-010: Deposit held then released after hold window

**Priority:** P1
**Source:** UC-16, F-2.7, W-29
**Preconditions:** Lease closed with deposit in `hold_window` state.

**Not built (as of 22 Aug 2026), and worth a live confirmation rather than assuming from this note alone.** `hold_window`/`holdReleaseDate` only appears in `HomeScreen.tsx`'s own "Deposits to release" list — a read-only Section with no `onClick` on its cards, nothing tappable. `DepositMovementSheet.tsx` (the only "release"-shaped action in the client — its "Refund" movement type is the closest match) is only ever opened from `DriverDetailScreen.tsx`; there is no deposit-handling code anywhere in `CustomerDetailScreen.tsx`. A customer's rental deposit can only be dispositioned once, inside `CloseLeaseScreen`'s own "Deposit" step ("Refund"/"Retain"/"Hold" — see HP-01-007); if "Hold" is chosen there, this refresh pass found no later screen that ever revisits it.

**Steps:** none — kept as a description of intended behaviour (F-2.7/W-29) rather than a runnable case until a real release action is confirmed to exist somewhere this pass missed, or is built.

**Assertions (post-test):**
- [ ] **Not built**: file a GAP once this is confirmed live, not from source alone — a live pass may find a path this static read missed
- [ ] Deposit in `hold_window` is still a liability (INV-4) — this part of the invariant presumably still holds even with no release UI
- [ ] If a charge arrived during the window, it can be applied instead (F-8.4) — check whether *this* path exists even if plain release doesn't
