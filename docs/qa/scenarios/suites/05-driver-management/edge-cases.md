# Suite 05 — Driver Management & Balances: Edge Cases

**Phase:** 1
**Source:** A-8, A-15, A-22, INV-3, INV-4, INV-27, W-2, W-48

---

### EC-05-001: Dual balances never auto-merge (INV-3)

**Priority:** P1
**Source:** INV-3, W-2
**Preconditions:** Driver with both balances non-zero.

**Steps:**
1. ACTION: Record a daily payment (reduces "he owes you")
   VERIFY: "You owe him" did NOT change
2. ACTION: Record a trip fee payment (reduces "you owe him")
   VERIFY: "He owes you" did NOT change
3. ACTION: Check for any automatic netting
   VERIFY: None exists — only explicit Offset moves both

**Assertions (post-test):**
- [ ] INV-3: No operation moves both balances except Offset with date, amount, actor

---

### EC-05-002: Driver quits owing more than deposit (A-8)

**Priority:** P1
**Source:** A-8, UC-90, INV-15
**Preconditions:** Driver owes 30,000 in arrears, holds 25,000 deposit.

**Steps (corrected 22 Aug 2026):**
1. ACTION: Navigate to driver detail, Driver actions → "Record deposit movement" (`DepositMovementSheet.tsx`, title "Record deposit movement")
2. ACTION: Choose "Movement": "Apply to arrears" (exact option — this exists, contrary to an earlier pass of this refresh that assumed it didn't); enter the arrears due and amount 25,000
   VERIFY: Arrears reduced to 5,000
3. ACTION: Driver actions → "Write off balance" (sheet title "Write off balance", not "Write off"): enter "Amount" 5,000, "Reason", "Written off on"
   VERIFY: Click "Write off" (the sheet's own submit label) — write-off recorded with amount, reason, party
4. ACTION: Verify recovery link retained
   VERIFY: If he pays later, it is a recovery against the write-off (INV-15)

**Assertions (post-test):**
- [ ] Deposit applied deliberately, not automatically
- [ ] Write-off is a LOSS, separate from waivers (INV-14)
- [ ] Recovery link retained in case he pays later
- [ ] Written-off customer/driver who returns shows the history

---

### EC-05-003: Same driver has shortfall days and unpaid charter fee (A-15)

**Priority:** P1
**Source:** A-15, INV-3
**Preconditions:** Driver with 6 shortfall days (6 × 5,000 = 30,000 shortfall but some paid, net owing 12,000) AND unpaid charter fee of 9,000.

**Steps:**
1. ACTION: Navigate to driver balance view
   VERIFY: "He owes you: 12,000" and "You owe him: 9,000"
2. VERIFY: Net shown but NOT applied
3. ACTION: Verify no automatic offset occurred

**Assertions (post-test):**
- [ ] Both balances exist simultaneously — he is debtor AND creditor
- [ ] Only an explicit Offset merges them

---

### EC-05-004: Driver deposit is never income (INV-4)

**Priority:** P1
**Source:** INV-4, W-8
**Preconditions:** Driver deposit of 25,000 recorded.

**Steps (corrected 22 Aug 2026 — exact report names):**
1. ACTION: Navigate to "How was this month" for the vehicle
   VERIFY: 25,000 deposit NOT in the "Earned"/"Spent" tiles
2. ACTION: Navigate to "How was the year" (owner-only)
   VERIFY: 25,000 deposit NOT in income
3. ACTION: Navigate to "Where is our cash"
   VERIFY: 25,000 IS shown

**Assertions (post-test):**
- [ ] INV-4: Deposit never appears as income, in any period, in any report

---

### EC-05-005: Unlink driver — access ends, history persists

**Priority:** P2
**Source:** UC-07, W-13
**Preconditions:** Driver linked and has view-only access.

**Steps (corrected 22 Aug 2026):**
1. ACTION: Navigate to driver → "Unlink account?" (dialog title; trigger action itself not independently re-verified, likely "Unlink" on driver detail)
2. ACTION: Confirm — button reads "Unlink account" (not a separate "Confirm unlink")
   VERIFY: Driver's app access ends
3. VERIFY: Driver's record, history, balances all intact
4. ACTION: Navigate to driver detail as manager
   VERIFY: All historical data still present, attributed to the driver

**Assertions (post-test):**
- [ ] Access revoked — driver can no longer log in to see his data
- [ ] Record and history completely untouched
- [ ] **Not built (as of 22 Aug 2026)**: "he gets the printed slip instead" — no printed-slip feature exists anywhere in the client; see HP-05-006's own note on this, including the discrepancy with `docs/README.md`'s status table

---

### EC-05-006: Manager pays driver fuel on lease day — borne-by vs paid-by (A-22)

**Priority:** P1
**Source:** A-22, W-48, INV-27
**Preconditions:** Bus on daily lease (arrangement B), manager pays for driver's fuel out of own pocket.

**Steps:**
1. ACTION: Record fuel expense: 8,500
2. ACTION: Set paid_by: "Chaminda" (the manager)
3. ACTION: Set borne_by: "driver" (W-7 default for arrangement B fuel)
4. ACTION: Save
   VERIFY: Both fields saved independently

**Assertions (post-test):**
- [ ] INV-27: borne_by and paid_by are separate fields, NOT derived from each other
- [ ] The cost stays OUT of profit (borne by driver — INV-5)
- [ ] The business now OWES the manager 8,500 (out-of-pocket, UC-60)
- [ ] Both facts coexist: it's a driver cost AND the business owes the manager
