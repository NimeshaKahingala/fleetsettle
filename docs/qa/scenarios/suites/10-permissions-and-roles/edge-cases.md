# Suite 10 — Permissions & Roles: Edge Cases

**Phase:** 1
**Source:** A-14, A-24, INV-25, W-3, W-49

**Rewritten 22 Aug 2026** — same reason as `happy-path.md` in this directory: the 4-role model and the platform-admin tier didn't exist when this suite was written. EC-10-001 through EC-10-005 corrected below; EC-10-006 is new.

---

### EC-10-001: Manager blocked from write-off, reversal, period close (A-24)

**Priority:** P0
**Source:** A-24, W-49
**Preconditions:** Logged in as Manager (Kamal).

**Steps (corrected 22 Aug 2026 — the real capability is `writeOffOrWaiveAboveThreshold`, `policy.ts`; the name itself implies a manager may still be able to write off or waive *below* some threshold — verify live rather than assuming a manager is blocked from every write-off):**
1. ACTION: Attempt to write off a 5,000 bad debt (`WriteOffBalanceSheet.tsx`/`WriteOffObligationSheet.tsx`)
   VERIFY: check whether this specific amount is above or below whatever threshold gates `writeOffOrWaiveAboveThreshold` before concluding it's blocked — don't assume every write-off is owner-only
2. ACTION: Attempt to reverse a 10,000 receipt
   VERIFY: `reverseReceipt` is `OWNERS`-only in policy — **but suite 07's own refresh found no "Reverse" UI anywhere in the client for any role**; if no reverse action exists to attempt, this case can only be checked at the API level (a direct request), not through the UI
3. ACTION: Attempt to close the accounting period ("Close the month")
   VERIFY: System blocks action — `closePeriod` is `OWNERS`-only

**Assertions (post-test):**
- [ ] Manager CANNOT perform owner-only capabilities: `manageOpeningBalances`, `managePartnerCapital`, `manageMembers`, `closePeriod`, `viewOwnerOnlyReports`, `messagingConfig`
- [ ] This requires `owner` or `owner_manager` (the `OWNERS` group in `policy.ts`, not "Owner-Manager" as a separate informal tier)

---

### EC-10-002: Driver cannot see another driver's data (INV-25, A-14)

**Priority:** P0
**Source:** A-14, INV-25
**Preconditions:** Logged in as Driver Ruwan. Driver Saman exists.

**Steps (corrected 22 Aug 2026 — the premise itself is stale: there is no `/driver/:id` route to tamper with):**
1. ACTION: **There is no id-bearing URL for the linked driver's own data at all** — the route is `/me`, and the server resolves the linked driver from the caller's own identity (`GET /api/driver-view`), never from an id in the request. The old attack surface (guess or tamper with another driver's id in the URL) doesn't exist in this shape.
2. ACTION: Since this closed live already — **LT-9** in `docs/qa/live-test-plan.md`, closed 20 Aug 2026 with a real second Asgardeo identity and a real redeemed invite, confirmed the boundary holds (real 403s observed) — treat that as the standing evidence for this case rather than re-deriving it from a URL that no longer exists
3. ACTION: If re-testing this live, the real attack surface is the API request itself: attempt any endpoint a linked driver shouldn't reach (e.g. another business's data, a staff-only route) using the driver's own real token
   VERIFY: 404, not 403 (CLAUDE.md: cross-tenant is 404, never 403 — a 403 would confirm the row exists)

**Assertions (post-test):**
- [ ] INV-25: Isolation enforced at the routing/API level, not just UI hiding — already closed live (LT-9), re-verify only if `policy.ts` or the invite-linking flow changes (per `.claude/skills/run-qa-pass/SKILL.md`'s own guidance)

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

**Steps (corrected 22 Aug 2026 — "Export transactions (CSV)" is owner-only and there is no PDF/statement generator anywhere in the client, for any role):**
1. ACTION: As driver, attempt to access "Export transactions (CSV)"
   VERIFY: Blocked / not available — this part of the case still holds
2. ACTION: **"Generate own statement PDF" is not built** — no statement, slip or PDF feature exists anywhere in `web/src` or `api/src` for any role (same finding as suites 01 HP-01-008 and 05 HP-05-006, and the same `docs/README.md` status-table discrepancy noted there)

**Assertions (post-test):**
- [ ] Driver cannot reach CSV export (owner-only)
- [ ] **Not built**: no per-role statement/PDF export exists to test — don't assume "Manager can export vehicles they manage" either, since the CSV export found in source is a single owner-only, business-wide action with no role-scoped variant

---

### EC-10-005: Manager cannot access ownership/capital block

**Priority:** P1
**Source:** W-49
**Preconditions:** Logged in as Manager.

**Steps (corrected 22 Aug 2026):**
1. ACTION: Attempt to view "Vehicle sharing" / "Set ownership shares" (suite 00 HP-00-005/006)
   VERIFY: Hidden or blocked — `managePartnerCapital` is `OWNERS`-only
2. ACTION: Attempt to view a partner's own "Partner money" screen (not "partner settlement" — no screen has that name, see suite 06 HP-06-006)
   VERIFY: Blocked

**Assertions (post-test):**
- [ ] Ownership and capital accounts are strictly owner-level (`managePartnerCapital`, `OWNERS` group)

---

### EC-10-006: A non-admin hitting an `/admin/*` URL directly

**Priority:** P1
**Source:** GAP-154, PLATFORM-ADMIN-AND-MULTI-BUSINESS-DESIGN-2026-08-17.md
**Preconditions:** Signed in as any non-platform-admin role.

**Steps:**
1. ACTION: Deep-link directly to an `/admin/*` route (bypassing the More → "Admin panel" entry point) — e.g. `/admin` or `/admin/users`
   VERIFY: Blocked before the admin screen ever mounts — Operate's own routing intercepts it (GAP-154), not a client-side redirect after the screen renders
   VERIFY: `GET /api/admin/users` (or the equivalent for whatever screen was targeted) is never called — confirm via the network log, not just the visible UI
2. ACTION: Similarly deep-link to `/me` while signed in as staff (not a linked driver)
   VERIFY: Blocked the same way (GAP-154 covers both `/me` and `/admin/*` deep links from Operate)

**Assertions (post-test):**
- [ ] Both blocks happen before any request to a protected endpoint fires, not after a 403 response
- [ ] This is the negative case for HP-10-005's positive path
