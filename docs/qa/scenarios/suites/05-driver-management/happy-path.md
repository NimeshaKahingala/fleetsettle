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
**Preconditions:** Driver with transaction history.

**Not built (as of 22 Aug 2026) — and worth flagging as a discrepancy, not just a gap.** No "Statement"/"Print Slip"/"Share" action, screen, or route exists anywhere in `web/src`, and no "slip"-named endpoint exists in `api/src` either. The driver's own `MineScreen.tsx` shows his read-only figures directly (no separate printable document), and its own code comment uses "statement" only informally to describe that view, not as a distinct feature. **This conflicts with `docs/README.md`'s status table**, which currently reads "FL F-6.6 — shareable without a login: printed slip built; share link deferred" — that claim does not match what this pass found in source. Worth raising with whoever owns that document rather than silently trusting either side; this catalogue entry records what a browser would actually see today.

**Steps:** none — kept as a description of intended behaviour (F-6.6) rather than a runnable case.

**Assertions (post-test):**
- [ ] **Not built as this pass found it** — re-verify live before concluding either the source read or the status table is the stale one

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
