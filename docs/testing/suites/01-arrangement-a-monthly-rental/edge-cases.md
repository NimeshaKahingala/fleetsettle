# Suite 01 — Arrangement A (Monthly Rental): Edge Cases

**Phase:** 1
**Depends on:** Suite 01 happy path
**Source:** UC-10–UC-16, A-4, A-5, A-6, A-11, A-17, A-18, A-20, A-23, A-25, INV-7, INV-8, INV-9

---

### EC-01-001: Part payment — balance ages

**Priority:** P1
**Source:** UC-11, F-2.2
**Preconditions:** Rent due of 70,000 on a lease.

**Steps:**
1. ACTION: Tap the rent due
2. ACTION: Change amount to 50,000 (partial)
3. ACTION: Confirm payment
   VERIFY: Due status changes to `part_paid`
   VERIFY: Remaining balance = 20,000
4. ACTION: Navigate to home screen
   VERIFY: Outstanding 20,000 still visible
5. ACTION: Wait one billing cycle (or simulate)
   VERIFY: The 20,000 ages and appears in ageing report

**Assertions (post-test):**
- [ ] Due status = `part_paid`, not `paid`
- [ ] Reminder remains armed for the outstanding balance
- [ ] Part payment receipt recorded correctly

---

### EC-01-002: Two months paid together — oldest first (A-17)

**Priority:** P1
**Source:** A-17, UC-11, §6.5
**Preconditions:** Two months of rent due, one already part-paid (20,000 remaining from last month + 70,000 this month = 90,000 total).

**Steps:**
1. ACTION: Tap on payment section
2. ACTION: Enter amount: 90,000
   VERIFY: Preview shows allocation: 20,000 to oldest due (completing it), 70,000 to current due
3. ACTION: Review the preview
   VERIFY: Oldest due listed first, then current
4. ACTION: Confirm
   VERIFY: Both dues settled

**Assertions (post-test):**
- [ ] Preview shown before save (§6.5 rule)
- [ ] Allocation is oldest-first
- [ ] Both dues now show `paid`
- [ ] Correct residuals on each due

---

### EC-01-003: Missing boundary odometer reading — combined assessment

**Priority:** P1
**Source:** UC-14, F-2.3, INV-9
**Preconditions:** Two consecutive billing periods, no reading taken at the boundary.

**Steps:**
1. ACTION: Skip odometer entry at end of period 1
2. ACTION: At end of period 2, enter odometer reading
   VERIFY: System detects missing boundary reading
3. VERIFY: System assesses periods 1 and 2 TOGETHER against combined allowance
4. VERIFY: Per-period split shown as "estimated", apportioned by days
5. VERIFY: Largest-remainder used — parts sum to whole (INV-26)

**Assertions (post-test):**
- [ ] Combined assessment produced (not two separate)
- [ ] Split marked as "estimated"
- [ ] When a later reading arrives, prior provisional assessments are reconciled, NOT rewritten (INV-21)
- [ ] INV-9: Combined excess ≤ sum of separate excesses

---

### EC-01-004: Mileage combined excess ≤ separate excess (INV-9 property test)

**Priority:** P1
**Source:** INV-9, UC-14
**Preconditions:** Use G-3 fixture values: periods 3+4, combined driven 6,400, allowances 3,100 + 3,000.

**Steps:**
1. ACTION: Record combined assessment for 6,400 driven across two periods
   VERIFY: Combined excess = max(0, 6400 - 6100) = 300
2. ACTION: Hypothetically split as 3,500 and 2,900:
   VERIFY: Separate excess = max(0, 3500-3100) + max(0, 2900-3000) = 400 + 0 = 400
3. VERIFY: 300 ≤ 400 — combined ALWAYS ≤ separate

**Assertions (post-test):**
- [ ] INV-9 holds: missing reading always errs in customer's favour

---

### EC-01-005: Auto-waive threshold absorbs small excess (A-18)

**Priority:** P1
**Source:** A-18, UC-15, §6.11
**Preconditions:** Auto-waive threshold set to 500 (or applicable value). Lease with 10 km excess = 250 charge.

**Steps:**
1. ACTION: Record odometer showing 10 km over allowance
   VERIFY: Excess of 250 calculated but NOT surfaced (below threshold)
2. ACTION: Check home screen
   VERIFY: No excess due appears
3. ACTION: Navigate to annual goodwill report (UC-77)
   VERIFY: The auto-waived 250 DOES appear in the total

**Assertions (post-test):**
- [ ] Excess below threshold never surfaces as a due
- [ ] Waiver IS recorded (not deleted)
- [ ] Appears in annual goodwill total

---

### EC-01-006: Close lease early with pro-rated final period

**Priority:** P1
**Source:** UC-16, F-2.6, W-26
**Preconditions:** Active lease mid-billing period.

**Steps:**
1. ACTION: Begin lease closure wizard
2. ACTION: Set closing date to mid-period (e.g., day 15 of a 31-day period)
3. ACTION: Select "Charge the days used"
   VERIFY: Pro-rated amount = 70,000 × 15/31 (using largest-remainder)
4. ACTION: Verify mileage allowance for final period = daily_limit × 15
5. ACTION: Complete remaining wizard steps
   VERIFY: Lease closed with correct pro-rated amounts

**Assertions (post-test):**
- [ ] Final period amount is pro-rated, not full
- [ ] Mileage allowance is proportional to days used
- [ ] INV-26: Pro-rated split sums to the whole if multiple shares involved

