# Suite 06 — Financial Operations: Happy Path

**Phase:** 1
**Depends on:** Suite 00 (setup)
**Source:** UC-60–UC-67, UC-75, F-3.1, F-3.2, F-7.1–F-7.6

---

### HP-06-001: Record an expense with borne-by and paid-by

**Priority:** P0
**Source:** UC-60, F-3.1, §6.1, §6.7, W-48
**Preconditions:** Vehicle on a daily lease (arrangement B).

**Steps:**
1. ACTION: Navigate to vehicle → "Add Expense"
2. ACTION: Enter amount: 15,000
3. ACTION: Select category: "Tyres"
4. ACTION: Enter date: today
5. ACTION: Upload photo of invoice (optional)
   VERIFY: `paid_by` pre-filled as current user (U-3)
   VERIFY: `borne_by` pre-filled as "us" (§6.7 — tyres are ours on all arrangements)
6. ACTION: Click "Save"
   VERIFY: Expense recorded

**Assertions (post-test):**
- [ ] `Expense` with both `paid_by` and `borne_by` stored (INV-27)
- [ ] `borne_by = us` → expense IS in profit calculation
- [ ] §6.7 matrix reproduced: tyres/servicing are always ours regardless of arrangement
- [ ] Out-of-pocket: if paid_by ≠ the business, creates a reimbursement balance

---

### HP-06-002: Record a cost with no vehicle

**Priority:** P1
**Source:** UC-66, F-3.2, W-32
**Preconditions:** Business exists.

**Steps:**
1. ACTION: Navigate to "Add Expense" (from business level, not vehicle)
2. ACTION: Leave vehicle field BLANK
3. ACTION: Enter category: "Office rent"
4. ACTION: Enter amount: 25,000
5. ACTION: Save
   VERIFY: Cost saved with null vehicle_id

**Assertions (post-test):**
- [ ] `vehicle_id` is null, `business_id` is NOT null (INV-24)
- [ ] Cost appears in a SEPARATE block beneath per-vehicle totals
- [ ] Cost is NEVER spread across vehicles
- [ ] Consolidated vehicle profit reads as vehicle profit; business profit stated beneath after overheads

---

### HP-06-003: Bank cash — move held cash to account

**Priority:** P1
**Source:** UC-65, F-7.4, W-27
**Preconditions:** Partner holding cash (e.g., 40,000 from collections).

**Steps:**
1. ACTION: Navigate to Cash → "Bank Cash"
2. ACTION: Select partner: "Chaminda"
3. ACTION: Enter amount: 40,000
4. ACTION: Enter account/destination reference
5. ACTION: Click "Bank"
   VERIFY: Held cash reduced by 40,000

**Assertions (post-test):**
- [ ] Cash moved from "held by partner" to "in account"
- [ ] The word "deposit" is NOT used for this (W-27 — reserved for security deposits)
- [ ] Cash position report updated

---

### HP-06-004: View cash position report

**Priority:** P1
**Source:** UC-75, F-7.5
**Preconditions:** Various cash movements in the system.

**Steps:**
1. ACTION: Navigate to Reports → "Cash Position"
   VERIFY: Shows cash held by each partner
   VERIFY: Shows cash in accounts
   VERIFY: Shows driver advances (money out, to reconcile)
   VERIFY: Driver advances shown, but NOT driver arrears or fares (UC-75)

**Assertions (post-test):**
- [ ] Cash position includes: held by partner + in accounts + driver advances
- [ ] Cash position does NOT include driver arrears (that's a receivable)
- [ ] Cash position does NOT include driver fares (those were never ours — W-1)

---

### HP-06-005: Vehicle monthly P&L

**Priority:** P1
**Source:** UC-70, F-7.1, F-9.2
**Preconditions:** Month with income and expenses.

**Steps:**
1. ACTION: Navigate to vehicle → "This Month" report
   VERIFY: Shows:
   - Income: rent by billing period, daily amounts by day, trips by closing date
   - Costs: only borne_by = us
   - Profit: income - costs
2. VERIFY: Below-the-line costs visible but NOT in profit
3. VERIFY: Deposits, advances, pending recoveries, opening balances EXCLUDED

**Assertions (post-test):**
- [ ] Income matches expectations
- [ ] INV-5: Below-the-line costs not in profit
- [ ] INV-4: Deposits and advances excluded
- [ ] INV-30: Trip income in closing month only

---

### HP-06-006: Partner settlement — who owes whom

**Priority:** P1
**Source:** UC-63, F-7.2
**Preconditions:** Month closed or reviewed, two partners with shares.

**Steps:**
1. ACTION: Navigate to "Settle with Partner"
   VERIFY: Shows per vehicle: earned, costs, net, each partner's share
   VERIFY: Shows amounts held by each, amounts owed to/from each

**Assertions (post-test):**
- [ ] Shares calculated from effective-dated ownership (INV-16)
- [ ] Management fee appears correctly (W-53)
- [ ] Settlement amounts are clear and actionable

---

### HP-06-007: Partner current account — contribution vs share gap

**Priority:** P1
**Source:** UC-67, F-7.6, W-52
**Preconditions:** Partners with different contribution-to-share ratios (e.g., Nimesha paid 1.8M for 60%, Chaminda paid 1.2M for 40%, but ratios differ from shares).

**Steps:**
1. ACTION: Navigate to partner current account view
   VERIFY: Shows: what each put in vs what they own
   VERIFY: Gap = current account balance (not an adjustment to profit split)

**Assertions (post-test):**
- [ ] Gap persists permanently without nagging (UC-02)
- [ ] W-52: The gap is an amount OWED BACK, not an adjustment to profit share
- [ ] Profit split is based on ownership shares, NOT on contributions
