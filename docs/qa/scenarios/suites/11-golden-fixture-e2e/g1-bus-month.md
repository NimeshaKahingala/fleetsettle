# Suite 11 — Golden Fixture E2E: G-1 Bus Month

**Phase:** 1
**Depends on:** Suites 00, 02, 03, 06
**Fixture:** `fixtures/golden-g1-bus-month.yaml`
**Source:** §7.1

---

### GF-11-001: G-1 One month of the bus — full walkthrough

**Priority:** P0 (Regression Suite)
**Source:** §7.1
**Preconditions:** Fresh database.

**Steps:**
1. **Setup:**
   - Create business (LKR, Asia/Colombo)
   - Add vehicle BUS-5678 (bus, arrangement B)
   - Add driver Ruwan (driver trip fee = 9,000)
   - Create daily lease: 5,000/day, effective Jul 1, open-ended, every_day pattern
   - Record deposit: 25,000

2. **Daily Operations (July 1 - July 31):**
   - Confirm 23 days as `ran_paid_full` (23 × 5,000 = 115,000)
   - Confirm Jul 12 as `ran_paid_short`: earned 5,000, received 3,000 (arrears = 2,000)
   - Mark Jul 15 and 16 as `did_not_run` (reason: breakdown)
   - Mark Jul 20 as `did_not_run` (reason: driver_day_off)
   - Mark Jul 25 as `did_not_run` (reason: no_passengers)

3. **Trip (Arrangement C):**
   - Create trip Jul 8–10, customer agreed 60,000
   - Record fuel: 22,000 (borne by us)
   - Record tolls/food: 3,000 (borne by us)
   - Close trip: record receipt 60,000, driver fee 9,000

4. **Breakdown Repair:**
   - Record repair: 12,000 (vehicle cost, borne by us)

5. **Below the Line (driver fuel):**
   - Record fuel: 45,000 across the month, borne by driver (simulated as one or many entries)

**Assertions (post-test):**

*Any deviation from these numbers is a breaking regression.*

- [ ] **Day Decomposition:** 31 days = 0 not_scheduled + 3 paused + 24 ran + 4 lost
- [ ] **Driver Owed/Received:** Driver trip fee of 9,000 (owed) / 0 (received yet) — Note: fixture says 120k/118k total if we include lease, but lease is money HE pays US. Reconcile against: "Driver owed / received 120,000 / 118,000". Wait, 24 ran days × 5,000 = 120,000 he owed us. He paid 118,000 (short 2,000 on Jul 12).
- [ ] **Arrears:** 2,000 (arising from the ran day, NOT the lost days)
- [ ] **Charter Profit:** Income 60,000 - costs (22,000 + 3,000 + 9,000) = 26,000
- [ ] **Bus July Earned:** 180,000 (120,000 lease + 60,000 charter)
- [ ] **Bus July Costs:** 46,000 (22k + 3k + 9k + 12k repair)
- [ ] **Bus July Net Profit:** 134,000 (180,000 - 46,000)
- [ ] **Driver Fuel/Tolls:** BELOW the line, NEVER inside the 46,000
- [ ] **Deposit:** 25,000 is in cash position, NOT in income/profit
- [ ] **Two Balances:** He owes 2,000 / You owe 9,000 (net shown, not applied)
- [ ] **Lost-Day Value:** 20,000 (4 lost × 5,000)
- [ ] **Fuel Efficiency (lease days):** "not available", not 0
