# Suite 10 — Permissions & Roles: Happy Path

**Phase:** 1
**Depends on:** Suite 00 (setup)
**Source:** W-49, §2.3

---

### HP-10-001: Owner sees all vehicles and reports

**Priority:** P1
**Source:** W-49
**Preconditions:** Logged in as Nimesha (Owner).

**Steps:**
1. ACTION: Navigate to Vehicles
   VERIFY: All vehicles (bus, cars) are visible
2. ACTION: Navigate to Reports
   VERIFY: All reports are accessible
3. ACTION: Navigate to Partner Settlement
   VERIFY: Full partner financials visible

**Assertions (post-test):**
- [ ] Owner has global read/write across the business

---

### HP-10-002: Manager performs daily operations

**Priority:** P1
**Source:** W-49
**Preconditions:** Logged in as Kamal (Manager), who has access to CAR-1234.

**Steps:**
1. ACTION: Navigate to Vehicles
   VERIFY: Only CAR-1234 is visible
2. ACTION: Start a rental on CAR-1234
   VERIFY: Allowed
3. ACTION: Record an expense on CAR-1234
   VERIFY: Allowed
4. ACTION: Confirm a payment on CAR-1234
   VERIFY: Allowed

**Assertions (post-test):**
- [ ] Manager can perform all normal daily read/writes on shared vehicles

---

### HP-10-003: Linked driver sees only own record — read only

**Priority:** P1
**Source:** W-49, W-3, W-13
**Preconditions:** Logged in as Driver Ruwan.

**Steps:**
1. ACTION: Navigate to home screen
   VERIFY: Shows Ruwan's balances, trips, past payments
2. ACTION: Attempt to find a "Save" or "Edit" button
   VERIFY: None exist (read-only)
3. ACTION: Check for other drivers
   VERIFY: No list of other drivers exists

**Assertions (post-test):**
- [ ] Driver role is strictly read-only
- [ ] Data is isolated to their own record
