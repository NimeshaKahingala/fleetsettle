# Suite 07 — Corrections & Audit: Happy Path

**Phase:** 1
**Depends on:** Suite 01 (arrangement A), Suite 02 (arrangement B)
**Source:** UC-90, UC-91, UC-93, UC-96, UC-97, F-8.1–F-8.6

---

### HP-07-001: Correct a data-entry mistake — void and replace

**Priority:** P0
**Source:** UC-96, F-8.5, W-50
**Preconditions:** A money-bearing record exists (e.g., an expense or receipt).

**Steps:**
1. ACTION: Navigate to the incorrect record
2. ACTION: Click "Edit" or "Correct"
3. ACTION: Change the amount (e.g., from 15,000 to 18,000)
4. ACTION: Enter reason for change: "Typo on invoice amount"
5. ACTION: Click "Save"
   VERIFY: Record updated

**Assertions (post-test):**
- [ ] INV-21: The original record is NOT overwritten
- [ ] Original record is marked as voided (`voided_at`, `voided_reason`, `voided_by`)
- [ ] A new record is created carrying the correct 18,000 amount
- [ ] The audit trail shows both the old and new states

---

### HP-07-002: Reverse a receipt — full reversal

**Priority:** P0
**Source:** UC-93, F-8.2
**Preconditions:** A receipt exists for a rent payment of 70,000.

**Steps:**
1. ACTION: Navigate to the receipt
2. ACTION: Click "Reverse"
3. ACTION: Enter reason: "Payment bounced"
4. ACTION: Select "Full Reversal"
5. ACTION: Click "Confirm"
   VERIFY: Receipt marked as reversed

**Assertions (post-test):**
- [ ] `Receipt` status = `reversed`
- [ ] INV-22: The original rent due status changes from `paid` back to `unpaid`
- [ ] Arrears restored for the customer
- [ ] Reminders for this due are RE-ARMED (no longer suppressed)

---

### HP-07-003: View audit trail — who changed what

**Priority:** P1
**Source:** UC-97, F-8.6, W-50
**Preconditions:** A record that has been corrected (from HP-07-001).

**Steps:**
1. ACTION: Navigate to the corrected record
2. ACTION: Open the "History" or "Audit Trail" section
   VERIFY: Trail shows:
   - Creation (who, when)
   - The original value
   - The correction event (who, when, reason)
   - The new value

**Assertions (post-test):**
- [ ] INV-28: Trail is readable FROM THE RECORD, not just a global log
- [ ] A passive owner can see why a month's figures changed without asking

---

### HP-07-004: Post-closure charge against closed lease

**Priority:** P1
**Source:** UC-91, F-8.4, W-36
**Preconditions:** Lease closed one month ago. No deposit held (or hold window expired).

**Steps:**
1. ACTION: Navigate to the closed lease
2. ACTION: Click "Add Charge"
3. ACTION: Enter type: "Camera fine"
4. ACTION: Enter amount: 5,000
5. ACTION: Click "Save"
   VERIFY: Charge added successfully

**Assertions (post-test):**
- [ ] Charge attaches to the CLOSED lease (allowed)
- [ ] Creates an outstanding balance for the customer
- [ ] Posts to the CURRENTLY OPEN accounting period, not the closed one

---

### HP-07-005: Write off an uncollectable balance

**Priority:** P1
**Source:** UC-90, F-8.3, W-28
**Preconditions:** Customer owes 5,000 (from post-closure charge), deemed uncollectable.

**Steps:**
1. ACTION: Navigate to the customer's balance
2. ACTION: Click "Write Off"
3. ACTION: Confirm amount: 5,000
4. ACTION: Enter reason: "Customer left the country"
5. ACTION: Click "Confirm"
   VERIFY: Balance reduced to 0

**Assertions (post-test):**
- [ ] Write-off recorded (separate from goodwill waivers — INV-14)
- [ ] Receivable cleared
- [ ] W-49: This action requires owner privileges

---

### HP-07-006: Recovery against a previous write-off

**Priority:** P1
**Source:** UC-90, F-8.3, INV-15
**Preconditions:** A write-off of 5,000 exists.

**Steps:**
1. ACTION: Navigate to the customer or the write-off record
2. ACTION: Click "Record Payment" or "Record Recovery"
3. ACTION: Enter amount received: 5,000
4. ACTION: Save
   VERIFY: Recovery recorded

**Assertions (post-test):**
- [ ] INV-15: Payment is linked to the original write-off
- [ ] Payment is recorded as a `recovery`, NOT as fresh income
- [ ] Prevents the "loss in Jan, windfall in Jun" reporting distortion
