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
- [ ] Expense record has `accounting_period_id` = August
- [ ] Expense record has `belongs_to_period` = July (back-reference)
- [ ] INV-10: Closed July period is completely unchanged

---

### HP-08-004: Vehicle monthly report

**Priority:** P1
**Source:** UC-70, F-9.2
**Preconditions:** Vehicle with rent, daily amounts, trips.

**Steps (corrected 22 Aug 2026):**
1. ACTION: Navigate to vehicle → "How was this month" (not "This Month")
   VERIFY: Shows rent by billing period
   VERIFY: Shows daily amounts by day
   VERIFY: Shows trips by closing date
   VERIFY: **No below-the-line costs section exists** — borne-by-driver costs are silently absent from "Spent", not shown as a visible separate line (see invariants/invariant-checks.md INV-5)

**Assertions (post-test):**
- [ ] Matches requirements in F-9.2 matrix (UC-70 row)

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
