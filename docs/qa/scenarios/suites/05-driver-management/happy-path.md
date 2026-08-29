# Suite 05 — Driver Management & Balances: Happy Path

**Phase:** 1
**Depends on:** Suite 02 (daily lease), Suite 03 (trips)
**Source:** UC-50–UC-59, F-6.1–F-6.8

---

### HP-05-001: View driver's two balances — owes and owed

**Priority:** P0
**Source:** UC-56, F-6.1, W-2, §6.4
**Preconditions:** Driver Ruwan with arrears (he owes 2,000) and unpaid trip fee (you owe 9,000).

**Steps:**
1. ACTION: Navigate to Driver → Ruwan Jayasinghe
   VERIFY: Balance section shows TWO separate figures:
   - "He owes you: 2,000"
   - "You owe him: 9,000"
   VERIFY: Net displayed as information: "Net: you owe him 7,000"
2. VERIFY: An "Offset" button is available

**Assertions (post-test):**
- [ ] INV-3: Two balances shown separately
- [ ] Net is informational, not applied automatically
- [ ] W-2: The same person is both debtor and creditor

---

### HP-05-002: Pay driver his trip fee

**Priority:** P0
**Source:** UC-50, F-6.2
**Preconditions:** Driver owed 9,000 for a trip.

**Steps (corrected 22 Aug 2026 — `PayDriverSheet.tsx` is Amount + Date only; there is no trip-fee picker or per-due selection anywhere on it):**
1. ACTION: Navigate to driver → Driver actions → "Pay the driver"
2. ACTION: Enter "Amount": 9,000, "Date": today
3. ACTION: Click "Pay driver" (not "Pay")
   VERIFY: "You owe him" balance reduces to 0

**Assertions (post-test):**
- [ ] Payment recorded against the trip fee
- [ ] "He owes you" balance UNCHANGED (INV-3)
- [ ] Driver payment notification can be triggered (UC-84)

---

### HP-05-003: Offset driver balances — explicit recorded action

**Priority:** P0
**Source:** UC-56, F-6.3, INV-3
**Preconditions:** Driver owes 2,000, you owe 9,000.

