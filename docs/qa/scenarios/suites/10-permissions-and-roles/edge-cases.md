# Suite 10 — Permissions & Roles: Edge Cases

**Phase:** 1
**Source:** A-14, A-24, INV-25, W-3, W-49

---

### EC-10-001: Manager blocked from write-off, reversal, period close (A-24)

**Priority:** P0
**Source:** A-24, W-49
**Preconditions:** Logged in as Manager (Kamal).

**Steps:**
1. ACTION: Attempt to write off a 5,000 bad debt
   VERIFY: System blocks action (button missing or API refuses)
2. ACTION: Attempt to reverse a 10,000 receipt
   VERIFY: System blocks action
3. ACTION: Attempt to close the accounting period
   VERIFY: System blocks action

**Assertions (post-test):**
- [ ] Manager CANNOT perform destructive or settlement actions
- [ ] This requires Owner or Owner-Manager (W-49 matrix)

---

### EC-10-002: Driver cannot see another driver's data (INV-25, A-14)

**Priority:** P0
**Source:** A-14, INV-25
**Preconditions:** Logged in as Driver Ruwan. Driver Saman exists.

**Steps:**
1. ACTION: Observe URL structure for Ruwan's profile (e.g., `/driver/ruwan_id`)
2. ACTION: Manually navigate to `/driver/saman_id`
   VERIFY: System returns 403 Forbidden or 404 Not Found
   VERIFY: None of Saman's data is exposed
3. ACTION: Attempt API request for Saman's trips
   VERIFY: API returns 403 Forbidden

**Assertions (post-test):**
- [ ] INV-25: Isolation enforced at the routing/API level, not just UI hiding

---

### EC-10-003: Driver cannot write anything (W-3)

**Priority:** P0
**Source:** W-3
**Preconditions:** Logged in as Driver Ruwan.

**Steps:**
1. ACTION: Attempt to submit a POST/PUT/PATCH request to any endpoint (e.g., update phone number, log a day)
   VERIFY: API returns 403 Forbidden for all write actions

**Assertions (post-test):**
- [ ] Driver is 100% read-only globally

---

### EC-10-004: Export respects permissions — driver only own statement

**Priority:** P1
**Source:** UC-99, W-49
**Preconditions:** Logged in as Driver Ruwan.

**Steps:**
1. ACTION: Attempt to access full year CSV export
   VERIFY: Blocked / Not available
2. ACTION: Generate own statement PDF
   VERIFY: Allowed

**Assertions (post-test):**
- [ ] Driver can export his own statement, nothing else
- [ ] Manager can export vehicles they manage
- [ ] Owner can export entire ledger

---

### EC-10-005: Manager cannot access ownership/capital block

**Priority:** P1
**Source:** W-49
**Preconditions:** Logged in as Manager.

**Steps:**
1. ACTION: Attempt to view vehicle ownership shares
   VERIFY: Section hidden or blocked
2. ACTION: Attempt to view partner settlement
   VERIFY: Blocked

**Assertions (post-test):**
- [ ] Ownership and capital accounts are strictly owner-level
