# Roles and capabilities — current state

**Written 7 August 2026.** An evaluation, not a specification — the specification is `docs/product/user-flows.md` §2.3 (FL §2.3, W-49) and the enforcement code is [`api/src/auth/policy.ts`](api/src/auth/policy.ts); this document exists to put both next to each other, plus what's actually reachable in the client today, since the three have drifted before (GAP-42) and the gap wasn't visible until someone hit it in production. If this ever disagrees with `policy.ts`, `policy.ts` is right — update this file, not the other way round.

---

## 1. The five actors

| Actor | `business_member.role`? | Logs in | Enters data | Sees |
|---|---|---|---|---|
| **Owner (passive)** | `owner` | Yes | Rarely / never | His vehicles' monthly and yearly numbers, his share, his balances |
| **Owner-manager** | `owner_manager` | Yes | Everything | Everything for the vehicles he owns or manages |
| **Manager (non-owner)** | `manager` | Yes | Everything operational | Operations for vehicles shared with him — **not** the ownership/capital block |
| **Driver (linked)** | *(none — see below)* | Optional, **view-only** (W-13) | Never (W-3) | Only his own record: two balances, days, trips, advances, deposit, statement |
| **Customer** | *(none)* | No | Never | Nothing in-app. Receives messages and statements only |

**"Driver" is not a `business_member` row.** `DM §3`'s `CHECK` constraint on `business_member.role` only allows `owner` / `owner_manager` / `manager` — a linked driver is resolved instead by `driver.linked_user_id` matching the signed-in user (`api/src/queries/identity.ts`). A user gets at most one membership row *or* one linked-driver row, never both; `resolveMembership()` is the single query behind every request's `sub → business_id, role`.

**Customer has no role in the system at all** — no login, no capability row. It exists here only so the table is complete; every reference to "customer" in the product is a messaging target (statements, reminders), never an authenticated actor.

The founding rule this whole model exists to satisfy (CLAUDE.md → Tenancy): **`business_id` is resolved from the verified JWT, never from a request body or query param**, and **a linked driver must not reach another driver's data by any route** — that boundary is enforced by `driver_id` scoping in the data layer, not by trusting a role claim.

---

## 2. The capability matrix (enforced today, backend)

Source: `api/src/auth/policy.ts`, one function (`can(role, capability)`) checked in **every handler**, regardless of what the client already hid. `STAFF` = owner/owner_manager/manager, `OWNERS` = owner/owner_manager, `LINKED_DRIVER` = driver only.

| Capability | Owner | Owner-manager | Manager | Driver |
|---|:---:|:---:|:---:|:---:|
| Daily cards, trips, expenses, collections (`dailyOperations`) | ✓ | ✓ | ✓ | ✗ |
| Start/close a lease, close a trip (`leaseAndTripLifecycle`) | ✓ | ✓ | ✓ | ✗ |
| Add/read vehicles, drivers, customers; link/unlink a driver's account (`manageEntities`) | ✓ | ✓ | ✓ | ✗ |
| Set go-live opening balances (`manageOpeningBalances`) | ✓ | ✓ | ✗ | ✗ |
| Ownership shares, capital, management fees, payouts (`managePartnerCapital`) | ✓ | ✓ | ✗ | ✗ |
| Invite, revoke or change a member's role (`manageMembers`, A11) | ✓ | ✓ | ✗ | ✗ |
| Write-off / waive above threshold (`writeOffOrWaiveAboveThreshold`) | ✓ | ✓ | ✗ | ✗ |
| Reverse a receipt (`reverseReceipt`, F-8.2) | ✓ | ✓ | ✗ | ✗ |
| Close an accounting period (`closePeriod`, F-9.1) | ✓ | ✓ | ✗ | ✗ |
| View reports (`viewReports`) | ✓ | ✓ | ✓ | ✗ |
| View owner-only reports (`viewOwnerOnlyReports`) | ✓ | ✓ | ✗ | ✗ |
| View own driver record (`viewOwnData`) | ✗ | ✗ | ✗ | ✓ |
| Messaging kill switch (`messagingKillSwitch`) | ✓ | ✓ | ✓ | ✗ |
| Full messaging config (`messagingConfig`) | ✓ | ✓ | ✗ | ✗ |
| See another driver's data | ✓ | ✓ | ✓ | **✗ — hard boundary, not a capability flag** (enforced by `driver_id` scoping, W-49) |

Note that in this matrix **"Owner" and "Owner-manager" are identical** — the spec table in FL §2.3 distinguishes them only by *behaviour* (a passive owner rarely enters data), not by what they're *permitted* to do. There is no capability an owner-manager has that a plain owner lacks, or vice versa.

