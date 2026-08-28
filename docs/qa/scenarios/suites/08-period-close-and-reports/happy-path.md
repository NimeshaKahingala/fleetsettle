# Suite 08 — Period Close & Reports: Happy Path

**Phase:** 1
**Depends on:** Suite 01 (arrangement A), Suite 02 (arrangement B), Suite 03 (arrangement C)
**Source:** UC-70–UC-79, UC-98, UC-99, F-9.1–F-9.3

---

### HP-08-001: Close the month — pre-close checklist

**Priority:** P0
**Source:** UC-98, F-9.1 step 1, U-7
**Preconditions:** Open accounting period (July), containing some unconfirmed days, open trips, and dues with no decision.

**Steps (corrected 22 Aug 2026 — screen is "Close the month"; there is no "Proceed to Close anyway" button, only one action):**
1. ACTION: Navigate to "Close the month" (July)
   VERIFY: Pre-close checklist is displayed
2. VERIFY: Checklist reads (exact current labels): "Days not yet confirmed", "Trips still open", "Advances not yet closed", "Dues still outstanding", "Incidents still open"
3. ACTION: Click "Close this month" directly — **there is no separate "Proceed anyway" confirmation**; the checklist is purely informational and never disables this action
   VERIFY: Checklist does NOT block the close (U-7) — only warns and lists

**Assertions (post-test):**
- [ ] Checklist is informational, not a hard block
- [ ] The ONLY hard block is if closing would leave money unaccounted for

---

### HP-08-002: Period close creates successor period

**Priority:** P0
**Source:** UC-98, F-9.1, W-35
**Preconditions:** July is the open period, August does not exist yet.

**Steps:**
1. ACTION: Complete the month close for July
2. ACTION: Confirm close
   VERIFY: July status becomes `closed` (read-only)
   VERIFY: August period is created with status `open`

**Assertions (post-test):**
- [ ] Both changes happen in the SAME transaction
- [ ] Cannot close without creating successor
- [ ] The open period is always available for late facts (W-35)

---

### HP-08-003: Late fact posts to open period with back-reference

**Priority:** P0
**Source:** W-35, INV-10, F-8.1
**Preconditions:** July is closed, August is open. A late repair invoice for July arrives today.

**Steps:**
1. ACTION: Navigate to vehicle
2. ACTION: "Record expense" (not "Add Expense")
3. ACTION: Enter date: "2026-07-28" (a date in the closed period)
4. ACTION: Enter amount: 15,000
5. ACTION: Save
   VERIFY: System detects the date falls in a closed period
   VERIFY: System posts it to the CURRENT open period (August)

**Assertions (post-test):**
- [ ] Expense record has `posted_period_id` = August
- [ ] Expense record has `belongs_to_period_id` = July (back-reference)
- [ ] INV-10: Closed July period is completely unchanged
- [ ] **Record-level display (GAP-173, closed 24 Aug 2026):** the CSV export's "Belongs to" column, and the expense's own inline display wherever it's shown on an incident/trip screen, both read July — the record itself never looks like an ordinary August entry
- [ ] **Aggregate display (GAP-188, closed 26 Aug 2026):** August's own vehicle-month report (HP-08-004) lists this expense as its own dated, labelled line under the vehicle's costs — not folded silently into August's `costsMinor` with no trace

---

### HP-08-004: Vehicle monthly report

**Priority:** P1
**Source:** UC-70, F-9.2
**Preconditions:** Vehicle with rent, daily amounts, trips.

