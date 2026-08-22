# Suite 06 — Financial Operations: Edge Cases

**Phase:** 1
**Source:** A-7, A-22, §6.7, W-27, W-32, W-53, INV-4, INV-5, INV-24, INV-27

---

### EC-06-001: Borne-by defaults from arrangement + category (§6.7 matrix)

**Priority:** P1
**Source:** §6.7, F-3.1
**Preconditions:** Vehicles on each of the three arrangements.

**Steps:**
1. ACTION: Record fuel on arrangement A (lease out)
   VERIFY: borne_by defaults to "customer"
2. ACTION: Record fuel on arrangement B (daily lease)
   VERIFY: borne_by defaults to "driver"
3. ACTION: Record fuel on arrangement C (operated)
   VERIFY: borne_by defaults to "us"
4. ACTION: Record tyres on any arrangement
   VERIFY: borne_by defaults to "us" (always)

**Assertions (post-test):**
- [ ] §6.7 matrix reproduced exactly for all categories across all arrangements
- [ ] Defaults are overridable on individual records

---

### EC-06-002: Tolls flip between arrangements B and C

**Priority:** P1
**Source:** §6.7
**Preconditions:** Bus on daily lease (B) and also used for charters (C).

**Steps:**
1. ACTION: Record tolls on a lease day (arrangement B)
   VERIFY: borne_by defaults to "driver"
2. ACTION: Record tolls on a charter day (arrangement C)
   VERIFY: borne_by defaults to "us"

**Assertions (post-test):**
- [ ] Tolls flip between driver (B) and us (C)
- [ ] This is why borne_by is a property of the cost, not the category

---

### EC-06-003: Cost with no vehicle — separate block, never spread

**Priority:** P1
**Source:** UC-66, W-32
**Preconditions:** Overhead cost with null vehicle_id.

**Steps:**
1. ACTION: Navigate to consolidated P&L
   VERIFY: Vehicle-level profits shown per vehicle
   VERIFY: No-vehicle costs in a SEPARATE block beneath
   VERIFY: Costs are NOT spread across vehicles
2. VERIFY: Business profit = sum of vehicle profits - overhead costs

**Assertions (post-test):**
- [ ] W-32: Overheads shown separately, never allocated across vehicles (unless opt-in)
- [ ] INV-24: Records have business_id, nullable vehicle_id

---

### EC-06-004: Banking shortfall unattributed (A-7)

**Priority:** P1
**Source:** A-7, INV-23, UC-65
**Preconditions:** Week of pooled handovers totalling 300,000.

**Steps:**
1. ACTION: Bank 300,000 from pooled collections
2. ACTION: Actual count: 297,000 (shortfall of 3,000)
3. ACTION: Enter counted amount: 297,000
   VERIFY: Discrepancy of 3,000 displayed
4. ACTION: Choose who bears it: "Cash-handling loss" or "Back to driver"
5. ACTION: Save

**Assertions (post-test):**
- [ ] INV-23: Discrepancy attaches to the BANKING EVENT, not to a guessed receipt
- [ ] No individual receipt is modified to absorb the shortfall
- [ ] Bearer is a deliberate choice (W-37)

---

### EC-06-005: Management fee as vehicle cost to owner, income to manager

**Priority:** P2
**Source:** W-53, UC-03
**Preconditions:** Manager with a monthly management fee on a vehicle.

**Steps:**
1. ACTION: Navigate to vehicle monthly P&L
   VERIFY: Management fee appears as a cost (reduces vehicle profit)
2. ACTION: Navigate to manager's income view
   VERIFY: Management fee appears as income to the manager
3. ACTION: Check consolidated business profit (where manager is also a partner)
   VERIFY: Fee nets to zero on consolidated view

**Assertions (post-test):**
- [ ] W-53: Fee is a vehicle operating cost (to owner) AND income (to manager)
- [ ] Reduces owner's vehicle profit before shares are worked out
- [ ] Consolidated business profit nets to zero when manager = partner

---

### EC-06-006: Deposits and advances never appear in income (INV-4)

**Priority:** P1
**Source:** INV-4
**Preconditions:** Customer deposit, driver deposit, and driver advance all recorded.

**Steps:**
1. ACTION: Check monthly P&L for each
   VERIFY: None of the three appear as income
2. ACTION: Check yearly P&L
   VERIFY: None appear as income
3. ACTION: Check cash position
   VERIFY: All three appear correctly as held/outstanding money

**Assertions (post-test):**
- [ ] INV-4: Three forms of held money — none is income, in any period, in any report
- [ ] Releasing any of them is NOT a cost — it's returning money that was never yours (§6.13)
