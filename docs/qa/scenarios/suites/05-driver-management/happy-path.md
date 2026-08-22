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

**Steps:**
1. ACTION: Navigate to driver → "Pay Driver"
2. ACTION: Select the trip fee due: 9,000
3. ACTION: Confirm payment amount: 9,000
4. ACTION: Click "Pay"
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

**Steps:**
1. ACTION: Navigate to driver balance view
2. ACTION: Click "Offset"
   VERIFY: Offset form shows: applying 2,000 from arrears against the 9,000 owed
3. ACTION: Confirm offset
   VERIFY: Both balances updated:
   - "He owes you: 0"
   - "You owe him: 7,000"
4. ACTION: Hand him 7,000 and record payment

**Assertions (post-test):**
- [ ] `Offset` record created with date, amount (2,000), actor
- [ ] INV-3: Both balances moved — but only via Offset
- [ ] Deposit NOT touched (it is never a debt-collection tool unless he leaves)

---

### HP-05-004: Record driver deposit

**Priority:** P1
**Source:** UC-58, W-8
**Preconditions:** Driver record exists.

**Steps:**
1. ACTION: Navigate to driver → "Record Deposit"
2. ACTION: Enter amount: 25,000
3. ACTION: Click "Save"
   VERIFY: Deposit recorded as "held"

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

**Steps:**
1. ACTION: Navigate to driver's page
2. ACTION: Click "Link Account"
3. ACTION: System generates a linking code
   VERIFY: Code displayed to manager
4. ACTION: (As driver) Enter the code at sign-up
   VERIFY: Driver's view opens — read-only

**Assertions (post-test):**
- [ ] Linking is manager-initiated only (W-42)
- [ ] Driver sees: his balance, his past payments, his statement, his excused days
- [ ] Driver can NEVER enter data (W-3)
- [ ] INV-25: Driver cannot see other drivers' data

---

### HP-05-006: Driver statement / printed slip

**Priority:** P2
**Source:** UC-57, F-6.6
**Preconditions:** Driver with transaction history.

**Steps:**
1. ACTION: Navigate to driver → "Statement" or "Print Slip"
   VERIFY: Shows: days run, amounts owed, payments, arrears, trips, fees
2. ACTION: Click "Share"
   VERIFY: Shareable via an expiring signed link

**Assertions (post-test):**
- [ ] Statement content matches driver's actual record
- [ ] Shareable without requiring the driver to have an app account

---

### HP-05-007: Record a driver payment not tied to a trip

**Priority:** P1
**Source:** UC-50, W-34
**Preconditions:** Driver exists.

**Steps:**
1. ACTION: Navigate to driver → "Pay Driver"
2. ACTION: Select "Not tied to any trip"
3. ACTION: Enter amount: 5,000
4. ACTION: Enter note: "Retainer during repair downtime"
5. ACTION: Save
   VERIFY: Payment recorded

**Assertions (post-test):**
- [ ] Payment recorded without a trip reference (W-34)
- [ ] Keeps a good driver through weeks of repair without inventing a fake trip

---

### HP-05-008: Record driver advance for road expenses

**Priority:** P1
**Source:** UC-50, §6.13
**Preconditions:** Trip about to start.

**Steps:**
1. ACTION: Navigate to driver or trip → "Record Advance"
2. ACTION: Enter amount: 5,000
3. ACTION: Save
   VERIFY: Advance recorded as money to reconcile

**Assertions (post-test):**
- [ ] Advance is NOT a payment of his fee
- [ ] Advance is NOT income (INV-4)
- [ ] Advance appears in cash position as held money
- [ ] Must be reconciled before trip can close (INV-17)
