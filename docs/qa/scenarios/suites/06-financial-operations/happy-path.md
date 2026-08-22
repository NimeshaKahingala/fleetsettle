# Suite 06 — Financial Operations: Happy Path

**Phase:** 1
**Depends on:** Suite 00 (setup)
**Source:** UC-60–UC-67, UC-75, F-3.1, F-3.2, F-7.1–F-7.6

---

### HP-06-001: Record an expense with borne-by and paid-by

**Priority:** P0
**Source:** UC-60, F-3.1, §6.1, §6.7, W-48
**Preconditions:** Vehicle on a daily lease (arrangement B).

**Steps (corrected 22 Aug 2026 — sheet is "Record expense", not "Add Expense"):**
1. ACTION: Quick Add → Expense, or from the vehicle → "Record expense" (`RecordExpenseSheet.tsx`)
2. ACTION: Enter "Amount": 15,000 (level 1, first field)
3. ACTION: Choose "Vehicle" (pre-filled if opened from a vehicle)
4. ACTION: Select category: "Tyres"
5. ACTION: Enter "Date": today
6. ACTION: Optional note/photo — verify at test time exactly which optional fields this sheet carries
   VERIFY: `paid_by` pre-filled as current user (U-3)
   VERIFY: `borne_by` pre-filled as "us" (§6.7 — tyres are ours on all arrangements)
7. ACTION: Click "Record expense" (not "Save")
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

**Steps (corrected 22 Aug 2026):**
1. ACTION: Open "Record expense" from business level (not a vehicle)
2. ACTION: Leave "Vehicle" blank — the field's own caption reads "Optional — leave blank for a cost with no vehicle (UC-66)"
3. ACTION: Enter category: "Office" (not "Office rent" — that category doesn't exist; `EXPENSE_CATEGORY_LABEL` has no rent-specific entry)
4. ACTION: Enter "Amount": 25,000
5. ACTION: Click "Record expense"
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

**Steps (corrected 22 Aug 2026 — screen is titled "Cash", action "Record banking", with a real recorded-vs-counted distinction the doc didn't have):**
1. ACTION: Navigate to "Cash" (not "Cash → 'Bank Cash'" — there's one action, not a sub-page)
2. ACTION: Click "Record banking" (screen's own action button)
3. ACTION: Enter "Recorded amount" 40,000 and "Counted amount" (a real cash-count reconciliation step — verify at test time whether these can differ and what happens if they do)
4. ACTION: Enter "Destination" (required) and optional "Reference"
5. ACTION: Click "Save banking" (not "Bank")
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

**Steps (corrected 22 Aug 2026 — report is titled "Where is our cash", not "Cash Position"):**
1. ACTION: Navigate to Reports → "Where is our cash"
   VERIFY: Shows cash held by each partner (per-partner StatTile)
   VERIFY: Shows cash in accounts
   VERIFY: Shows driver advances under "With drivers, as advances" (or "No advances outstanding" if none)
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

**Steps (corrected 22 Aug 2026 — report is titled "How was this month", tiles "Earned"/"Spent"/"Profit"):**
1. ACTION: Navigate to vehicle → "How was this month"
   VERIFY: Shows:
   - "Earned": rent by billing period, daily amounts by day, trips by closing date
   - "Spent": only borne_by = us
   - "Profit": Earned - Spent
2. VERIFY: **No below-the-line costs section exists** (see invariants/invariant-checks.md INV-5) — borne-by-driver costs are simply absent from "Spent", not shown separately
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

**Steps (corrected 22 Aug 2026 — no "Settle with Partner" screen exists; the real screen is "Partner money" (`PartnerDetailScreen.tsx`), and it has no per-vehicle breakdown table):**
1. ACTION: Navigate to the partner's own "Partner money" screen (More → Vehicle sharing, or wherever partner detail is reached — not independently re-verified in this pass)
   VERIFY: A "Balance" tile plus rows: "Contributions", "Out of pocket", "Payouts", "Settlements", "Profit share", "Management fee", "Holding" — **not** a per-vehicle earned/costs/net/share table as originally described
2. ACTION: To record a settlement, use "Partner payout" — it has a Payout/Settlement toggle ("Settlement" is one of its two `kind` options), not a separate "Settle with Partner" flow

**Assertions (post-test):**
- [ ] Shares calculated from effective-dated ownership (INV-16) — presumably still true of the backend figures, not independently re-verified in this pass
- [ ] Management fee appears correctly (W-53) — shown as its own row
- [ ] **Corrected expectation**: settlement amounts are a business-wide summary per partner, not broken out per vehicle the way this case originally expected

---

### HP-06-007: Partner current account — contribution vs share gap

**Priority:** P1
**Source:** UC-67, F-7.6, W-52
**Preconditions:** Partners with different contribution-to-share ratios (e.g., Nimesha paid 1.8M for 60%, Chaminda paid 1.2M for 40%, but ratios differ from shares).

**Steps (corrected 22 Aug 2026 — no separate "current account" screen exists; this is the same "Partner money" screen HP-06-006 uses, not a distinct destination):**
1. ACTION: Navigate to the partner's own "Partner money" screen
   VERIFY: The "Balance" tile is this gap — what they've put in (Contributions + Out of pocket) minus what they've taken out (Payouts + Settlements), against their earned Profit share — not a screen labelled "current account" anywhere in the UI, though the underlying concept (W-52) presumably still holds in how "Balance" is computed

**Assertions (post-test):**
- [ ] Gap persists permanently without nagging (UC-02)
- [ ] W-52: The gap is an amount OWED BACK, not an adjustment to profit share
- [ ] Profit split is based on ownership shares, NOT on contributions
