# Suite 02 — Arrangement B (Daily Lease): Edge Cases

**Phase:** 1
**Depends on:** Suite 02 happy path
**Source:** A-2, A-10, A-13, A-26, UC-05, UC-06, UC-30, UC-33, UC-38, W-4, W-20, INV-5, INV-6

---

### EC-02-001: Alternate-day pattern — lost days report correct (A-13)

**Priority:** P1
**Source:** A-13, UC-05, §4.2
**Preconditions:** Daily lease with alternate-day pattern (every other day), full month.

**Steps:**
1. ACTION: Set up daily lease with pattern: "alternate days"
2. ACTION: Let a full month pass (31 days)
3. ACTION: Navigate to lost days report (UC-76)
   VERIFY: Off-pattern days show as `not_scheduled`
   VERIFY: No cards generated for off-pattern days
4. VERIFY: Lost days count only pattern days that did NOT run
5. VERIFY: Report does NOT show ~15 lost days (which would be the off-pattern days)

**Assertions (post-test):**
- [ ] Off-pattern days = `not_scheduled` — no card, neither operated nor lost
- [ ] Lost-days denominator = ran + lost (not total days in month)
- [ ] An alternate-day bus does NOT report ~15 lost days a month

---

### EC-02-002: Rate change mid-backlog — effective dating (A-2)

**Priority:** P1
**Source:** A-2, F-4.3
**Preconditions:** 9 unconfirmed days in backlog. Rate changed from 5,000 to 5,500 effective 5 days ago.

**Steps:**
1. ACTION: Open the catch-up stack (9 days)
   VERIFY: First 4 days show expected 5,000
   VERIFY: Last 5 days show expected 5,500
2. ACTION: Bulk-confirm at expected amounts
   VERIFY: Each day uses the rate that was in force on THAT day

**Assertions (post-test):**
- [ ] Days before rate change use old rate (5,000)
- [ ] Days after rate change use new rate (5,500)
- [ ] Today's rate is NOT retroactively applied to all 9 days
- [ ] Effective dating applies correctly through the backlog

---

### EC-02-003: Charter pauses daily cards — system-set, not pickable

**Priority:** P1
**Source:** UC-30, UC-41, §4.1
**Preconditions:** Active daily lease, a trip booked for dates within the month.

**Steps:**
1. ACTION: Create a trip on BUS-5678 for Jul 8–10 (3 days)
   VERIFY: System warns "Daily lease will pause for those dates"
2. ACTION: Confirm the trip
3. ACTION: Navigate to home screen on Jul 8
   VERIFY: No day card for Jul 8 (it is `paused_for_trip`)
4. ACTION: Check the lost-day reasons list
   VERIFY: "On charter" is NOT available as a pickable reason

**Assertions (post-test):**
- [ ] Charter days are system-set `paused_for_trip`
- [ ] Manager cannot manually select "on charter" as a lost-day reason
- [ ] Paused days don't appear on home screen
- [ ] Paused days count as operated, NOT lost (§7.1)

---

### EC-02-004: Concurrent confirm of same day (A-10)

**Priority:** P1
**Source:** A-10
**Preconditions:** Two managers with access to the same vehicle, same day unconfirmed.

**Steps:**
1. ACTION: Manager A opens today's day card
2. ACTION: Manager B opens today's day card (simultaneously)
3. ACTION: Manager A taps "Paid in full"
   VERIFY: Day confirmed by Manager A
4. ACTION: Manager B taps "Paid in full"
   VERIFY: Manager B sees the day is already confirmed
   VERIFY: No duplicate record created

**Assertions (post-test):**
- [ ] Exactly ONE day record exists (uniqueness constraint: one per lease per date)
- [ ] Second confirmation shows the first's result, not a duplicate

---

### EC-02-005: Missing day card created on demand

**Priority:** P1
**Source:** F-4.2
**Preconditions:** Scheduled job failed to generate today's day card (or manager accessed before job ran).

**Steps:**
1. ACTION: Navigate to home screen before the scheduled job ran
   VERIFY: Today's card is still available (generated on demand)
2. ACTION: Tap "Paid in full"
   VERIFY: Day created AND confirmed in one operation

