# Suite 08 — Period Close & Reports: Edge Cases

**Phase:** 1
**Source:** A-16, A-26, INV-10, W-35, W-40, W-56

---

### EC-08-001: Close month with open items — warn not block

**Priority:** P1
**Source:** F-9.1, U-7
**Preconditions:** Open period with unconfirmed days and unresolved dues.

**Steps:**
1. ACTION: Begin period close
   VERIFY: Checklist displays warnings about the open items
2. ACTION: Click "Proceed Anyway"
   VERIFY: Period closes successfully

**Assertions (post-test):**
- [ ] U-7: The system warns, records the override, and does NOT block
- [ ] Exception: closing is blocked ONLY if it leaves money unaccounted for

---

### EC-08-002: Reopen closed period refused (INV-10)

**Priority:** P0
**Source:** INV-10, F-9.1
**Preconditions:** Closed period exists. Owner logged in.

**Steps:**
1. ACTION: Navigate to the closed period
2. ACTION: Look for a "Reopen" button
   VERIFY: No reopen mechanism exists
3. ACTION: Attempt to modify period state via API
   VERIFY: System refuses

**Assertions (post-test):**
- [ ] Closing is strictly ONE-WAY (F-9.1)
- [ ] "A month that can change after everyone agreed it is not a settlement"

---

### EC-08-003: Late repair invoice after month closed (A-16)

**Priority:** P0
**Source:** A-16, W-35, INV-10
**Preconditions:** Month closed. Invoice arrives dated in the closed month.

**Steps:**
1. ACTION: Record expense, set date to the closed month
2. ACTION: Save
   VERIFY: Expense saved

**Assertions (post-test):**
- [ ] Post lands in currently OPEN period
- [ ] Back-reference `belongs_to_period` points to the closed month
- [ ] The closed month's numbers remain exactly as they were at closing time
- [ ] This is the core mechanism of W-35

---

### EC-08-004: Report degrades to not available, never zero (W-56)

**Priority:** P1
**Source:** W-56, INV-19, F-9.2
**Preconditions:** Vehicle with fuel recorded, but no odometer readings.

**Steps:**
1. ACTION: Navigate to fuel efficiency report (UC-72)
   VERIFY: Report displays "not available" or similar indicator

**Assertions (post-test):**
- [ ] System does NOT show "0 km/l"
- [ ] W-56: Every report degrades to not available, never to zero
- [ ] Protects against confident wrong numbers from patchy data

---

### EC-08-005: Cannot close while earlier period is open

**Priority:** P1
**Source:** F-9.1
**Preconditions:** July open, August open. (Note: standard flow closes July to create August, so this requires manipulating the DB or finding a path where multiple are open).

**Steps:**
1. ACTION: Attempt to close August while July remains open
   VERIFY: System blocks the action
   VERIFY: Error message states periods must be closed in chronological order

**Assertions (post-test):**
- [ ] Chronological closing enforced

---

### EC-08-006: Lost-days denominator excludes charter and not-scheduled days

**Priority:** P1
**Source:** UC-76, F-9.2, §4
**Preconditions:** Month with 24 ran, 4 lost, 3 charter (paused), 0 not-scheduled. Total days = 31.

**Steps:**
1. ACTION: Check lost days report
   VERIFY: Denominator shows 28 (ran 24 + lost 4)

**Assertions (post-test):**
- [ ] Denominator is NOT 31
- [ ] Excludes paused and not-scheduled days
- [ ] This is the single assertion that keeps the lost-days report honest (§9.2)

---

### EC-08-007: Billing period spans two accounting periods

**Priority:** P1
**Source:** W-40, §6.15
**Preconditions:** Lease billing period from Jul 15 to Aug 14.

**Steps:**
1. ACTION: Check July accounting report
2. ACTION: Check August accounting report
   VERIFY: The rent due for that billing cycle appears in ONE of the months based on the agreed recognition rule (usually the month the due falls in, e.g., July 15)

**Assertions (post-test):**
- [ ] Rent is not pro-rated across the two accounting months for basic reporting
- [ ] W-40: Clear distinction between the billing cycle (lease) and the calendar month (accounting)
