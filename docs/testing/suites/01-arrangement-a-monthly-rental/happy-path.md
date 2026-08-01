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

**Steps:**
1. ACTION: Navigate to vehicle CAR-1234
2. ACTION: Click "Start Rental"
   VERIFY: Rental form opens
3. ACTION: Select customer: "Anil Rajapaksa"
   VERIFY: Name, NIC, mobile auto-fill from customer record
4. ACTION: Enter monthly amount: 70,000
5. ACTION: Set due day-of-month: 12
   VERIFY: Due day defaults to start day-of-month (U-3)
6. ACTION: Enter deposit: 50,000
7. ACTION: Set start date: "2026-01-12"
8. ACTION: Select mileage package: "Standard 100km"
   VERIFY: Daily limit = 100, excess rate = 25 auto-populated
9. ACTION: Enter handover odometer: 45,000
10. ACTION: Select odometer source: "in_person"
11. ACTION: Set reminders: 3 days before due, and on the day
12. ACTION: Optionally take condition photos (skip for now)
13. ACTION: Click "Confirm"
    VERIFY: Success notification displayed
    VERIFY: Vehicle status changes to "on lease" / allocated

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

**Steps:**
1. ACTION: Navigate to home screen or vehicle page
   VERIFY: Rent due card visible (e.g., "CAR-1234 — Rent due: 70,000")
2. ACTION: Tap the due
   VERIFY: Payment form opens with amount pre-filled: 70,000
3. ACTION: Confirm amount: 70,000
4. ACTION: Confirm date: today (default)
5. ACTION: Record who received: current user (default)
6. ACTION: Click "Confirm Payment"
   VERIFY: Due status changes to "paid"
   VERIFY: Due card disappears from home screen

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

**Steps:**
1. ACTION: Navigate to lease detail → Mileage section
2. ACTION: Click "Record Odometer"
3. ACTION: Enter reading: 47,650 (driven 2,650 km from handover of 45,000)
4. ACTION: Select source: "in_person"
5. ACTION: Click "Save"
   VERIFY: System shows: used 2,650 km, allowance 3,100 km
   VERIFY: "Under allowance — no excess" message
   VERIFY: NO excess due created

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

**Steps:**
1. ACTION: Navigate to lease mileage → Record Odometer
2. ACTION: Enter reading: 51,240 (driven 3,590 from period start at 47,650, assuming period 2 started at 47,650)
   VERIFY: System shows: used = reading - previous = calculated
3. ACTION: Select source: "photo"
4. ACTION: Click "Save"
   VERIFY: System shows: km used, allowance for this period, excess
   VERIFY: Excess charge calculated at agreed rate
5. ACTION: Click "Charge Excess"
   VERIFY: Excess due created

**Assertions (post-test):**
- [ ] `MileageAssessment(period, final)` created
- [ ] `Due(excess)` with correct amount
- [ ] Excess = (driven - allowance) × rate_per_km
- [ ] INV-7: Rent amount unchanged — mileage only adds
- [ ] INV-8: Allowance = daily_limit × days in THIS period

---

### HP-01-005: Adjust or waive a small excess

**Priority:** P1
**Source:** UC-15, F-2.4, W-17
**Preconditions:** An excess due exists on a lease.

**Steps:**
1. ACTION: Navigate to the excess due on the lease
2. ACTION: Click "Adjust" or "Waive"
3. ACTION: Select "Waive in full"
4. ACTION: Enter reason: "goodwill — small amount"
5. ACTION: Click "Save"
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

**Steps:**
1. ACTION: Navigate to lease detail
2. ACTION: Click "Renew" or "Change Rate"
3. ACTION: Enter new monthly amount: 75,000
4. ACTION: Set effective from: next billing period start
5. ACTION: Click "Save"
   VERIFY: New rate confirmed

**Assertions (post-test):**
- [ ] Old periods keep their old figure (70,000)
- [ ] New periods use 75,000
- [ ] Billing cycle does not shift unless start day deliberately changed

---

### HP-01-007: Close the lease — full wizard

**Priority:** P0
**Source:** UC-16, F-2.6, W-26, W-29, W-30
**Preconditions:** Active lease with some history, deposit held, at least one billing period complete.

**Steps:**
1. ACTION: Navigate to lease detail
2. ACTION: Click "Close Lease"
   VERIFY: Closure wizard opens
3. **Step 1 — Stop the clock:**
   ACTION: Set closing date: today
   VERIFY: Lease moves to `closing` state
   VERIFY: No further dues are generated
4. **Step 2 — Final period:**
   ACTION: Select "Charge the days used" (pro-rated)
   VERIFY: Pro-rated amount calculated using largest-remainder
5. **Step 3 — Final mileage:**
   ACTION: Enter closing odometer reading
   ACTION: Select source: "at_return"
   VERIFY: Final mileage assessment shown with excess or no excess
6. **Step 4 — Closure summary:**
   VERIFY: Shows unpaid dues from earlier periods
   VERIFY: Shows this period's amount
   VERIFY: Shows any excess mileage
   VERIFY: Shows any open incidents (if applicable)
7. **Step 5 — Return condition photos:**
   ACTION: Take/upload return photos
   VERIFY: Shown side by side with handover photos
8. **Step 6 — Settle deposit:**
   ACTION: Select "Refund in full"
   VERIFY: Deposit settlement recorded
9. **Step 7 — Close out:**
   ACTION: Click "Close"
   VERIFY: Vehicle status changes to available
   VERIFY: Final statement generated

**Assertions (post-test):**
- [ ] `Lease(closed)` status
- [ ] `Due(final period)` with correct pro-rated amount
- [ ] `MileageAssessment(final)` created
- [ ] `ConditionPhotoSet(return)` linked to handover set
- [ ] `DepositSettlement` record
- [ ] `Statement` generated
- [ ] INV-18: Deposit settlement was blocked until step 4 rendered
- [ ] Lease in `closing` generates NO new dues

---

### HP-01-008: Customer statement generation

**Priority:** P2
**Source:** UC-19, F-2.8
**Preconditions:** Lease with payment history.

**Steps:**
1. ACTION: Navigate to lease or customer detail
2. ACTION: Click "Statement"
   VERIFY: Statement displays: every due, every receipt, adjustments, mileage assessments, deposit movements, closing balance
3. ACTION: Click "Print" or "Share"
   VERIFY: Statement is printable/shareable

**Assertions (post-test):**
- [ ] Statement reconciles to the same figures the customer was messaged
- [ ] Structure mirrors the driver slip (F-6.6)

---

### HP-01-009: Start rental with unlimited mileage (blank limit)

**Priority:** P1
**Source:** UC-10, F-2.1, W-16
**Preconditions:** Vehicle available, customer exists.

**Steps:**
1. ACTION: Navigate to "Start Rental" for a vehicle
2. ACTION: Fill in customer, amount, dates
3. ACTION: Leave mileage limit BLANK
4. ACTION: Click "Confirm"
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

**Steps:**
1. ACTION: Wait for the deposit hold window to expire (or simulate)
   VERIFY: Deposit appears on home screen as actionable item
2. ACTION: Click on the deposit card
3. ACTION: Select "Release"
4. ACTION: Confirm
   VERIFY: Deposit released, no longer in held cash

**Assertions (post-test):**
- [ ] Deposit in `hold_window` is still a liability (INV-4)
- [ ] Releasing it is NOT an expense
- [ ] If a charge arrived during the window, it can be applied instead (F-8.4)
