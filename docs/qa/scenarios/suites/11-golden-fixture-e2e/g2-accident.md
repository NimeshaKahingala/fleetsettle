# Suite 11 — Golden Fixture E2E: G-2 Accident

**Phase:** 1
**Depends on:** Suites 00, 01, 04, 08
**Fixture:** `fixtures/golden-g2-accident.yaml`
**Source:** §7.2

---

### GF-11-002: G-2 One accident — full walkthrough

**Priority:** P0 (Regression Suite)
**Source:** §7.2
**Preconditions:** Fresh database.

**Steps:**
1. **Setup:**
   - Create business
   - Add vehicle CAR-1234 (car, arrangement A)
   - Create monthly lease: 70,000/month, start Jan 1 (or any date to align months), open-ended

2. **The Accident (July 8):**
   - Create incident on Jul 8
   - Set off-road days: 12 (Jul 8 – Jul 19)
   - Select rent treatment: "Extend the rental" (day count is a separate field on the same sheet, `OffRoadSheet.tsx`, not part of the option label)

3. **Costs & Recoveries:**
   - Record repair cost: 70,000 in July
   - Record repair cost: 25,000 in August
   - Record customer contribution agreed: 20,000 (paid in August)
   - Record insurance claim: claimed 75,000, excess 15,000, received 60,000 in September

4. **Monthly Processing:**
   - Close July
   - Close August
   - Close September

**Assertions (post-test):**

*Any deviation from these numbers is a breaking regression.*

- [ ] **July View:** Repairs 70,000 / Recovered 0 / Pending recovery shown 60,000 / Rent normal (70,000)
- [ ] **August View:** Repairs 25,000 / Recovered 20,000 / Pending recovery shown 60,000 / Rent normal (70,000)
- [ ] **September View:** Repairs 0 / Recovered 60,000 / Pending recovery shown 0 / Rent normal but term ends 12 days later
- [ ] **Net Cost:** 15,000 (95,000 total repair - 80,000 total recovered), findable as a single number
- [ ] **Revenue Lost:** Zero (days given back as time)
