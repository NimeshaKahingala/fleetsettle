# Suite 02 — Arrangement B (Daily Lease): Happy Path

**Phase:** 1
**Depends on:** Suite 00 (setup)
**Source:** UC-06, UC-30–UC-38, F-4.1–F-4.7

---

### HP-02-001: Home screen shows today's pending day card

**Priority:** P0
**Source:** UC-30, F-4.1, U-1, U-4
**Preconditions:** Daily lease active on BUS-5678, driver Ruwan, 5,000/day. Today is a pattern day.

**Steps:**
1. ACTION: Open the app / navigate to home screen
   VERIFY: Today's day card is visible without navigating anywhere (U-1)
   VERIFY: Card shows: "BUS-5678 — [today's date] — Expected from Ruwan: 5,000"
   VERIFY: Three actions available: [Paid in full] [Something else] [Didn't run]
2. VERIFY: `paused_for_trip` days do NOT appear (§4.1)
3. VERIFY: `not_scheduled` days do NOT appear (§4.2)
4. VERIFY: Failed messages appear ABOVE the day card (if any)
5. VERIFY: Nothing about successful messaging appears

**Assertions (post-test):**
- [ ] Day card reachable without navigating (U-1)
- [ ] Home screen priority order follows §7 of user-flows.md

---

### HP-02-002: Confirm the day — paid in full (one tap)

**Priority:** P0
**Source:** UC-31, F-4.2, W-1, W-5
**Preconditions:** Today's day card visible on home screen.

**Steps:**
1. ACTION: Tap "Paid in full" on today's card
   VERIFY: Card disappears or shows as confirmed
   VERIFY: No further interaction required
   VERIFY: Entire operation completes in under 5 seconds

**Assertions (post-test):**
- [ ] `DayRecord` created: earned = 5,000, state = `ran_paid_full`
- [ ] `Obligation` created for the day
- [ ] `Payment` created with amount = 5,000
- [ ] `Allocation` linking payment to obligation
- [ ] All four writes in a SINGLE transaction (F-4.2)
- [ ] INV-2: `earned` and `received` both stored as 5,000 (separate facts)

---

### HP-02-003: Confirm day — paid short (arrears generated)

**Priority:** P0
**Source:** UC-31, F-4.2, W-1
**Preconditions:** Today's day card visible.

**Steps:**
1. ACTION: Tap "Something else" on today's card
   VERIFY: Form opens showing both earned and received fields
2. ACTION: Earned: 5,000 (pre-filled, keep as-is)
3. ACTION: Received: 3,000
4. ACTION: Click "Save"
   VERIFY: Day confirmed with shortfall

**Assertions (post-test):**
- [ ] `DayRecord`: earned = 5,000, received = 3,000, state = `ran_paid_short`
- [ ] Arrears of 2,000 automatically added to driver's "he owes you" balance
- [ ] INV-2: earned and received stored separately — a cheap day and an unpaid day are distinguishable forever

---

### HP-02-004: Day didn't run — pick reason

**Priority:** P0
**Source:** UC-33, F-4.4, W-4, UC-06
**Preconditions:** Today's day card visible.

**Steps:**
1. ACTION: Tap "Didn't run" on today's card
   VERIFY: Reason picker appears
2. ACTION: Verify available reasons: breakdown, driver's day off, driver ill, public holiday, no passengers, other
   VERIFY: "On charter" is NOT in the list (§4.1)
3. ACTION: Select "breakdown"
4. ACTION: Click "Save"
   VERIFY: Day marked as didn't run

**Assertions (post-test):**
- [ ] `DayRecord`: earned = 0, state = `did_not_run`, reason = `breakdown`
- [ ] INV-6: earned = 0, no configuration can change it
- [ ] Day counts as a LOST day against `lease_eligible_days`
- [ ] No arrears generated (W-4)

---

### HP-02-005: Settle several days at once — oldest first

**Priority:** P1
**Source:** UC-37, F-4.5, §6.5
**Preconditions:** Multiple days outstanding (e.g., driver paid nothing for 5 days, total owed = 25,000).

**Steps:**
1. ACTION: Navigate to driver settlement or batch payment
2. ACTION: Enter amount: 25,000
   VERIFY: Preview shows which days the payment settles, oldest first
3. ACTION: Review the preview
   VERIFY: 5 days listed, each at 5,000, oldest date first
4. ACTION: Confirm
   VERIFY: All 5 days settled

**Assertions (post-test):**
- [ ] Preview shown BEFORE save (§6.5)
- [ ] Allocation is oldest-first
- [ ] `Receipt` + `DayAllocation[]` records created
- [ ] Driver arrears reduced by 25,000
- [ ] Surplus (if any) becomes credit against coming days

---

### HP-02-006: Confirm a week in one pass — bulk confirm

**Priority:** P1
**Source:** UC-38, F-4.6, U-8
**Preconditions:** 7 unconfirmed days in the backlog (manager was away).

**Steps:**
1. ACTION: Open the catch-up stack on home screen
   VERIFY: Stack shows every open day, oldest first, each at expected amount
2. ACTION: Click "Confirm all" (or equivalent bulk action)
   VERIFY: Preview shows all 7 days with total (7 × 5,000 = 35,000)
3. ACTION: Confirm the bulk action
   VERIFY: All 7 days confirmed in one operation

**Assertions (post-test):**
- [ ] All 7 `DayRecord` + `Obligation` + `Payment` + `Allocation` created
- [ ] Single transaction — partial failure confirms nothing
- [ ] Total matches expected (35,000)
- [ ] Preview shown before writing (§6.5 discipline)

---

### HP-02-007: Adjust daily amount and change going forward

**Priority:** P1
**Source:** UC-32, F-4.3, §6.2
**Preconditions:** Active daily lease at 5,000/day.

**Steps:**
1. ACTION: Navigate to a day card
2. ACTION: Tap "Something else"
3. ACTION: Change earned to 4,500 for this day
4. ACTION: Check "Make this the new daily amount from today"
5. ACTION: Click "Save"
   VERIFY: Today's day saved at 4,500

**Assertions (post-test):**
- [ ] This day's earned = 4,500
- [ ] Future cards use 4,500 as the expected amount
- [ ] Past days keep their original figure (5,000)
- [ ] The effective date of the change is editable (not hard-coded to today)
- [ ] Expected-vs-actual variance survives the rate change (§6.2)

---

### HP-02-008: Log a fuel fill on a lease day

**Priority:** P1
**Source:** UC-34, F-3.3, W-20
**Preconditions:** Vehicle BUS-5678 on daily lease.

**Steps:**
1. ACTION: Navigate to vehicle BUS-5678
2. ACTION: Click "Add fuel"
3. ACTION: Enter litres: 45
4. ACTION: Enter odometer: 126500 (optional on arrangement B — W-20)
5. ACTION: Enter amount: 8,500
6. ACTION: Borne-by: pre-filled as "driver" (W-7 default for arrangement B)
7. ACTION: Click "Save"
   VERIFY: Fuel record saved

**Assertions (post-test):**
- [ ] Fuel cost recorded with borne_by = driver
- [ ] INV-5: Cost with borne_by ≠ us excluded from profit
- [ ] Fuel shown "below the line" as "costs borne by the driver"
- [ ] Odometer was NOT prompted / nagged (W-20) — fully optional
- [ ] Litres stored for efficiency calculations (arrangement C only)
