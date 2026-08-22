# Invariant Assertion Blocks

Reusable assertion blocks for the 30 invariants defined in `user-flows.md` §5. Each test case references these by `INV-n` ID. The AI agent should execute the relevant checks after any test case that cites them.

---

## How to Use

When a test case says `ASSERT: INV-3`, the agent should run the corresponding check from this file against the current app state. These are **property tests** — they must hold regardless of the specific data.

---

## INV-1 — One arrangement per vehicle-day

**Source:** §6.3, UC-20, UC-40
**Check:**
1. ACTION: Navigate to vehicle calendar for the test vehicle
2. VERIFY: Every day shows exactly one colour/state
3. ACTION: Attempt to create a conflicting allocation (e.g., trip on a day already on lease)
4. VERIFY: Warning shown at the moment of conflict
5. VERIFY: If confirmed anyway, system refuses (double-count protection)

---

## INV-2 — Earned and received are separate facts

**Source:** §6.8, W-1
**Check:**
1. ACTION: Open a day record that was confirmed with a short payment
2. VERIFY: Two distinct fields visible: `earned` and `received`
3. VERIFY: The two values are different (e.g., earned 5000, received 3000)
4. ACTION: Check the database/API response
5. VERIFY: No code path writes one from the other

---

## INV-3 — Driver's two balances never move together except via Offset

**Source:** §6.4, W-2, UC-56
**Check:**
1. ACTION: Navigate to the driver's balance view
2. VERIFY: Two separate balance figures shown: "he owes you" and "you owe him"
3. VERIFY: Net is displayed as information only
4. ACTION: Record a daily payment (changes "he owes you")
5. VERIFY: "You owe him" balance did NOT change
6. ACTION: Record a trip payment (changes "you owe him")
7. VERIFY: "He owes you" balance did NOT change
8. ACTION: Perform an Offset
9. VERIFY: Both balances change, and an `Offset` record is created with date, amount, actor

---

## INV-4 — Deposits and advances never appear in income

**Source:** §6.13, W-8, UC-58
**Check:**
1. ACTION: Record a driver deposit of 25,000
2. ACTION: Navigate to "How was this month" for the vehicle
3. VERIFY: Deposit amount does NOT appear in the "Earned" tile
4. VERIFY: Deposit amount does NOT appear in the "Spent" tile
5. ACTION: Navigate to "Where is our cash"
6. VERIFY: Deposit IS shown as held under deposits ("Rs n held as deposits — a liability, not partner cash")
7. Repeat for customer deposit and driver advance

---

## INV-5 — Cost with borne_by ≠ us excluded from profit

**Source:** §6.1, UC-34
**Check:**
1. ACTION: Record a fuel expense with `borne_by = driver`
2. ACTION: Navigate to "How was this month" for the vehicle
3. VERIFY: Expense does NOT appear in the "Spent" tile or reduce "Profit"
4. VERIFY (no dedicated breakdown exists as of 22 Aug 2026): the expense is simply absent from the report, not shown in any "borne by driver" line item — confirm this silent exclusion is what INV-5 actually requires (it is), not a gap in the check

---

## INV-6 — Didn't-run day has earned = 0, no configuration can change it

**Source:** W-4, UC-33
**Check:**
1. ACTION: Mark a day as "didn't run" with any reason
2. VERIFY: `earned = 0` on the day record
3. ACTION: Attempt to set a chargeable amount on a didn't-run day
4. VERIFY: No mechanism exists to make earned non-zero for a didn't-run day

---

## INV-7 — Rent is the agreed amount regardless of mileage

**Source:** W-25, §6.12
**Check:**
1. ACTION: View a billing period where the customer drove below allowance
2. VERIFY: Rent charged = the full agreed monthly amount (no reduction)
3. VERIFY: No credit or carry-forward from unused kilometres

---

## INV-8 — Allowance = daily_limit × days_in_period, resets per period

**Source:** W-24
**Check:**
1. ACTION: View two consecutive billing periods with different day counts
2. VERIFY: Period 1 allowance = limit × days₁
3. VERIFY: Period 2 allowance = limit × days₂
4. VERIFY: No carry-forward from period 1

