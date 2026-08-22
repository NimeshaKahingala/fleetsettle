# Suite 11 — Golden Fixture E2E: G-3 Mileage

**Phase:** 1
**Depends on:** Suites 00, 01
**Fixture:** `fixtures/golden-g3-mileage.yaml`
**Source:** §7.3

---

### GF-11-003: G-3 Mileage on an open-ended rental — full walkthrough

**Priority:** P0 (Regression Suite)
**Source:** §7.3
**Preconditions:** Fresh database.

**Steps:**
1. **Setup:**
   - Create business
   - Add vehicle CAR-1234 (car, arrangement A)
   - Create lease: start Jan 12, monthly rent 70,000, 100 km/day, excess 25/km, open-ended
   - Record handover odometer: 0 (or any baseline, say 10,000)

2. **Period 1 (Jan 12 – Feb 11):**
   - Wait/simulate until Feb 11
   - Record odometer: 3,240 km driven
   - Assess: 31 days × 100 = 3,100 allowance. 3,240 driven. Excess = 140 km.
   - Charge = 140 × 25 = 3,500.

3. **Period 2 (Feb 12 – Mar 11):**
   - Wait/simulate until Mar 11
   - Record odometer: 2,650 km driven this period
   - Assess: 28 days × 100 = 2,800 allowance. 2,650 driven. Excess = 0.
   - Forfeited unused = 150 km.

4. **Period 3 (Mar 12 – Apr 11):**
   - Skip odometer reading completely (no reading taken)

5. **Period 4 (Apr 12 – May 11):**
   - Wait/simulate until May 11
   - Record odometer: 6,400 km driven SINCE Mar 11
   - Assess: Period 3 (31 days) + Period 4 (30 days) = 61 days combined
   - Combined allowance = 6,100 km
   - Combined driven = 6,400 km
   - Combined excess = 300 km. Total charge = 300 × 25 = 7,500.
   - Split apportionment: 300 × 31/61 = 152 km. 300 × 30/61 = 148 km.
   - Split charges: 152 × 25 = 3,800. 148 × 25 = 3,700.

**Assertions (post-test):**

*Any deviation from these numbers is a breaking regression.*

- [ ] **Rent column:** NEVER moves. It must be exactly 70,000 in every period.
- [ ] **Period 1:** Days = 31, Rent = 70,000, Allowance = 3,100, Expected Charge = 3,500
- [ ] **Period 2:** Days = 28, Rent = 70,000, Allowance = 2,800, Expected Charge = nothing (150 forfeited)
- [ ] **Period 3:** Days = 31, Rent = 70,000, Allowance = 3,100, Expected Charge = assessed with next
- [ ] **Period 4 (Combined with 3):** Combined driven = 6,400. Total expected charge = 7,500.
- [ ] **Split correctness:** Split MUST be exactly 152 / 148 (INV-26 largest remainder)
- [ ] **Split markers:** Marked as "estimated"