**Steps (corrected 28 Aug 2026 — GAP-188, closed 26 Aug 2026, added the late-fact list this case didn't cover before):**
1. ACTION: Navigate to vehicle → "How was this month" (not "This Month")
   VERIFY: Shows rent by billing period
   VERIFY: Shows daily amounts by day
   VERIFY: Shows trips by closing date
   VERIFY: **No below-the-line costs section exists** — borne-by-driver costs are silently absent from "Spent", not shown as a visible separate line (see invariants/invariant-checks.md INV-5)
2. ACTION: Expand a vehicle row that has at least one late-posted fact for this month (see HP-08-003 — a fact whose `belongs_to_period_id` differs from the report's own month).
   VERIFY: Below "Earned"/"Spent", a separate list appears — each late fact shown as its own line with a "Belongs to {month}" badge and its amount, coloured brand (earned) or direction-payable (spent) matching the Earned/Spent markers above it.
   VERIFY: The late fact's amount is **already counted inside** "Earned"/"Spent" above — the list is a label on an existing total's own input, not an addition to it (confirm the total does not double when the fact is present vs a control vehicle with none).
3. ACTION: Expand a vehicle row with **no** late facts for the month.
   VERIFY: No late-facts list renders at all — not an empty section, absent entirely.

**Assertions (post-test):**
- [ ] Matches requirements in F-9.2 matrix (UC-70 row)
- [ ] A late fact never changes the vehicle's own `earnedMinor`/`costsMinor`/`profitMinor` totals — only labels one of their existing inputs (GAP-188's own scope: "not a second way of computing them")
- [ ] The late-facts list is absent, not empty, for a vehicle with nothing late this month

---

### HP-08-005: Lost days report

**Priority:** P1
**Source:** UC-76, F-9.2
**Preconditions:** Bus with 4 lost days out of 28 pattern days, daily rate 5,000.

**Steps:**
1. ACTION: Navigate to Reports → "Lost days" (lowercase d)
   VERIFY: Shows 4 lost days
   VERIFY: Calculates value: 4 × 5,000 = 20,000
   VERIFY: Denominator shows 28 (ran + lost)

**Assertions (post-test):**
- [ ] Values match G-1 fixture expectations
- [ ] Denominator excludes not-scheduled and charter days

---

### HP-08-006: Cash position report

**Priority:** P1
**Source:** UC-75, F-9.2
**Preconditions:** Cash held by partners and driver advances.

**Steps:**
1. ACTION: Navigate to Reports → "Where is our cash" (not "Cash Position")
   VERIFY: Shows cash held by partner and account
   VERIFY: Shows driver advances under "With drivers, as advances"

**Assertions (post-test):**
- [ ] Arrears (money owed) and driver fares are NOT included

---

### HP-08-007: Who owes us report

**Priority:** P1
**Source:** UC-74, F-9.2
**Preconditions:** Unpaid rent, unpaid trips, post-closure charges.

**Steps:**
1. ACTION: Navigate to Reports → "Who owes us" (lowercase, not "Who Owes Us")
   VERIFY: Shows customers, drivers, trip balances, post-closure charges

**Assertions (post-test):**
- [ ] Excludes write-offs
- [ ] This is the receivables view

---

### HP-08-008: Trip profitability ranking

**Priority:** P2
**Source:** UC-71, F-9.2
**Preconditions:** Closed trips.

**Steps:**
1. ACTION: Navigate to Reports → "Which trips made money" (not "Trip Profitability")
   VERIFY: Shows profit and profit per km (if odometer exists)

**Assertions (post-test):**
- [ ] If no closing odometer, trip leaves the ranking rather than ranking at zero (degradation rule)

---

### HP-08-009: Export transactions to CSV

**Priority:** P2
**Source:** UC-99, F-9.3
**Preconditions:** Data exists. Owner logged in.

**Steps (corrected 22 Aug 2026):**
1. ACTION: Navigate to Reports → "Export transactions (CSV)" (exact catalogue label — owner-only)
2. ACTION: Request full year export
   VERIFY: CSV file generated containing all transactions

**Assertions (post-test):**
- [ ] Respects permissions (driver cannot do this)

---

### HP-08-010: Distributable cash report — "What can we safely take out"

**Priority:** P1
**Source:** UC-109, UC-67, W-70
**Preconditions:** Business with cash on hand, at least one held deposit, and at least one open vehicle loan with a set monthly instalment (GAP-185/GAP-186, both closed 25 Aug 2026).

**Steps:**
1. ACTION: Navigate to Reports catalogue.
   VERIFY: "What can we safely take out" card is present — a `PiggyBank`-iconed catalogue card, not gated to owners: a manager account (`viewReports`) sees it too (W-70).
2. ACTION: Open the report.
   VERIFY: Four tiles — "Cash on hand and in bank", "Held as deposits", "Loan instalments due", and a hero-sized "Safe to take out".
3. VERIFY (cross-check against Neon, read-only): "Cash on hand and in bank" already includes deposit cash folded in (not just ordinary `payment` rows — deposits write only `deposit`/`deposit_movement`, never `payment`), matching UC-109's own "true physical total" framing — this was a real bug (part of GAP-186's own PR review) before the fix.
4. VERIFY: `distributableMinor` = cash on hand − held deposits − loan instalments due, arithmetically, when all three inputs are present.

**Assertions (post-test):**
- [ ] Manager role can reach and read this report, not just owner (W-70) — recording a `partner_payout` off the back of it stays owners-only, but reading the figure does not
- [ ] "Cash on hand and in bank" is the true physical total including deposit cash, not payment-only
- [ ] "Loan instalments due" and "Safe to take out" both degrade to `NotAvailable` **together** — never a fabricated 0 — whenever any open loan has no monthly instalment figure set (W-56: "the single most expensive wrong number... because someone acts on it by moving money")
- [ ] With no loans at all, both figures should compute normally (an empty loan set is not the same as an unset instalment)

---

### HP-08-011: Vehicle loans — backend-only, no client screen (GAP-185)

**Priority:** P3
**Source:** UC §9.1, F-12
**Preconditions:** None — this case documents an absence, kept so the catalogue doesn't silently assume coverage exists.

**Not built as a browser flow (as of 28 Aug 2026), by design.** GAP-185 (closed 25 Aug 2026) shipped `vehicle_loan`/`loan_payment`, amortisation, proportional split, final-payment true-up, settle-and-close and cumulative arrears — but scoped explicitly "backend only — no client screen," proven only via 13 integration tests and the golden fixtures, not through the UI. A live browser pass cannot exercise loan creation, payment recording, or settlement — only its downstream effect is reachable in the browser, via HP-08-010's "Loan instalments due"/"Safe to take out" tiles on the distributable-cash report.

**Steps:** none — kept as a description of what to expect (and not to search for) rather than a runnable case.

**Assertions (post-test):**
- [ ] No "Loan"/"Vehicle loan" action exists anywhere in the client — confirm this is still true rather than assumed, since a client build could add one without this catalogue being told
- [ ] The only browser-reachable evidence a loan exists at all is its effect on the distributable-cash report's two loan-dependent tiles (HP-08-010)
