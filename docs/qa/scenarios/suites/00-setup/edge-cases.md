# Suite 00 — Setup & Onboarding: Edge Cases

**Phase:** 1
**Depends on:** HP-00-001 through HP-00-013 (setup happy path)
**Source:** UC-02, UC-03, UC-09, UC-94, UC-95, A-19, F-0.2, F-1.2, F-1.3, F-1.5

---

### EC-00-001: Ownership shares not totalling 100%

**Priority:** P1
**Source:** UC-02, F-1.3, INV-16
**Preconditions:** Vehicle exists with no ownership set.

**Steps (corrected 22 Aug 2026 — relocated to More → Vehicle sharing, same as HP-00-005):**
1. ACTION: Navigate to More → Vehicle sharing → "Set ownership shares" for the vehicle
2. ACTION: Add owner A with 60% share
3. ACTION: Add owner B with 30% share
   VERIFY: Total displayed as 90%
4. ACTION: Click "Save shares"
   VERIFY: System REFUSES to save — shares must total exactly 100%
   VERIFY: Error message clearly states the requirement

**Assertions (post-test):**
- [ ] No `OwnershipShare` records created
- [ ] INV-16: System enforces 100% total

---

### EC-00-002: Duplicate vehicle registration

**Priority:** P2
**Source:** UC-01
**Preconditions:** Vehicle "CAR-1234" already exists.

**Steps:**
1. ACTION: Click "Add a vehicle"
2. ACTION: Enter registration: "CAR-1234" (duplicate)
3. ACTION: Click "Add vehicle"
   VERIFY: System warns about duplicate registration
   VERIFY: Either refuses or asks for confirmation with a clear warning

**Assertions (post-test):**
- [ ] Duplicate registrations are detected before save

---

### EC-00-003: Opening balance as draft then complete later

**Priority:** P1
**Source:** UC-09, F-0.2
**Preconditions:** Business exists, vehicles and drivers exist.

**Steps:**
1. ACTION: Navigate to More → Opening balances
2. ACTION: Set go-live date: "2026-07-01"
3. ACTION: Enter data for ONE vehicle only (bus)
4. ACTION: Click "Save as Draft"
   VERIFY: Batch saved but NOT committed
5. ACTION: Navigate away to another screen
6. ACTION: Return to opening balances
   VERIFY: Previously entered data is preserved
7. ACTION: Complete remaining vehicles and drivers
8. ACTION: Click "Confirm and go live"
   VERIFY: Full batch now committed

**Assertions (post-test):**
- [ ] Draft batch does not affect live data until committed
- [ ] Partial entry at first launch reduces friction (F-0.2 alternate)
- [ ] Committed batch behaves identically to a single-pass entry

---

### EC-00-004: Go-live mid-month with active arrangements (A-19)

**Priority:** P1
**Source:** A-19, UC-09, W-51
**Preconditions:** Business exists.

**Steps:**
1. ACTION: Set go-live date: "2026-07-15" (mid-month)
2. ACTION: Enter a live lease that started on the 12th (original start date = 2026-06-12)
3. ACTION: Enter driver 12,000 behind in arrears
4. ACTION: Enter partner holding 40,000 in cash
5. ACTION: Confirm
   VERIFY: Opening balances accepted

**Assertions (post-test):**
- [ ] Billing periods land on the 12th (not the 15th) because original start date is preserved
- [ ] Driver arrears of 12,000 age from their real dates
- [ ] Opening balances appear in NO P&L — not as income, not as expense
- [ ] Cash position shows 40,000 correctly
- [ ] A statement starting before go-live shows a "brought forward" line

---

### EC-00-005: Change vehicle arrangement (UC-94)

**Priority:** P1
**Source:** UC-94, F-1.2
**Preconditions:** Vehicle exists with arrangement B (daily lease), no conflicting open items.

**Steps:**
1. ACTION: Navigate to vehicle detail page
2. ACTION: Click "Change Arrangement" or equivalent
3. ACTION: Select new arrangement: "Lease out" (Arrangement A)
4. ACTION: Set effective date: "2026-08-01"
   VERIFY: System lists what ends: "Daily cards will stop generating from 2026-08-01"
5. ACTION: Confirm the change
   VERIFY: Change recorded

**Assertions (post-test):**
- [ ] `VehicleArrangement` record created, effective-dated (never overwritten)
- [ ] History before the effective date keeps its old arrangement
- [ ] Reports for past months use the arrangement that was in force then
- [ ] Borne-by defaults for past months unchanged (§6.7)
- [ ] A report for a past month uses the OLD arrangement, not the current one

---

### EC-00-006: Revoke manager access — records persist

**Priority:** P1
**Source:** UC-03, F-1.4
**Preconditions:** Manager "Kamal" has manage rights on a vehicle.

**Steps (corrected 22 Aug 2026 — same relocation as HP-00-005/006):**
1. ACTION: Navigate to More → Vehicle sharing
2. ACTION: Find manager Kamal under "Management agreements" (status badge "Active") and tap Revoke
3. ACTION: Confirm in the "Revoke sharing?" dialog (confirm button "Revoke sharing")
   VERIFY: Kamal's badge now reads "Revoked"

**Assertions (post-test):**
- [ ] Manager access ended — Kamal cannot see or operate the vehicle
- [ ] All records Kamal entered remain in the system, attributed to him
- [ ] Records entered by Kamal are NOT deleted or orphaned

---

### EC-00-007: Vehicle calendar shows correct day states

**Priority:** P1
**Source:** UC-95, F-1.5
**Preconditions:** Vehicle BUS-5678 with daily lease, some days confirmed, a trip booked.

**Steps (corrected 22 Aug 2026 — exact current legend, `VehicleCalendarScreen.tsx`):**
1. ACTION: Navigate to vehicle BUS-5678 → Calendar view
   VERIFY: Month view loads with each day coloured by its derived state; the legend row below lists exactly: "On a lease", "Daily lease, ran", "Daily lease, not yet confirmed", "Daily lease, lost", "On a trip", "Hold (tentative)", "Off the road"
2. VERIFY: Confirmed days show the "Daily lease, ran" state (not the doc's old "ran")
3. VERIFY: Unconfirmed-but-due days show "Daily lease, not yet confirmed" (not "open" — that label doesn't exist)
4. VERIFY: Trip days show "On a trip", distinct from "Daily lease, ran"
5. VERIFY: A day with no state applied is simply blank (no "not scheduled" label exists — its absence of a badge is the signal)
6. ACTION: Click on a free (blank) day
   VERIFY: Opens the appropriate booking form (F-2.1 or F-5.1) with that date pre-filled

**Assertions (post-test):**
- [ ] Every day shows exactly ONE state (INV-1)
- [ ] A `hold` is visually distinct from a `booked` trip
- [ ] Calendar answers "is the bus free on the 12th" without opening the trip form
- [ ] Tapping a free day opens the correct form with the date filled in
