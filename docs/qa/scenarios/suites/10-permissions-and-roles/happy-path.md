# Suite 10 — Permissions & Roles: Happy Path

**Phase:** 1
**Depends on:** Suite 00 (setup)
**Source:** W-49, §2.3

**Rewritten 22 Aug 2026 — this suite predated two structural additions, not just labels.** The role model is `owner` | `owner_manager` | `manager` | `driver` (`api/src/auth/policy.ts`), not the three roles ("Owner"/"Manager"/"Driver") this suite assumed — `owner_manager` sits between the other two and the original cases never distinguished it from plain `owner`. And the entire platform-admin/multi-business tier (six admin screens, a business switcher, multi-membership) was added 18 Aug 2026, after this suite was last touched — none of the original three cases even mention it. HP-10-001 through HP-10-003 are corrected below; HP-10-004 onward are new.

---

### HP-10-001: Owner sees all vehicles and reports

**Priority:** P1
**Source:** W-49
**Preconditions:** Logged in as Nimesha (Owner).

**Steps (corrected 22 Aug 2026):**
1. ACTION: Navigate to Vehicles
   VERIFY: All vehicles (bus, cars) are visible
2. ACTION: Navigate to Reports
   VERIFY: All reports are accessible, including owner-only ones ("How was the year", "Goodwill given") — `viewOwnerOnlyReports` (`owner`/`owner_manager` only)
3. ACTION: Navigate to a partner's own "Partner money" screen (not "Partner Settlement" — no such screen exists, see suite 06 HP-06-006)
   VERIFY: Full partner financials visible

**Assertions (post-test):**
- [ ] Owner has global read/write across the business
- [ ] `owner_manager` has the same capability set as plain `owner` per `policy.ts`'s `OWNERS` group — re-verify live whether the UI actually treats them identically everywhere, since this pass only checked the policy matrix, not every screen

---

### HP-10-002: Manager performs daily operations

**Priority:** P1
**Source:** W-49
**Preconditions:** Logged in as Kamal (Manager), who has access to CAR-1234.

**Steps (corrected 22 Aug 2026 — action labels per suites 01/06):**
1. ACTION: Navigate to Vehicles
   VERIFY: Only CAR-1234 is visible
2. ACTION: Start the rental wizard on CAR-1234 (suite 01 HP-01-001)
   VERIFY: Allowed (`dailyOperations`/`leaseAndTripLifecycle`, `STAFF` group — manager included)
3. ACTION: "Record expense" on CAR-1234
   VERIFY: Allowed
4. ACTION: "Collect payment" on CAR-1234
   VERIFY: Allowed

**Assertions (post-test):**
- [ ] Manager can perform all normal daily read/writes on shared vehicles

---

### HP-10-003: Linked driver sees only own record — read only

**Priority:** P1
**Source:** W-49, W-3, W-13
**Preconditions:** Logged in as Driver Ruwan.

**Steps (corrected 22 Aug 2026 — the linked driver's shell is "Mine", not a "home screen"; it has no tab bar at all, §7.9):**
1. ACTION: Sign in as the linked driver
   VERIFY: Lands on "Mine" (`MineScreen.tsx`), showing Ruwan's balances, trips, past payments from `GET /api/driver-view` — resolved from identity, with no `driverId` anywhere in the request (INV-25)
2. ACTION: Attempt to find a "Save" or "Edit" button
   VERIFY: None exist (read-only)
3. ACTION: Check for other drivers
   VERIFY: No list of other drivers exists; no route reachable to see one
4. ACTION: Check for a way to sign out
   VERIFY: A `SignOutRow` sits at the foot of the screen (GAP-156, 20 Aug 2026 — this shell has no tab bar and no `/more` route, so this is the only sign-out affordance)

**Assertions (post-test):**
- [ ] Driver role is strictly read-only
- [ ] Data is isolated to their own record

---

### HP-10-004: A single-membership user opens the business hub and requests another business

**Priority:** P1
**Source:** GAP-149, PLATFORM-ADMIN-AND-MULTI-BUSINESS-DESIGN-2026-08-17.md
**Preconditions:** Signed in with membership on exactly one business.

**Steps:**
1. ACTION: Open the business switcher (sheet title "Businesses", `BusinessSwitcherSheet.tsx`)
2. ACTION: Request to join or create another business
   VERIFY: A request is created — check the exact current wording of this action, not independently re-verified line-by-line in this pass
3. ACTION: As a platform admin (separately), open "Request queue" (`RequestQueueScreen.tsx`, screen title "Request queue")
   VERIFY: The request appears; "Approve this request?" and "Decline this request?" confirmation sheets exist for it

**Assertions (post-test):**
- [ ] GAP-149's own fix: single-membership users can reach the hub and request another business
- [ ] Requests are visible to a platform admin via the Request queue, not auto-approved

---

### HP-10-005: Platform admin reaches the admin panel and its five sub-screens

**Priority:** P1
**Source:** PLATFORM-ADMIN-AND-MULTI-BUSINESS-DESIGN-2026-08-17.md
**Preconditions:** Signed in as a platform admin (`session.isPlatformAdmin === true`).

**Steps:**
1. ACTION: Open More
   VERIFY: An "Admin panel" row is visible — present only when `isPlatformAdmin` is true
2. ACTION: Tap it
   VERIFY: Lands on "Admin panel" (`AdminHomeScreen.tsx`)
3. ACTION: From there, reach each of: "Businesses" (`BusinessesListScreen.tsx`), "Users" (`UsersListScreen.tsx`), "Admin management" (`AdminManagementScreen.tsx`), "Request queue" (`RequestQueueScreen.tsx`), "Platform log" (`PlatformAuditLogScreen.tsx`)
   VERIFY: Each screen loads; "Admin management" has a grant action reaching "Grant admin access?"; "Users" has "Business allowance" and "Grant admin access?" sheets; "Admin management" has "Revoke admin access?"
4. ACTION: Click "Leave admin panel" (or the exit affordance on `AdminHomeScreen.tsx`)
   VERIFY: Returns to the ordinary Operate shell (GAP-151)

**Assertions (post-test):**
- [ ] All six admin screens (five sub-screens plus the home) are reachable only when `isPlatformAdmin` is true
- [ ] A non-admin hitting an `/admin/*` URL directly is blocked before the screen mounts (GAP-154) — see suite 10 edge cases for the negative case
- [ ] Every write in this tier reports success/failure correctly (a `204`-only client mishandling `c.body(null, 200)` was found and fixed 19 Aug — re-check this hasn't regressed rather than assuming it's still fine)
