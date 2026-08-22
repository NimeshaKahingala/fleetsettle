# Suite 07 — Corrections & Audit: Edge Cases

**Phase:** 1
**Source:** A-3, A-5, A-6, A-24, UC-93, INV-14, INV-21

**Rewritten 22 Aug 2026** — see `happy-path.md` in this directory: "reverse" is really "Correct this payment" (`CorrectPaymentSheet.tsx`), reached from "Close the month", not a receipt-detail action.

---

### EC-07-001: Reverse receipt after confirmation message sent (A-3)

**Priority:** P1
**Source:** A-3, F-8.2
**Preconditions:** Receipt exists, payment confirmation message was already sent via WhatsApp.

**Steps (corrected 22 Aug 2026 — via "Correct this payment", suite 07 HP-07-002; the message log itself is suite 09 territory, still unbuilt):**
1. ACTION: Reverse the receipt via "Close the month" → the payment → "Correct this payment" (Difference = -full amount, "He still owes it")
2. ACTION: **Message log doesn't exist yet** (suite 09) — this half of the case can't be run until messaging ships; don't mark it failed, mark it blocked on that dependency
3. VERIFY: Due status and arrears are restored (the "He still owes it" path)
4. VERIFY: The correction is visible in "Correct this payment"'s own "History" section (HP-07-003)

**Assertions (post-test):**
- [ ] Message log untouched (it's append-only)
- [ ] The customer has a message saying "paid" but the system says "unpaid" — this is correct and represents reality
- [ ] A new message (e.g., "reversal notification") could be triggered, but the old one remains

---

### EC-07-002: Partial reversal — shortfall choice (UC-93)

**Priority:** P1
**Source:** UC-93, F-8.2
**Preconditions:** Receipt of 70,000 exists. Only 60,000 actually cleared the bank.

**Steps (corrected 22 Aug 2026 — one sheet handles full and partial reversal identically, via the size of "Difference"):**
1. ACTION: "Close the month" → the 70,000 payment → "Correct this payment"
2. ACTION: Enter "Difference": -10,000 (not a separate "Partial Reversal" mode — the same field HP-07-002 used for a full reversal, just a smaller magnitude)
   VERIFY: No separate shortfall prompt appears — "What happens to the shortfall" is the same chip choice shown for every non-zero difference, not a conditional follow-up
3. ACTION: Choose "He still owes it" (not "Restore arrears" — see the exact current chip label)
4. ACTION: Enter "Reason (required)", set "Date"
5. ACTION: Click "Correct payment"
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

**Steps (corrected 22 Aug 2026 — same nuance as suite 10 EC-10-001: the capability is `writeOffOrWaiveAboveThreshold`, so don't assume every write-off amount is blocked):**
1. ACTION: Attempt to write off a balance — check whether the amount is above or below the gating threshold before concluding the action should be blocked
2. ACTION: Attempt to "Correct this payment" — should not even be reachable/clickable, since `reverseReceipt` gates the row's own click handler in "Close the month" (`can(me.role, "reverseReceipt")`), not just a disabled button inside the sheet
3. ACTION: Attempt to "Close this month"
   VERIFY: Action disabled or blocked — `closePeriod` is `OWNERS`-only

**Assertions (post-test):**
- [ ] W-49/`policy.ts`'s `OWNERS` group enforced: `owner`/`owner_manager` only, not an informal "Owner-Manager" hybrid role
- [ ] Security boundary maintained

---

### EC-07-004: Fine after deposit released — write-off path (A-6)

**Priority:** P1
**Source:** A-6, F-8.3
**Preconditions:** Lease closed, deposit released/returned months ago. Customer cannot be reached. Fine of 5,000 arrives today.

**Steps (corrected 22 Aug 2026):**
1. ACTION: "Record late charge" of 5,000 on the closed lease (not "Add charge" — suite 07 HP-07-004)
   VERIFY: Balance of 5,000 outstanding
2. ACTION: Determine uncollectable
3. ACTION: "Write off balance" for 5,000 (suite 07 HP-07-005)
   VERIFY: Balance returns to 0

**Assertions (post-test):**
- [ ] Path for orphaned charges works without phantom receivables
- [ ] Write-off posts to current open period

---

### EC-07-005: Fine during hold window — offset deposit (A-5)

**Priority:** P1
**Source:** A-5, F-2.7, F-8.4
**Preconditions:** Lease closed last week, 50,000 deposit still in `hold_window`. Fine of 5,000 arrives today.

**Not built as described (as of 22 Aug 2026).** `PostClosureChargeSheet.tsx` ("Record late charge") is Amount + "Due on" + "Note" only — no held-deposit detection, no "Offset against held deposit" option, and no automatic settlement against a deposit. Recording the charge and settling it from the held deposit look like two independent, manual actions with no linking step found in this pass, the same shape suite 01's EC-01-013 and suite 04's EC-04-006 found for incident contributions.

**Steps:** none — kept as a description of intended behaviour (A-5) rather than a runnable case until a real linking action is confirmed live or built.

**Assertions (post-test):**
- [ ] **Not built**: verify live before filing a GAP — check whether a manual deposit-movement ("Apply to arrears"-style) can be pointed at this specific charge, or whether the hold window genuinely offers no help against a late charge today despite existing for exactly that purpose (A-5)

---

### EC-07-006: Money records append-only (INV-21)

**Priority:** P1
**Source:** INV-21, W-50
**Preconditions:** Any money record exists.

**Steps (corrected 22 Aug 2026 — "correction wizard" doesn't exist as one flow; it's the collection of per-type Void sheets plus "Correct this payment", suite 07's own opening note):**
1. ACTION: Attempt to edit a money field via API/direct input (bypassing every client-side void/correct sheet)
   VERIFY: Database/backend refuses direct update
2. ACTION: Verify that the only way to change a money amount is via a void-and-replace action, through whichever record-type-specific sheet applies

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
