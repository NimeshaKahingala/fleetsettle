# Suite 04 — Incidents & Costs: Happy Path

**Phase:** 1
**Depends on:** Suite 01 (arrangement A)
**Source:** UC-12, UC-13, F-3.1–F-3.5

---

### HP-04-001: Open an incident — date, description, photos

**Priority:** P0
**Source:** UC-12, F-3.4
**Preconditions:** Active lease on CAR-1234.

**Steps (corrected 22 Aug 2026 — reached from vehicle detail, not lease detail; the sheet is date + description only, no photo field found):**
1. ACTION: Navigate to vehicle detail for CAR-1234 (not lease detail — `ReportIncidentSheet.tsx` is triggered from `VehicleOverviewScreen.tsx`)
2. ACTION: Click "Report incident" (lowercase i)
3. ACTION: Enter "Date": "2026-07-08"
4. ACTION: Enter "Description": "Rear bumper damage — customer reversed into a post"
5. ACTION: **No photo-upload field exists on this sheet as of 22 Aug 2026** — skip; confirm at test time whether photos attach some other way before assuming this is simply unbuilt
6. ACTION: Click "Report incident" (the sheet's own submit label, not "Save")
   VERIFY: Incident created with status `open`, lands on the new incident's own detail screen

**Assertions (post-test):**
- [ ] `Incident` record created and open
- [ ] Incident is a container — further costs/recoveries attach to it over weeks
- [ ] NOT a wizard — can be saved at step 1 and edited later (F-3.4)

---

### HP-04-002: Add repair costs to incident

**Priority:** P0
**Source:** UC-12, F-3.4 step 3
**Preconditions:** Open incident on CAR-1234.

**Steps (corrected 28 Aug 2026 — GAP-172 (25 Aug 2026, Step 15) gave incident detail its own "Record repair cost" action; before that fix, no client screen could set `expense.incident_id` at all and "Total repairs" stayed Rs 0 regardless of what was recorded, confirmed live 23 Aug 2026):**
1. ACTION: In incident detail's "Incident actions" menu, select "Record repair cost" — opens `RecordExpenseSheet` with `incidentId` pre-filled and the vehicle pre-filled from the incident, so no vehicle/incident picker is shown.
   VERIFY: category (bodywork-appropriate), amount 70,000, date "2026-07-28" → save.
2. ACTION: Repeat "Record repair cost": category (parts), amount 25,000, date "2026-08-05".
3. VERIFY: Both costs appear under the "Repair costs" section (read-only list) and "Total repairs" updates — no longer stuck at Rs 0 (GAP-172's own before-state).

**Assertions (post-test):**
- [ ] `IncidentCost[]` records linked to the incident via `expense.incident_id`, set through "Record repair cost" — no incident picker shown, the vehicle and incident are both pre-filled
- [ ] Total repairs shown: 95,000
- [ ] Costs in different months correctly attributed (`posted_period_id` vs `belongs_to_period_id` — see suite 08 for the aggregate-report half, GAP-188)

---

### HP-04-003: Choose rent treatment — extend the rental

**Priority:** P1
**Source:** UC-12, W-9, F-3.4 step 2
**Preconditions:** Open incident with off-road days.

**Steps (corrected 22 Aug 2026 — sheet title "Off-road days", `OffRoadSheet.tsx`):**
1. ACTION: In incident detail, Incident actions → "Record off-road days"
2. ACTION: Set "From" Jul 8, "To" Jul 19 (12 days — derived from the date range, not entered as a count)
3. ACTION: Select rent treatment chip: "Extend the rental" (no day count in the label itself)
4. ACTION: Click "Save"
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

**Steps (corrected 22 Aug 2026 — agreeing the amount and receiving payment are two separate sheets, `CustomerContributionSheet.tsx`'s own comment: "*how* it gets paid — one go, instalments, or from the deposit — is not a distinct field"):**
1. ACTION: In incident detail, "Customer contribution" (exact label)
2. ACTION: Enter "Agreed amount": 20,000
3. ACTION: Enter note: "Agreed — customer pays 20k for the bumper repair"
4. ACTION: **No payment-method field exists** — save the agreement as-is
5. ACTION: When the first instalment of 10,000 actually arrives, use "Mark received" (`RecoveryReceivedSheet.tsx`) separately, entering 10,000
   VERIFY: Contribution shows 10,000 received, 10,000 still expected

**Assertions (post-test):**
- [ ] `IncidentRecovery` record with agreed amount and note
- [ ] Partial payment tracked via separate "Mark received" actions, not an instalment plan on the original sheet
- [ ] Customer contribution reduces the net cost to you

---

### HP-04-005: File insurance claim and receive settlement

**Priority:** P1
**Source:** UC-12, W-11, F-3.4 step 5
**Preconditions:** Incident with significant damage.

**Steps (corrected 22 Aug 2026 — the doc's own step 1 contradicted its own assertions block below; submitting and settling are two separate sheets, `InsuranceClaimSheet.tsx` and `SettleInsuranceClaimSheet.tsx`, neither with a manual status field):**
1. ACTION: In incident detail, Incident actions → "Submit insurance claim" (always visible — W-11's correction, GAP-11, is already reflected here; there is no hidden-by-default section to enable)
2. ACTION: Enter "Amount claimed": 75,000
3. ACTION: Enter "Excess you bear": 15,000
4. ACTION: Set "Claimed on" date; **no manual status field** — "submitted" is implicit on save
5. ACTION: Click "Submit claim"
   VERIFY: Claim showing as pending recovery
6. ACTION: Later, Incident actions → "Settle insurance claim" (separate sheet): enter "Amount received" 60,000, "Received on" date, click "Save"
   VERIFY: Recovery recorded — again, no manual "settled" status to set

**Assertions (post-test):**
- [ ] Insurance claim section optional to fill in, always visible (not hidden behind a setting — W-11, corrected 11 Aug 2026, GAP-11)
- [ ] While pending: shows as "money expected, not money earned"
- [ ] Pending recovery NEVER enters profit (INV-4 adjacent)
- [ ] Recovery carries TWO dates: agreed and received
- [ ] Claims-per-vehicle-per-year derivable from incident history

---

### HP-04-006: Incident bottom line — net cost calculated

**Priority:** P0
**Source:** UC-12, F-3.4 step 6
**Preconditions:** Incident with all costs and recoveries entered.

**Steps (corrected 22 Aug 2026 — exact current tile labels):**
1. ACTION: Navigate to incident detail
   VERIFY: Bottom-line tiles read "Total repairs", "Recovered", "Pending recovery", "Net cost to you" (not "Total repair cost"/"Total recovered"/"Still expected"):
   - Total repairs: 95,000
   - Recovered: 80,000 (20,000 customer + 60,000 insurer)
   - Pending recovery: 0
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

**Steps (corrected 22 Aug 2026 — "Maintenance" isn't a category; the real one is "Servicing"):**
1. ACTION: Quick Add → Expense → this vehicle (sheet title "Record expense")
2. ACTION: Choose category "Servicing" (`EXPENSE_CATEGORY_LABEL`, not "Maintenance"), amount 15,000
   VERIFY: odometer field — confirm at test time whether `RecordExpenseSheet` carries one; not independently verified in this refresh pass
3. ACTION: Save
   VERIFY: Cost recorded as a vehicle cost (not tied to any incident)

**Assertions (post-test):**
- [ ] Cost is a vehicle cost, not tied to an incident
- [ ] Odometer recorded (optional)
- [ ] System can use service history + odometer to remind next time