**Steps (corrected 22 Aug 2026 — `OffsetSheet.tsx` doesn't pre-compute or preview the offset; you enter the amount yourself):**
1. ACTION: Navigate to driver balance view, click "Offset…" (`TwoBalances`'s own button, with an ellipsis)
2. ACTION: Enter "Amount": 2,000, "Date", optional "Note" — **no automatic preview of "applying 2,000 against 9,000 owed"** exists; the manager is trusted to enter the right figure
3. ACTION: Click "Record offset" (not "Confirm offset")
   VERIFY: Both balances updated:
   - "He owes you: 0"
   - "You owe him: 7,000"
4. ACTION: Hand him 7,000 and record payment separately (via "Pay the driver", HP-05-002)

**Assertions (post-test):**
- [ ] `Offset` record created with date, amount (2,000), actor
- [ ] INV-3: Both balances moved — but only via Offset
- [ ] Deposit NOT touched (it is never a debt-collection tool unless he leaves)

---

### HP-05-004: Record driver deposit

**Priority:** P1
**Source:** UC-58, W-8
**Preconditions:** Driver record exists.

**Steps (corrected 22 Aug 2026):**
1. ACTION: Navigate to driver → Driver actions → "Record a deposit" (sentence case, not "Record Deposit")
2. ACTION: Enter "Amount": 25,000, "Date"
3. ACTION: Click "Record deposit" (not "Save")
   VERIFY: Deposit recorded as held

**Assertions (post-test):**
- [ ] Deposit is money you HOLD — a liability, never income (W-8)
- [ ] INV-4: Deposit never appears in income or any P&L
- [ ] Deposit visible in cash position (UC-75)
- [ ] Never silently netted against arrears

---

### HP-05-005: Give driver view-only access via linking code

**Priority:** P1
**Source:** UC-07, F-1.8, W-13, W-42
**Preconditions:** Driver record exists, driver has created his own profile.

**Steps (corrected 22 Aug 2026):**
1. ACTION: Navigate to driver's page
2. ACTION: Click "Create account link" (not "Link Account")
3. ACTION: System generates a code, labelled "Invite code" (not "linking code")
   VERIFY: Code displayed to manager
4. ACTION: (As driver) Enter the code at sign-up
   VERIFY: Driver's own "Mine" shell opens — read-only

**Assertions (post-test):**
- [ ] Linking is manager-initiated only (W-42)
- [ ] Driver sees: his balance, his past payments, his statement, his excused days
- [ ] Driver can NEVER enter data (W-3)
- [ ] INV-25: Driver cannot see other drivers' data

---

### HP-05-006: Driver statement / printed slip

**Priority:** P2
**Source:** UC-57, F-6.6
**Preconditions:** Driver with transaction history (a mix of confirmed days, at least one advance, at least one offset).

**Built 27 Aug 2026 (GAP-170, PR #143).** `DriverDetailScreen`'s "Driver actions" sheet now carries a "View statement" entry (`DriverStatementScreen.tsx`), reusing the same `TwoBalances`/`DriverActivitySections` read-only components the driver's own `MineScreen` shell already uses, over the existing `driver-view`/`driver` reads — no new backend surface. Deliberately still behind the ordinary login boundary (the no-login share link is GAP-65, still phase 2) — this replaces the previous "not built" finding, not the share-link deferral.

**Steps:**
1. ACTION: Navigate to a driver's detail page as manager/owner.
2. ACTION: Open "Driver actions" → "View statement".
   VERIFY: `Screen` title reads "Statement"; the driver's name and "Driver statement" print heading render above `TwoBalances`.
3. VERIFY: `ReportDateRangeFields` default to the last 30 days ending today (business timezone); the two balance figures and the activity sections (days, trips, advances, offsets) match the driver's own detail page for the same window.
4. ACTION: Adjust the date range (e.g. widen to 60 days or a specific past month).
   VERIFY: Figures and activity list refresh for the new range; the printed heading's date range text updates to match.
5. ACTION: Press "Print" (the screen's primary action, only present once all three reads have resolved).
   VERIFY: The browser print dialog opens; in the print preview, `Screen`'s own chrome (app bar, date-range controls, back button) is hidden — only the driver name/heading, the two balances and the full (non-collapsed) activity sections appear inside `.print-area`.
6. VERIFY: If any activity section normally collapses after 3 rows (`Section`'s default), the statement/print view shows every row — `forceExpanded` on `DriverActivitySections` (a print stylesheet can only show/hide what's already in the DOM, so a statement with more than 3 days/trips/advances/offsets must not silently truncate).

**Assertions (post-test):**
- [ ] "View statement" reaches the statement without requiring the driver to be linked to an app account — this is the manager-facing route, not `MineScreen`
- [ ] Every figure on the statement is read-only — no write control anywhere on this screen
- [ ] The date range is adjustable, not hardcoded to 30 days (UC-57: "at settlement," which differs by driver)
- [ ] Nothing overflows or truncates in the print preview even with more than 3 rows in a section
- [ ] The no-login share link (GAP-65) is still absent — this case is scoped to the logged-in "View statement" route only, not a substitute for checking GAP-65 stays phase-2-deferred

---

### HP-05-007: Record a driver payment not tied to a trip

**Priority:** P1
**Source:** UC-50, W-34
**Preconditions:** Driver exists.

**Steps (corrected 22 Aug 2026 — this is not a distinct choice from HP-05-002; `PayDriverSheet.tsx` never references a trip at all, so every payment through it is already "not tied to any trip"):**
1. ACTION: Navigate to driver → Driver actions → "Pay the driver"
2. ACTION: Enter "Amount": 5,000, "Date"
   VERIFY: **No "Not tied to any trip" option and no note field exist** — this sheet is identical to HP-05-002's; the distinction this case originally tested doesn't exist as a UI choice
3. ACTION: Click "Pay driver"
   VERIFY: Payment recorded

**Assertions (post-test):**
- [ ] Payment recorded without a trip reference (W-34) — true by construction, since the sheet carries no trip reference at all
- [ ] Keeps a good driver through weeks of repair without inventing a fake trip

---

### HP-05-008: Record driver advance for road expenses

**Priority:** P1
**Source:** UC-50, §6.13
**Preconditions:** Trip about to start.

**Steps (corrected 22 Aug 2026):**
1. ACTION: Navigate to driver → Driver actions → "Record an advance" (or from a booked trip's own detail, "Advance to him" → "Record advance" — title reads "Record trip advance" there, see suite 03 HP-03-006)
2. ACTION: Enter "Amount": 5,000, "Date"
3. ACTION: Click "Record advance"
   VERIFY: Advance recorded as money to reconcile

**Assertions (post-test):**
- [ ] Advance is NOT a payment of his fee
- [ ] Advance is NOT income (INV-4)
- [ ] Advance appears in cash position as held money
- [ ] Must be reconciled before trip can close (INV-17)