---

## INV-9 — Combined excess ≤ separate excess (missing boundary reading)

**Source:** UC-14
**Check:**
1. Given two periods with allowances A1 and A2, and combined driven D:
2. VERIFY: `max(0, D - A1 - A2) ≤ max(0, D₁ - A1) + max(0, D₂ - A2)` for any valid split of D

---

## INV-10 — No write mutates a closed period

**Source:** W-35, §6.14
**Check:**
1. ACTION: Close an accounting period
2. ACTION: Attempt to record an expense dated within the closed period
3. VERIFY: The expense posts to the **currently open period** with a `belongs_to_period` back-reference
4. VERIFY: No field in the closed period has changed

---

## INV-11 — At most one message per (trigger, record_id, stage)

**Source:** §6.10
**Check:**
1. ACTION: Trigger a rent reminder for a specific due
2. ACTION: Trigger it again (simulate retry/restart)
3. VERIFY: Only ONE message exists in the log for that (trigger, record, stage) combination

---

## INV-12 — Queued message re-evaluates condition at dispatch

**Source:** §6.10, UC-87
**Check:**
1. ACTION: Create a rent due (triggers a queued reminder)
2. ACTION: Record the payment BEFORE the reminder dispatches
3. VERIFY: Reminder status changes to `suppressed`
4. VERIFY: Suppression reason is logged (e.g., "payment received")

---

## INV-13 — Message log is append-only

**Source:** UC-87
**Check:**
1. ACTION: View the message log
2. ACTION: Attempt to edit a log entry
3. VERIFY: No edit capability exists
4. ACTION: Attempt to delete a log entry
5. VERIFY: No delete capability exists

---

## INV-14 — Waivers and write-offs never share a category or report line

