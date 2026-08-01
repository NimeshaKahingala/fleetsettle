# Suite 04 — Incidents & Costs: Happy Path

**Phase:** 1
**Depends on:** Suite 01 (arrangement A)
**Source:** UC-12, UC-13, F-3.1–F-3.5

---

### HP-04-001: Open an incident — date, description, photos

**Priority:** P0
**Source:** UC-12, F-3.4
**Preconditions:** Active lease on CAR-1234.

**Steps:**
1. ACTION: Navigate to lease detail for CAR-1234
2. ACTION: Click "Report Incident"
3. ACTION: Enter date: "2026-07-08"
4. ACTION: Enter description: "Rear bumper damage — customer reversed into a post"
5. ACTION: Upload photos of damage
6. ACTION: Click "Save"
   VERIFY: Incident created with status `open`

**Assertions (post-test):**
- [ ] `Incident` record created and open
- [ ] Incident is a container — further costs/recoveries attach to it over weeks
- [ ] NOT a wizard — can be saved at step 1 and edited later (F-3.4)

---

### HP-04-002: Add repair costs to incident

**Priority:** P0
**Source:** UC-12, F-3.4 step 3
**Preconditions:** Open incident on CAR-1234.

**Steps:**
1. ACTION: Navigate to incident detail
2. ACTION: Click "Add Repair Cost"
3. ACTION: Enter: bodywork, amount 70,000, date "2026-07-28"
4. ACTION: Save
5. ACTION: Add another: parts, amount 25,000, date "2026-08-05"
6. ACTION: Save
   VERIFY: Both costs attached to the incident

**Assertions (post-test):**
- [ ] `IncidentCost[]` records linked to the incident
- [ ] Total repairs shown: 95,000
- [ ] Costs in different months correctly attributed

---

### HP-04-003: Choose rent treatment — extend the rental

**Priority:** P1
**Source:** UC-12, W-9, F-3.4 step 2
**Preconditions:** Open incident with off-road days.

**Steps:**
1. ACTION: In incident detail, enter off-road dates: Jul 8 – Jul 19 (12 days)
2. ACTION: Select rent treatment: "Extend the rental by 12 days"
3. ACTION: Save
   VERIFY: Lease end date pushed out by 12 days
   VERIFY: `LeaseExtension` record created

**Assertions (post-test):**
- [ ] `RentTreatment` = extend, linked to incident
- [ ] Lease end date moved forward by exactly 12 days
- [ ] `LeaseExtension` record answers "why does this lease run 12 days long"
- [ ] Extended period's mileage allowance gains 12 × daily_limit automatically

---

### HP-04-004: Record customer contribution

**Priority:** P1
**Source:** UC-12, W-10, F-3.4 step 4
**Preconditions:** Incident with repair costs known.

**Steps:**
1. ACTION: In incident detail, click "Customer Contribution"
2. ACTION: Enter agreed amount: 20,000
3. ACTION: Enter note: "Agreed — customer pays 20k for the bumper repair"
4. ACTION: Select payment method: "In instalments"
5. ACTION: Record first instalment: 10,000
6. ACTION: Save
   VERIFY: Contribution recorded, 10,000 remaining

**Assertions (post-test):**
- [ ] `IncidentRecovery` record with agreed amount and note
- [ ] Partial payment tracked
- [ ] Customer contribution reduces the net cost to you

---

### HP-04-005: File insurance claim and receive settlement

**Priority:** P1
**Source:** UC-12, W-11, F-3.4 step 5
**Preconditions:** Incident with significant damage.

**Steps:**
1. ACTION: In incident detail, enable "Insurance Claim" section
   VERIFY: Section was hidden by default (W-11)
2. ACTION: Enter amount claimed: 75,000
3. ACTION: Enter excess borne by you: 15,000
4. ACTION: Set status: "submitted"
5. ACTION: Save
   VERIFY: Claim in status `submitted`, showing as pending recovery
6. ACTION: Later, update claim: received 60,000, status "settled"
   VERIFY: Recovery recorded

**Assertions (post-test):**
- [ ] Insurance claim section hidden by default, enabled when needed
- [ ] While pending: shows as "money expected, not money earned"
- [ ] Pending recovery NEVER enters profit (INV-4 adjacent)
- [ ] Recovery carries TWO dates: agreed and received
- [ ] Claims-per-vehicle-per-year derivable from incident history

---

### HP-04-006: Incident bottom line — net cost calculated

**Priority:** P0
**Source:** UC-12, F-3.4 step 6
**Preconditions:** Incident with all costs and recoveries entered.

**Steps:**
1. ACTION: Navigate to incident detail
   VERIFY: Bottom line section shows:
   - Total repair cost: 95,000
   - Total recovered: 80,000 (20,000 customer + 60,000 insurer)
   - Still expected: 0
   - Net cost to you: 15,000

**Assertions (post-test):**
- [ ] Net cost = total repairs - total recovered = 15,000
- [ ] This number is findable as a single answer a year later
- [ ] No revenue lost (if treatment was "extend")

---

### HP-04-007: Record scheduled maintenance

**Priority:** P2
**Source:** UC-13, F-3.5
**Preconditions:** Vehicle exists.

**Steps:**
1. ACTION: Navigate to vehicle → "Add Expense" or "Maintenance"
2. ACTION: Enter: service, amount 15,000, odometer 130000
3. ACTION: Save
   VERIFY: Maintenance cost recorded as a vehicle cost (not incident)

**Assertions (post-test):**
- [ ] Cost is a vehicle cost, not tied to an incident
- [ ] Odometer recorded (optional)
- [ ] System can use service history + odometer to remind next time
