# Suite 07 — Corrections & Audit: Edge Cases

**Phase:** 1
**Source:** A-3, A-5, A-6, A-24, UC-93, INV-14, INV-21

---

### EC-07-001: Reverse receipt after confirmation message sent (A-3)

**Priority:** P1
**Source:** A-3, F-8.2
**Preconditions:** Receipt exists, payment confirmation message was already sent via WhatsApp.

**Steps:**
1. ACTION: Reverse the receipt
2. ACTION: Navigate to the message log
   VERIFY: The payment confirmation message is still there (not deleted)
3. VERIFY: Due status, arrears, and reminder are restored
4. VERIFY: The correction is flagged in the audit trail

**Assertions (post-test):**
- [ ] Message log untouched (it's append-only)
- [ ] The customer has a message saying "paid" but the system says "unpaid" — this is correct and represents reality
- [ ] A new message (e.g., "reversal notification") could be triggered, but the old one remains

---

### EC-07-002: Partial reversal — shortfall choice (UC-93)

**Priority:** P1
**Source:** UC-93, F-8.2
**Preconditions:** Receipt of 70,000 exists. Only 60,000 actually cleared the bank.

**Steps:**
1. ACTION: Navigate to the receipt
2. ACTION: Click "Reverse"
3. ACTION: Select "Partial Reversal"
4. ACTION: Enter actual received: 60,000
   VERIFY: System prompts for shortfall (10,000) choice: "Restore arrears" or "Absorb as loss"
5. ACTION: Select "Restore arrears"
6. ACTION: Confirm
   VERIFY: Original receipt reduced, arrears increased by 10,000

**Assertions (post-test):**
- [ ] Original receipt voided, replaced with one for 60,000 (INV-21)
- [ ] Link between correction and original maintained (§9.2)
- [ ] 10,000 shortfall restores the customer's arrears

---

### EC-07-003: Manager blocked from write-off (A-24)

**Priority:** P0
**Source:** A-24, W-49
**Preconditions:** Logged in as Manager (Kamal).

**Steps:**
1. ACTION: Attempt to write off a balance
   VERIFY: Action disabled or blocked with permission error
2. ACTION: Attempt to reverse a receipt
   VERIFY: Action disabled or blocked
3. ACTION: Attempt to close an accounting period
   VERIFY: Action disabled or blocked

**Assertions (post-test):**
- [ ] W-49 Matrix enforced: these three actions require Owner or Owner-Manager rights
- [ ] Security boundary maintained

---

### EC-07-004: Fine after deposit released — write-off path (A-6)

**Priority:** P1
**Source:** A-6, F-8.3
**Preconditions:** Lease closed, deposit released/returned months ago. Customer cannot be reached. Fine of 5,000 arrives today.

**Steps:**
1. ACTION: Add charge of 5,000 to the closed lease (F-8.4)
   VERIFY: Balance of 5,000 outstanding
2. ACTION: Determine uncollectable
3. ACTION: Write off the 5,000
   VERIFY: Balance returns to 0

**Assertions (post-test):**
- [ ] Path for orphaned charges works without phantom receivables
- [ ] Write-off posts to current open period

---

### EC-07-005: Fine during hold window — offset deposit (A-5)

**Priority:** P1
**Source:** A-5, F-2.7, F-8.4
**Preconditions:** Lease closed last week, 50,000 deposit still in `hold_window`. Fine of 5,000 arrives today.

**Steps:**
1. ACTION: Add charge of 5,000 to the closed lease
   VERIFY: Balance of 5,000 outstanding
2. ACTION: System detects held deposit
   VERIFY: Option offered: "Offset against held deposit"
3. ACTION: Confirm offset
   VERIFY: Deposit reduced to 45,000, charge settled

**Assertions (post-test):**
- [ ] Hold window serves its exact purpose (survivability against late charges)
- [ ] Offset is an explicit recorded action

---

### EC-07-006: Money records append-only (INV-21)

**Priority:** P1
**Source:** INV-21, W-50
**Preconditions:** Any money record exists.

**Steps:**
1. ACTION: Attempt to edit a money field via API/direct input (bypassing correction wizard)
   VERIFY: Database/backend refuses direct update
2. ACTION: Verify that the only way to change a money amount is via the `void-and-replace` pattern

**Assertions (post-test):**
- [ ] INV-21 enforced at the schema/service level
- [ ] Every table with money fields has `voided_at`, `voided_reason`, `voided_by`
- [ ] Allocation rows voided with their parent, never on their own

---

### EC-07-007: Waiver vs write-off never share a bucket (INV-14)

**Priority:** P1
**Source:** INV-14
**Preconditions:** 500 excess mileage waived (goodwill), 5,000 bad debt written off.

**Steps:**
1. ACTION: Inspect the backend data or API response
   VERIFY: The two records use different types or flags (e.g., `type: waiver` vs `type: write_off`)
2. ACTION: Verify reporting queries
   VERIFY: No single query or report line aggregates both numbers together

**Assertions (post-test):**
- [ ] INV-14: The two concepts are kept strictly separate
- [ ] Goodwill is a business decision; a write-off is a failure to collect
