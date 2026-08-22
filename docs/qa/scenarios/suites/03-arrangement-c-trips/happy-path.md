# Suite 03 — Arrangement C (Trips & Charters): Happy Path

**Phase:** 1
**Depends on:** Suite 00 (setup)
**Source:** UC-20–UC-22, UC-40–UC-45, F-5.1–F-5.5

---

### HP-03-001: Create a trip — dates, customer, driver, fee

**Priority:** P0
**Source:** UC-40, UC-41, F-5.1
**Preconditions:** Vehicle BUS-5678 available for trip dates, customer "Royal College" exists, driver Ruwan assigned.

**Steps:**
1. ACTION: Navigate to vehicle BUS-5678 calendar
2. ACTION: Tap on a free date range (Jul 8–10) or click "Create Trip"
3. ACTION: Enter dates: Jul 8 – Jul 10
   VERIFY: System warns "Daily lease will pause for those dates"
4. ACTION: Select customer: "Royal College"
5. ACTION: Enter agreed amount: 60,000
6. ACTION: Select driver: "Ruwan Jayasinghe" (defaults to lease driver — W-6)
7. ACTION: Enter driver trip fee: 9,000 (pre-filled from driver record)
8. ACTION: Optionally enter customer advance: 20,000
9. ACTION: Optionally enter driver advance: 5,000
10. ACTION: Click "Confirm"
    VERIFY: Trip created, status = `booked`
    VERIFY: Daily lease cards paused for Jul 8–10

**Assertions (post-test):**
- [ ] Trip record with status `booked` (or `in_progress` if dates have started)
- [ ] INV-1: Vehicle-days exclusively allocated to the trip
- [ ] Daily cards for Jul 8–10 are `paused_for_trip`, not visible on home screen
- [ ] Customer advance recorded as held money (not income — INV-4)
- [ ] Driver advance recorded as money to reconcile (not a payment)

---

### HP-03-002: Add trip costs — fuel, tolls, food

**Priority:** P0
**Source:** UC-41, F-5.2, §6.7
**Preconditions:** Trip in progress.

**Steps:**
1. ACTION: Navigate to trip detail
2. ACTION: Click "Add Cost"
3. ACTION: Enter fuel: 22,000, litres: 120, odometer: 127500
   VERIFY: Borne-by defaults to "us" (arrangement C — W-7)
4. ACTION: Add tolls: 2,000
   VERIFY: Borne-by defaults to "us" (arrangement C)
5. ACTION: Add crew food: 1,000
6. ACTION: Save each cost
   VERIFY: Running trip total updates

**Assertions (post-test):**
- [ ] All costs attached to the trip container
- [ ] Borne-by = "us" for all costs on arrangement C (§6.7)
- [ ] Fuel litres and odometer recorded for efficiency calculation
- [ ] Trip running cost visible on trip detail page

---

### HP-03-003: Close trip — odometer, balance, driver payment

**Priority:** P0
**Source:** UC-44, F-5.3
**Preconditions:** Trip completed, costs recorded.

**Steps:**
1. ACTION: Navigate to trip detail
2. ACTION: Click "Close Trip"
3. ACTION: Enter closing odometer: 128200
4. ACTION: Record balance received from customer: 40,000 (60,000 - 20,000 advance)
5. ACTION: Pay driver: 9,000 (fee) minus 5,000 (advance) = 4,000 remaining
   VERIFY: Advance reconciliation shown
6. ACTION: Confirm closure
   VERIFY: Trip status = `closed`

**Assertions (post-test):**
- [ ] Trip closed with complete financial record
- [ ] Customer advance reconciled against agreed amount
- [ ] Driver advance reconciled against fee (INV-17: can't close with unreconciled advance)
- [ ] Daily lease cards for paused dates remain paused (not restored)

---

### HP-03-004: Trip P&L shows correct profit

**Priority:** P0
**Source:** UC-44, F-5.4
**Preconditions:** Trip closed with all costs and payments.

**Steps:**
1. ACTION: Navigate to closed trip detail
   VERIFY: Trip P&L visible:
   - Income: 60,000
   - Costs: fuel 22,000 + tolls 2,000 + food 1,000 + driver fee 9,000 = 34,000
   - Profit: 26,000
2. VERIFY: Profit per km is calculable (if closing odometer recorded)

**Assertions (post-test):**
- [ ] Trip profit = income - all costs = 26,000
- [ ] INV-30: Income recognises on closing date (in one accounting period)
- [ ] Costs borne by us are in the trip P&L
- [ ] Fuel efficiency (km/l) shown if both litres and odometer available

---

### HP-03-005: Trip pauses daily lease cards for those dates

**Priority:** P1
**Source:** UC-30, UC-41, §4.1
**Preconditions:** Trip booked for specific dates, daily lease active.

**Steps:**
1. ACTION: Confirm trip for Jul 8–10
2. ACTION: Navigate to home screen on Jul 8
   VERIFY: No day card for BUS-5678 (paused_for_trip)
3. ACTION: Navigate to the month view
   VERIFY: Jul 8–10 show as "on trip", not "lost" or "open"

**Assertions (post-test):**
- [ ] Trip days are system-set `paused_for_trip`
- [ ] No daily cards visible for paused days
- [ ] Paused days count as operated in the month decomposition

---

### HP-03-006: Record customer advance and driver advance

**Priority:** P1
**Source:** UC-41, UC-44, F-5.1
**Preconditions:** Trip being created or in progress.

**Steps:**
1. ACTION: In trip creation, enter customer advance: 20,000
2. ACTION: Enter driver advance: 5,000
3. ACTION: Save
   VERIFY: Both advances recorded

**Assertions (post-test):**
- [ ] Customer advance recorded as money held (not income — INV-4)
- [ ] Driver advance recorded as money to be reconciled
- [ ] Both appear in cash position as held money
- [ ] Trip cannot close with unreconciled advance (INV-17)
