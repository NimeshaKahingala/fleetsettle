# Suite 07 — Corrections & Audit: Happy Path

**Phase:** 1
**Depends on:** Suite 01 (arrangement A), Suite 02 (arrangement B)
**Source:** UC-90, UC-91, UC-93, UC-96, UC-97, F-8.1–F-8.6

**Rewritten 22 Aug 2026 — the real correction model is per-record-type, not a generic "Edit"/"Reverse" affordance on any record.** There is no universal "Correct" button anywhere; instead there's a real, rich void ecosystem, one sheet per record type, mostly titled "Void {thing}" with a required Reason: `VoidExpenseSheet`, `VoidDepositMovementSheet`, `VoidAdvanceSheet`, `VoidWriteOffSheet`, `VoidOffsetSheet`, `VoidObligationSheet`, `VoidLeaseDayExceptionSheet`, `VoidIncidentRecoverySheet`, `VoidVehicleUnavailabilitySheet`. A payment/receipt specifically uses a different, richer sheet — "Correct this payment" (`CorrectPaymentSheet.tsx`) — reachable only from "Close the month"'s own payment list (gated on the `reverseReceipt` capability, owners only), not from a receipt's own detail page, because there isn't one. That one sheet turns out to answer HP-07-001, HP-07-002 and HP-07-003 all at once — corrected below to say so rather than describing three separate flows that don't exist.

---

### HP-07-001: Correct a data-entry mistake — void and replace

**Priority:** P0
**Source:** UC-96, F-8.5, W-50
**Preconditions:** A money-bearing record exists (e.g., an expense or receipt).

**Steps (corrected 22 Aug 2026 — using an expense as the representative case; the sheet name and exact fields differ per record type, but the void-and-replace shape is the same everywhere):**
1. ACTION: Navigate to the incorrect expense record, on its vehicle or incident
2. ACTION: Click "Void" (not "Edit"/"Correct" — no record type in this client uses either of those verbs)
3. ACTION: `VoidExpenseSheet.tsx` ("Void expense") takes only a "Reason" — there is no "change the amount" step; a void is full, not a partial amount edit. Enter reason: "Typo on invoice amount — voiding to re-enter correctly"
4. ACTION: Click "Void" (the sheet's own submit label)
5. ACTION: Separately, record a fresh expense with the correct amount (18,000) — the "replace" half of void-and-replace is a second, ordinary write, not a field on the void sheet itself

**Assertions (post-test):**
- [ ] INV-21: The original record is NOT overwritten
- [ ] Original record is marked as voided (`voided_at`, `voided_reason`, `voided_by`)
- [ ] A new record carries the correct 18,000 amount, created as its own separate write
- [ ] The audit trail shows both the old and new states — verify where this is actually visible for an expense specifically (HP-07-003 confirms it for a payment; not independently re-verified for an expense in this pass)

---

### HP-07-002: Reverse a receipt — full reversal

**Priority:** P0
**Source:** UC-93, F-8.2
**Preconditions:** A receipt exists for a rent payment of 70,000.

**Steps (corrected 22 Aug 2026 — the real sheet is "Correct this payment", reached from "Close the month"'s own payment list, not from the receipt directly; there's no "Full Reversal" toggle, a full reversal is just the full amount entered as a negative difference):**
1. ACTION: Navigate to "Close the month", find the 70,000 payment in its payment list (`Timeline`-backed), click it (only visible/clickable when `can(me.role, "reverseReceipt")` — owners only)
2. ACTION: In "Correct this payment", enter "Difference": -70,000 (a full reversal)
3. ACTION: Under "What happens to the shortfall", choose "He still owes it" (not "Full Reversal" — this chip choice is what restores arrears)
4. ACTION: Enter "Reason (required)": "Payment bounced"
5. ACTION: Set "Date"
6. ACTION: Click "Correct payment" (not "Confirm")
   VERIFY: Payment corrected

**Assertions (post-test):**
- [ ] INV-22: The original rent due status changes from `paid` back to `unpaid`
- [ ] Arrears restored for the customer — this is what "He still owes it" does
- [ ] Reminders for this due are RE-ARMED (no longer suppressed) — not independently re-verified in this pass, check live

---

### HP-07-003: View audit trail — who changed what

**Priority:** P1
**Source:** UC-97, F-8.6, W-50
**Preconditions:** A record that has been corrected (from HP-07-001).

**Steps (corrected 22 Aug 2026 — confirmed for a payment specifically; the same "History" pattern for other void sheets was not independently re-verified in this pass):**
1. ACTION: Open "Correct this payment" for the payment corrected in HP-07-002 (same sheet, reached the same way)
2. ACTION: Scroll to its own "History" section
   VERIFY: A `Timeline` (the same component used elsewhere for entity history) shows this payment's own audit entries — check live exactly which fields it carries (creation, correction event, actor, reason)

**Assertions (post-test):**
- [ ] INV-28: Trail is readable from within the correction sheet itself for a payment — confirm whether the same is true for expenses/write-offs/etc. via their own Void sheets, or whether "History" is payment-specific; this pass only confirmed the payment case
- [ ] A passive owner can see why a month's figures changed without asking

---

### HP-07-004: Post-closure charge against closed lease

**Priority:** P1
**Source:** UC-91, F-8.4, W-36
**Preconditions:** Lease closed one month ago. No deposit held (or hold window expired).

**Steps (corrected 22 Aug 2026):**
1. ACTION: Navigate to the closed lease's own Lease actions → "Record late charge" (not "Add Charge")
2. ACTION: **No "type" field exists** — `PostClosureChargeSheet.tsx` is Amount + "Due on" + "Note" only; put "Camera fine" in the Note instead of a type selector
3. ACTION: Enter "Amount": 5,000
4. ACTION: Click "Record charge" (not "Save")
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

**Steps (corrected 22 Aug 2026 — same `WriteOffBalanceSheet.tsx` used for both customers and drivers, suite 05 EC-05-002):**
1. ACTION: Navigate to the customer's detail screen, Customer actions → "Write off balance" (not "Write Off")
2. ACTION: Enter "Amount": 5,000
3. ACTION: Enter "Reason": "Customer left the country"
4. ACTION: Set "Written off on" date
5. ACTION: Click "Write off" (the sheet's own submit label, not "Confirm")
   VERIFY: Balance reduced to 0

**Assertions (post-test):**
- [ ] Write-off recorded (separate from goodwill waivers — INV-14)
- [ ] Receivable cleared
- [ ] W-49: This action requires owner privileges — `writeOffOrWaiveAboveThreshold`, see suite 10's own correction on what "requires owner" actually gates

---

### HP-07-006: Recovery against a previous write-off

**Priority:** P1
**Source:** UC-90, F-8.3, INV-15
**Preconditions:** A write-off of 5,000 exists.

**Steps (corrected 22 Aug 2026 — one action, not a choice between two):**
1. ACTION: Navigate to the customer's detail screen
2. ACTION: Click "Record recovery" (`WriteOffRecoverySheet.tsx` — not "Record Payment" or "Record Recovery" as alternatives, this is the only option)
3. ACTION: Enter "Amount": 5,000, "Received on" date
4. ACTION: Click "Record recovery"
   VERIFY: Recovery recorded

**Assertions (post-test):**
- [ ] INV-15: Payment is linked to the original write-off
- [ ] Payment is recorded as a `recovery`, NOT as fresh income
- [ ] Prevents the "loss in Jan, windfall in Jun" reporting distortion