**Source:** W-28, UC-90
**Check:**
1. ACTION: Record a waiver (goodwill discount)
2. ACTION: Record a write-off (bad debt)
3. ACTION: Navigate to "Goodwill given" (owner-only report; UC-77)
4. VERIFY: Waiver appears here, write-off does NOT (confirmed in source — `GoodwillReportScreen.tsx`'s own comment: "never pooled with write-offs")
5. **No consolidated write-off/bad-debt report exists as of 22 Aug 2026** — a write-off is visible only on the party's own detail screen (customer/driver), not in any report
6. VERIFY (on the party's detail screen instead): the write-off is listed there, and does not appear on "Goodwill given"

---

## INV-15 — Recovery links to the write-off it reverses

**Source:** UC-90, §9.2
**Check:**
1. ACTION: Write off a balance
2. ACTION: Later receive payment from the same party
3. VERIFY: Payment recorded as a `recovery` linked to the original write-off
4. VERIFY: Recovery is NOT recorded as income

---

## INV-16 — Ownership shares total 100%, effective-dated

**Source:** UC-02, §9.2
**Check:**
1. ACTION: View ownership shares for a vehicle
2. VERIFY: Percentages sum to exactly 100%
3. ACTION: Attempt to set shares that don't total 100%
4. VERIFY: System refuses
5. ACTION: Change shares with a new effective date
6. VERIFY: Recomputing an old month uses the old shares, not the new ones

---

## INV-17 — Trip cannot close with unreconciled driver advance

**Source:** UC-44
**Check:**
1. ACTION: Create a trip with a driver advance
2. ACTION: Attempt to close the trip without reconciling the advance
3. VERIFY: System blocks closure with a clear message

---

## INV-18 — Deposit cannot be settled until closure summary rendered

**Source:** UC-16
**Check:**
1. ACTION: Begin closing a lease (enter closing state)
2. ACTION: Attempt to settle the deposit before step 4 (closure summary)
3. VERIFY: Deposit settlement is not available until the summary has been shown

---

## INV-19 — Every odometer reading stores its source

**Source:** W-18, §9.2
**Check:**
1. ACTION: Enter an odometer reading via any method
2. VERIFY: The reading record contains a `source` field with one of: `photo`, `in_person`, `reported`, `at_return`

---

## INV-20 — All amounts are integer minor units, no floats

**Source:** §1.2
**Check:**
1. ACTION: Check API responses for any money field
2. VERIFY: Value is an integer, not a float
3. VERIFY: No decimal point appears in stored money values

---

## INV-21 — Money records are append-only; corrections write new records

**Source:** U-5, W-36
**Check:**
1. ACTION: Correct a money record (e.g., adjust an expense)
2. VERIFY: Original record still exists (not deleted or overwritten)
3. VERIFY: A new correction record exists, referencing the original
4. VERIFY: Both are visible in the audit trail

---

## INV-22 — Reversing a receipt restores due, arrears, balance, AND reminder

**Source:** UC-93
**Check:**
1. ACTION: Record a payment (due becomes paid, reminder stops)
2. ACTION: Reverse the receipt
3. VERIFY: Due status returns to unpaid/part-paid
4. VERIFY: Arrears reappear at the correct amount
5. VERIFY: Party balance restored
6. VERIFY: Reminder is **re-armed** (not permanently suppressed)

---

## INV-23 — Banking shortfall attaches to the banking event, never to a receipt

**Source:** W-37, UC-65
**Check:**
1. ACTION: Bank cash from pooled handovers
2. ACTION: Enter a count that is less than the total
3. VERIFY: Shortfall amount attaches to the **banking event** record
4. VERIFY: No individual receipt is modified to absorb the shortfall

---

## INV-24 — Every record carries business_id; vehicle_id is nullable

**Source:** §2.2, UC-66
**Check:**
1. ACTION: Record a cost with no vehicle selected
2. VERIFY: Record has a non-null `business_id`
3. VERIFY: Record has a null `vehicle_id`
4. VERIFY: Record appears in the "business overheads" section

---

## INV-25 — Linked driver can only read records tied to own driver record

**Source:** §2.3, W-13
**Check:**
1. ACTION: Log in as a linked driver
2. ACTION: Attempt to navigate to another driver's record
3. VERIFY: Access denied / no data shown
4. ACTION: Attempt to access another driver via API/URL manipulation
5. VERIFY: Request is refused
6. ACTION: Check that reports only show data for this driver

---

## INV-26 — Any split sums exactly to the original (largest-remainder)

**Source:** §1.2, W-54
**Check:**
1. ACTION: View a pro-rated calculation (e.g., mileage split, partial-period rent)
2. VERIFY: The parts sum to exactly the original amount
3. VERIFY: No rounding residual exists

---

## INV-27 — borne_by and paid_by are separate fields, never derived from each other

**Source:** W-48, §6.1
**Check:**
1. ACTION: Record an expense
2. VERIFY: Two separate fields exist: `borne_by` and `paid_by`
3. ACTION: Set `paid_by = manager` and `borne_by = driver`
4. VERIFY: Both values saved independently
5. VERIFY: The expense shows in "below the line" (borne by driver) AND creates an out-of-pocket balance for the manager

---

## INV-28 — Every money record carries an audit trail readable from the record

**Source:** W-50, UC-97
**Check:**
1. ACTION: Open any money-bearing record
2. VERIFY: An audit trail is accessible from the record itself (not only from a global log)
3. VERIFY: Trail shows: who created, who changed, when, what changed

---

## INV-29 — Lease ends the day before the next begins; no vehicle-day double-claimed

**Source:** W-46
**Check:**
1. ACTION: Close a lease with closing date X
2. ACTION: Start a new lease with start date X
3. VERIFY: Day X belongs to the incoming (new) lease
4. VERIFY: Day X-1 belongs to the outgoing (old) lease
5. VERIFY: No day is claimed by both

---

## INV-30 — Trip income recognises on trip closing date, in one accounting period

**Source:** W-41
**Check:**
1. ACTION: Create a trip spanning two months (e.g., 28 Jul – 3 Aug)
2. ACTION: Close the trip on 5 Aug
3. VERIFY: All trip income appears in August's accounting period
4. VERIFY: Zero trip income appears in July's accounting period
5. VERIFY: The trip's own P&L is unaffected by this rule
