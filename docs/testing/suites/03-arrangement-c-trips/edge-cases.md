# Suite 03 — Arrangement C (Trips & Charters): Edge Cases

**Phase:** 1
**Depends on:** Suite 03 happy path
**Source:** A-1, A-12, A-15, A-21, INV-17, W-47, F-5.1–F-5.5

---

### EC-03-001: Book trip on car already on monthly rental (A-1)

**Priority:** P1
**Source:** A-1, INV-1
**Preconditions:** Vehicle CAR-1234 on active monthly rental.

**Steps:**
1. ACTION: Navigate to vehicle CAR-1234
2. ACTION: Attempt to create a trip for dates within the rental period
   VERIFY: Refusal BEFORE the conflict exists
   VERIFY: Clear message: vehicle is on a monthly rental for those dates
3. VERIFY: No trip record created, no allocation made

**Assertions (post-test):**
- [ ] INV-1: Conflict detected before creation, not after
- [ ] The calendar would have shown the conflict visually (UC-95)

---

### EC-03-002: Trip cancellation — daily cards restored (A-12)

**Priority:** P1
**Source:** A-12, UC-45
**Preconditions:** Trip booked for Jul 8–10 on BUS-5678, daily lease active, daily cards already paused.

**Steps:**
1. ACTION: Navigate to trip detail
2. ACTION: Click "Cancel Trip"
3. ACTION: Confirm cancellation
   VERIFY: Trip status = `cancelled`
4. ACTION: Navigate to home screen on Jul 8
   VERIFY: Day card for Jul 8 is now visible / generated (restored)
5. ACTION: Check customer advance handling
   VERIFY: Advance refunded or retained as a recorded choice

**Assertions (post-test):**
- [ ] Daily cards restored for the previously paused dates
- [ ] Trip status = `cancelled`
- [ ] Customer advance handling is a deliberate choice (refund vs retain), not automatic
- [ ] Driver advance (if any) similarly handled

---

### EC-03-003: Close trip with unreconciled advance blocked (INV-17)

**Priority:** P1
**Source:** INV-17, UC-44
**Preconditions:** Trip with a driver advance of 5,000 unreconciled.

**Steps:**
1. ACTION: Navigate to trip detail
2. ACTION: Click "Close Trip"
3. ACTION: Complete all steps EXCEPT reconciling the driver advance
4. ACTION: Attempt final close
   VERIFY: System BLOCKS closure with message: "Driver advance of 5,000 unreconciled"

**Assertions (post-test):**
- [ ] INV-17: Trip cannot reach `closed` with unreconciled advance
- [ ] This is a hard block, not a warning (unlike most other rules which are warn-not-block)

---

### EC-03-004: Cross-month trip — income in closing month (A-21)

**Priority:** P1
**Source:** A-21, INV-30, W-41
**Preconditions:** Trip running Jul 28 – Aug 3, closed on Aug 5.

**Steps:**
1. ACTION: Create trip with dates Jul 28 – Aug 3
2. ACTION: Close trip on Aug 5
3. ACTION: Navigate to July's report
   VERIFY: Trip income does NOT appear in July
4. ACTION: Navigate to August's report
   VERIFY: Full trip income (60,000) appears in August
5. ACTION: Check the trip's own P&L
   VERIFY: Trip P&L is unchanged by this rule

**Assertions (post-test):**
- [ ] INV-30: Trip income recognises on closing date (Aug 5), in August only
- [ ] Trip P&L shows the same numbers regardless of which month it spans
- [ ] Income is undivided — no split across months

---

### EC-03-005: Trip hold vs booked — calendar distinction

**Priority:** P2
**Source:** UC-40, ST-5, F-1.5
**Preconditions:** Vehicle with calendar visible.

**Steps:**
1. ACTION: Create a trip enquiry (status = `hold`)
2. ACTION: Navigate to vehicle calendar
   VERIFY: Hold dates shown in a DISTINCT visual style from booked trips
3. VERIFY: Hold does NOT suppress daily lease cards (unlike a confirmed trip)
4. ACTION: Confirm the hold → status changes to `booked`
   VERIFY: Calendar appearance changes
   VERIFY: Daily cards now paused for those dates

**Assertions (post-test):**
- [ ] A `hold` reserves the calendar WITHOUT suppressing daily cards
- [ ] A tentative enquiry cannot quietly erase expected income
- [ ] Hold expires or is confirmed — no permanent limbo

---

### EC-03-006: Same driver owes rent and owed trip fee (A-15)

**Priority:** P1
**Source:** A-15, INV-3, W-2
**Preconditions:** Driver Ruwan has 6 shortfall days (owes 12,000) AND an unpaid charter fee (owed 9,000).

**Steps:**
1. ACTION: Navigate to driver Ruwan's balance view
   VERIFY: Two separate balances displayed:
   - "He owes you: 12,000"
   - "You owe him: 9,000"
   VERIFY: Net shown as information: "Net: you owe 0, he owes 3,000" (or similar)
2. VERIFY: Balances have NOT auto-merged
3. ACTION: No offset has been performed
   VERIFY: Both balances remain separate until explicit Offset (UC-56)

**Assertions (post-test):**
- [ ] INV-3: Two balances never move together except via Offset
- [ ] Net is displayed but not applied
- [ ] The same person is simultaneously debtor and creditor (W-2)

---

### EC-03-007: One driver per trip enforced (W-47)

**Priority:** P2
**Source:** W-47
**Preconditions:** Trip creation form.

**Steps:**
1. ACTION: Create a trip, select driver Ruwan
2. ACTION: Attempt to add a second driver
   VERIFY: No mechanism to add a second driver on the trip
   VERIFY: If a relief driver was needed, a separate driver payment (UC-34, W-34) would be used

**Assertions (post-test):**
- [ ] One driver per trip in v1 — stated as a limit
- [ ] A relief driver is handled via a driver payment not tied to a trip (W-34)