**Assertions (post-test):**
- [ ] Day card generated on demand when it didn't exist
- [ ] Scheduled job is an optimisation, not a prerequisite
- [ ] Same rule applies for catch-up stack — missing cards generated on demand (U-8)

---

### EC-02-006: Didn't-run day — earned is always zero (INV-6)

**Priority:** P1
**Source:** INV-6, W-4, UC-33
**Preconditions:** Day card for today.

**Steps:**
1. ACTION: Tap "Didn't run"
2. ACTION: Select any reason
3. ACTION: Save
4. ACTION: Attempt to find any mechanism to set earned ≠ 0 on a didn't-run day
   VERIFY: No such mechanism exists

**Assertions (post-test):**
- [ ] INV-6: `earned = 0` — absolutely no configuration can make it non-zero
- [ ] No chargeable flag, no settings screen for one, no per-day override (W-4)

---

### EC-02-007: Bulk confirm cannot override didn't-run days

**Priority:** P1
**Source:** UC-38, F-4.6
**Preconditions:** 7 open days, one already marked "didn't run" with a reason.

**Steps:**
1. ACTION: Open catch-up stack
   VERIFY: Didn't-run day shown but visually distinct
2. ACTION: Tap "Confirm all"
   VERIFY: The didn't-run day is EXCLUDED from the bulk confirm
   VERIFY: Only 6 days are confirmed
3. VERIFY: Didn't-run day retains its state and reason

**Assertions (post-test):**
- [ ] Bulk confirm skips didn't-run days
- [ ] A didn't-run day needs an individual reason — it's a decision (W-4)
- [ ] No way to accidentally override a didn't-run day via bulk action

---

### EC-02-008: Weekly settler not in arrears on Thursday (A-26)

**Priority:** P1
**Source:** A-26, UC-78, F-4.5
**Preconditions:** Driver agreed to settle weekly (every Saturday). It is Thursday.

**Steps:**
1. ACTION: Navigate to driver's balance view on Thursday
   VERIFY: Driver shows 5 days outstanding (Mon–Fri) = 25,000
2. ACTION: Navigate to ageing report (UC-78)
   VERIFY: Driver is NOT listed as "in arrears"
   VERIFY: Ageing measures from the agreed settlement point (Saturday), not daily

**Assertions (post-test):**
- [ ] Weekly settler's ageing runs from the agreed rhythm
- [ ] He is not in arrears on Thursday — the week hasn't ended yet
- [ ] A reliable weekly payer doesn't sit permanently in a late bucket

---

### EC-02-009: Bus odometer fully optional on daily lease (W-20)

**Priority:** P2
**Source:** W-20
**Preconditions:** Vehicle on daily lease (arrangement B).

**Steps:**
1. ACTION: Navigate through all daily operations for the bus
   VERIFY: No prompt, no nag, no reminder for odometer reading
2. ACTION: Check that odometer can be entered voluntarily
3. ACTION: Check that no report depends on it for arrangement B

**Assertions (post-test):**
- [ ] Odometer is never prompted on arrangement B
- [ ] Over-use detection is opportunistic, not systematic
- [ ] The lost-days report remains the main protection (not odometer)

---

### EC-02-010: Fuel borne by driver excluded from profit (INV-5)

**Priority:** P1
**Source:** INV-5, §6.1, W-7
**Preconditions:** Fuel fill recorded with borne_by = driver on arrangement B.

**Steps:**
1. ACTION: Record fuel: 8,500, leaving "Borne by" on its automatic default (§6.7 resolves this to the driver for a daily lease — no manual picker sets it directly, only an "Override to Us" toggle exists)
2. ACTION: Navigate to "How was this month" for the vehicle
   VERIFY: 8,500 does NOT appear in the "Spent" tile or reduce "Profit"
3. VERIFY (no dedicated breakdown exists as of 22 Aug 2026): 8,500 is simply absent from the report — there is no "below the line, costs borne by the driver" section to check it against

**Assertions (post-test):**
- [ ] INV-5: Cost with borne_by ≠ us is excluded from profit
- [ ] No below-the-line section exists — silent exclusion from "Spent"/"Profit" is the whole mechanism
- [ ] A report with no fuel data says "not available", never 0
