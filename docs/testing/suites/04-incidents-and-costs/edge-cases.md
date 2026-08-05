# Suite 04 — Incidents & Costs: Edge Cases

**Phase:** 1
**Source:** A-4, UC-12, W-9, W-10, W-11, W-44

---

### EC-04-001: Multi-month incident — costs and recoveries in different months

**Priority:** P1
**Source:** UC-12, F-3.4, G-2 fixture
**Preconditions:** Incident from G-2: repairs in July and August, customer contribution in August, insurance in September.

**Steps:**
1. ACTION: Create incident on Jul 8
2. ACTION: Add bodywork 70,000 in July, parts 25,000 in August
3. ACTION: Record customer contribution 20,000 agreed/paid in August
4. ACTION: Record insurance settlement 60,000 received in September
5. ACTION: Check each month's report

**Assertions (post-test):**
- [ ] July report: repairs 70,000, pending recovery 60,000 shown
- [ ] August report: repairs 25,000, recovered 20,000, pending recovery 60,000 still shown
- [ ] September report: recovered 60,000, pending recovery 0
- [ ] Incident's net cost (15,000) is answerable as one number a year later
- [ ] Without the incident container, July would be a disaster and September a windfall

---

### EC-04-002: Close lease with open incident (A-4)

**Priority:** P1
**Source:** A-4
**Preconditions:** Lease with open incident (awaiting repair bill or insurance).

**Steps:**
1. ACTION: Begin lease closure
   VERIFY: Closure summary mentions the open incident
2. ACTION: Proceed to close
   VERIFY: Closure IS allowed
3. VERIFY: Incident stays open after lease closure

**Assertions (post-test):**
- [ ] Lease closed, incident still open and can receive further costs/recoveries
- [ ] Deposit enters hold_window (if applicable)

---

### EC-04-003: Pending insurance recovery never enters profit

**Priority:** P1
**Source:** W-11, INV-4 adjacent
**Preconditions:** Insurance claim submitted but not settled.

**Steps:**
1. ACTION: Navigate to the month's P&L while claim is pending
   VERIFY: Pending recovery shown as "money expected" — separate from income
   VERIFY: Recovery does NOT appear in income or profit figures

**Assertions (post-test):**
- [ ] Pending recovery is visible but NOT in profit
- [ ] Only when received does it reduce net cost

---

### EC-04-004: Rent treatment — credit days pro-rata

**Priority:** P1
**Source:** W-9, UC-12
**Preconditions:** Incident with 12 off-road days, monthly rent = 70,000.

**Steps:**
1. ACTION: Choose rent treatment: "Credit the days"
   VERIFY: Pro-rata reduction calculated: 70,000 × 12/30 = 28,000 (approx)
   VERIFY: Note points at the incident as the reason for the reduction

**Assertions (post-test):**
- [ ] Affected month's rent reduced pro-rata with a note referencing the incident
- [ ] The short month has a visible reason

---

### EC-04-005: Rent treatment — rent continues (default)

**Priority:** P2
**Source:** W-9
**Preconditions:** Incident with off-road days.

**Steps:**
1. ACTION: Choose rent treatment: "Rent continues" (the default)
   VERIFY: Nothing changes — no reduction, no extension
   VERIFY: This is the safe path — doing nothing is correct

**Assertions (post-test):**
- [ ] Default treatment requires no action
- [ ] Rent unchanged for the affected period

---

### EC-04-006: Customer contribution from deposit mid-lease

**Priority:** P1
**Source:** W-44, UC-12
**Preconditions:** Active lease with 50,000 deposit, incident with 20,000 contribution.

**Steps:**
1. ACTION: Record customer contribution of 20,000
2. ACTION: Select "Take from deposit"
   VERIFY: Deposit reduced to 30,000
3. VERIFY: Top-up opportunity offered at this moment (W-44)
4. ACTION: Decline top-up
   VERIFY: Reduced balance (30,000) visible on the lease

**Assertions (post-test):**
- [ ] Deposit partially applied via deliberate action
- [ ] `DepositMovement` created
- [ ] Top-up offered at the draw-down moment (the only time customer is willing)
- [ ] Remaining deposit = 30,000