---

## 3. Where the model is thinner than the matrix implies

Two capabilities are flagged in `policy.ts` itself as **flat stand-ins**, not the real rule yet:

- **`managePartnerCapital`** — same flat `OWNERS` check as `manageOpeningBalances`. The spec's real intent is to confine an `owner_manager` to vehicles *he actually owns or manages*, per-vehicle. `ownership_share` now exists as data (as of P7), but the `WHERE`-clause scoping on top of it — and which table (ownership vs. management) decides "his" vehicles for which action — hasn't been built.
- **`viewReports`** — UC-70/71/72 say a `manager` should see only "shared vehicles," but every P11 report currently reads across the whole business regardless of role. Same undone work as above, not a separate gap.

Both are recorded as intentional, provisional simplifications — not bugs — but a manager today can see (and a would-be per-vehicle owner-manager can act on) more of the business than the product's own use cases describe.

---

## 4. Enforcement layers, and what's actually built

| Layer | Spec | Status |
|---|---|---|
| **Backend** (`api/src/auth/policy.ts`) | FL §2.3 / W-49 | **Built and enforced.** Every handler re-checks; this is the only place a capability is decided (IG §7.2) |
| **Data-layer driver isolation** (`driver_id` scoping) | W-49's hard boundary | **Built.** Covered by the linked-driver test class on every driver-touching endpoint |
| **Client convenience gating** (`web/src/lib/capabilities.ts`, `<Can>`) | UI §12.4 / M-22 | **Not built.** Confirmed absent as of the 6 Aug 2026 Track B validation pass — no file exists yet |
| **Role-based shell routing** (`RootLayout`, `FirstRunGate`) | UI §1.1 | **Partially built.** `RootLayout` currently hardcodes `shell="operate"`; `FirstRunGate` only has a `renderOperate` branch — `owner` (passive) and `driver` both fall through to `NotBuiltYetScreen`. `AppShell` itself supports `shell="review"` and `shell="mine"` and both are already built/tested, but nothing routes to them yet |
| **Invite / join flow** (a second person actually getting a role) | W-57, F-1.4/F-1.8 | **Built (A11, 7 Aug 2026).** `POST /api/business-member/invite` + `POST /api/invite/redeem` (owner/owner-manager/manager) and `POST /api/driver/{id}/link-invite` (a driver's own account) — an owner can now actually bring in a second person of any role, and a driver can link. `FirstRunGate` offers redeeming a code alongside creating a business. **No in-app "invite a member" screen yet** — the endpoints exist and are tested but have no caller; that needs B0b's role-aware shells first |

This is why the client-visible product today is narrower than the matrix in §2 suggests: the *backend* already refuses a manager a write-off correctly, but the *client* still has no owner-passive or driver **screen** to land on once they join (B4/B5), even though A11 means they can now get an account at all — `owner_manager` was the only role reachable at all until A0 (6 Aug), and every role but `owner_manager`/`manager` was reachable by no one until A11 (7 Aug).

Tracked as:
- **B0b** (Plan.md) — build `lib/capabilities.ts` + `<Can>`, make role readable outside `MeResponse`, wire `RootLayout`/`FirstRunGate` branches for `renderReview` / `renderMine`.
- ~~**A11**~~ (Plan.md, GAP-43) — ✅ done 7 Aug 2026. B4/B5 (Plan.md) still own the screens a newly-joined `owner`/`driver` lands on.

---

## 5. What each role cannot do — worth stating explicitly

- **Manager** cannot: write off or waive above threshold, reverse a receipt, close a period, touch ownership/capital/payouts, see owner-only reports, or change messaging config beyond the kill switch. Can do everything day-to-day operational (cards, trips, expenses, collections, lease/trip lifecycle) on vehicles shared with him, and can view the same reports an owner sees (§3 caveat aside).
- **Driver** cannot write *anything* (W-3) — no save/edit control exists for this role by design, not merely by omission — and cannot see any record outside his own, including through a report, export, or shared link (W-49, the one hard security boundary in this list; everything else above is a business preference).
- **Owner (passive)** has every capability a manager lacks, identically to an owner-manager — the "passive" label describes expected behaviour (rarely enters data), not a narrower grant.

---

*Sources: `docs/product/user-flows.md` §2.3 (FL §2.3), `docs/product/use-cases.md` W-49/W-53/W-57/UC-03, `docs/design/ui-ux-guidelines.md` §12.4, `api/src/auth/policy.ts`, `api/src/queries/identity.ts`, `TRACKER.md` (6–7 Aug 2026 entries, GAP-42/GAP-43/GAP-52/GAP-53). Updated 7 Aug 2026 for A11.*