---

### EC-01-007: Close lease with open incident — closure allowed (A-4)

**Priority:** P1
**Source:** A-4, UC-16, F-3.4
**Preconditions:** Active lease with an open incident (repairs not yet final).

**Steps:**
1. ACTION: Begin lease closure wizard
   VERIFY: Incident appears in the closure summary (step 4)
   VERIFY: Summary clearly states "Incident #X still open"
2. ACTION: Proceed with closure
   VERIFY: Closure IS allowed (not blocked)
3. ACTION: Complete closure
   VERIFY: Lease closed, incident remains open

**Assertions (post-test):**
- [ ] Lease status = `closed`
- [ ] Incident status = still `open` (spanning the closure)
- [ ] Incident can still receive costs and recoveries after lease closure

---

### EC-01-008: Same-day handover — boundary day rule (A-20)

**Priority:** P1
**Source:** A-20, W-46, INV-29
**Preconditions:** Active lease ending today, new lease starting today.

**Steps:**
1. ACTION: Close the current lease with closing date = today
2. ACTION: Start a new lease with start date = today
   VERIFY: System allows this (no conflict warning)
3. VERIFY: Today belongs to the INCOMING (new) lease
4. VERIFY: Yesterday belongs to the OUTGOING (old) lease

**Assertions (post-test):**
- [ ] INV-29: No vehicle-day is claimed by two leases
- [ ] The changeover day is neither double-booked nor lost
- [ ] Old lease ends day before new lease starts

---

### EC-01-009: Lease extended after accident — allowance grows

**Priority:** P1
**Source:** UC-12, UC-14, F-3.4
**Preconditions:** Active lease with mileage terms (100 km/day), accident treatment = extend by 12 days.

**Steps:**
1. ACTION: Record an accident with 12 off-road days
2. ACTION: Choose rent treatment: "Extend the rental by 12 days"
   VERIFY: Lease end date pushed out by 12 days
3. ACTION: Check the extended billing period's mileage allowance
   VERIFY: Allowance increased by 12 × 100 = 1,200 km

**Assertions (post-test):**
- [ ] Extension is a recorded `LeaseExtension` record
- [ ] Extended period gets additional allowance automatically
- [ ] No manual recalculation needed

---

### EC-01-010: Mileage package edited after lease agreed (A-25)

**Priority:** P1
**Source:** A-25, F-1.9, W-19
**Preconditions:** Lease active using "Standard 100km" package, which says 100 km/day at 25/km.

**Steps:**
1. ACTION: Navigate to Settings → Mileage Packages
2. ACTION: Edit "Standard 100km": change limit to 120, rate to 30
3. ACTION: Save
4. ACTION: Navigate to the active lease
   VERIFY: Lease still shows 100 km/day at 25/km (the ORIGINAL terms)

**Assertions (post-test):**
- [ ] Lease keeps its OWN copy of the mileage terms
- [ ] Package edit does NOT reprice existing leases
- [ ] The customer was messaged the original terms (UC-80), and those remain true

---

### EC-01-011: Auto-waive threshold left blank means zero (A-23)

**Priority:** P1
**Source:** A-23, W-43
**Preconditions:** Business settings with auto-waive threshold blank or zero.

**Steps:**
1. ACTION: Navigate to Settings → Business Settings
2. ACTION: Verify auto-waive threshold is blank or 0
3. ACTION: Record a mileage excess of 5 km = 125 charge
   VERIFY: Excess DOES surface as a due (not waived)
4. VERIFY: No automatic waiver applied

**Assertions (post-test):**
- [ ] Blank threshold = zero = waive nothing
- [ ] A forgotten setting NEVER silently forgives excess charges

---

### EC-01-012: Start rental with expired insurance — warn not block (A-11)

**Priority:** P1
**Source:** A-11, UC-92, F-10.1, U-7
**Preconditions:** Vehicle with expired insurance (expiry date in the past).

**Steps:**
1. ACTION: Navigate to "Start Rental" for the vehicle
2. ACTION: Fill in all rental details
3. ACTION: Click "Confirm"
   VERIFY: Warning displayed: "Vehicle insurance expired on [date]"
   VERIFY: Warning is NOT a block — user can proceed
4. ACTION: Click "Proceed anyway" (or equivalent)
   VERIFY: Rental created, override recorded

**Assertions (post-test):**
- [ ] Warning shown at the moment of sending the vehicle out (U-7)
- [ ] Proceeding anyway is allowed with reason recorded
- [ ] Override is logged (who, when, what warning was shown)

---

### EC-01-013: Deposit applied mid-lease from accident contribution

**Priority:** P1
**Source:** UC-12, W-44, F-3.4
**Preconditions:** Active lease with 50,000 deposit held. Accident with agreed customer contribution of 20,000.

**Steps:**
1. ACTION: Record accident contribution of 20,000
2. ACTION: Select "Take from deposit"
   VERIFY: Deposit reduced by 20,000 (now 30,000)
3. VERIFY: Deposit movement record created
4. VERIFY: Reduced deposit balance visible on lease
5. VERIFY: "Top up deposit" option offered at this moment

**Assertions (post-test):**
- [ ] Deposit partially applied via deliberate recorded action
- [ ] `DepositMovement` record created for the 20,000 application
- [ ] Deposit balance updated to 30,000
- [ ] Top-up opportunity presented at the moment of draw-down (W-44)
- [ ] INV-4: Deposit never appears as income
