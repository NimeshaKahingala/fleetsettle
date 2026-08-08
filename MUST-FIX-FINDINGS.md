# FleetSettle Must-Fix Findings - Backend/API

**Date:** 7 August 2026  
**Scope:** API handlers, domain logic, queries, schema/use-case alignment.  
**Review stance:** must-fix issues only: defects that can produce wrong money, leak data across roles, block documented workflows, or make period/month-end behavior untrustworthy.

## Executive Summary

The backend has a solid foundation: business-scoped reads are common, key money writes are transactional, period posting is explicit, and several hard invariants are backed by database constraints. The biggest remaining risks are not random bugs; they are places where the code knowingly simplified a use-case that is now central to the product.

The highest priority fixes are:

1. Make vehicle arrangements effective-dated in all money defaults.
2. Convert incident customer contributions into receivable obligations.
3. Generate management-fee obligations from management agreements.
4. Add real per-vehicle authorization scoping for managers/owner-managers.
5. Enforce relationship consistency when an API request supplies multiple related IDs.
6. Fix scheduler/timezone and period-close behavior before month-end is trusted.

## P0 - Money Correctness

### 1. Make Arrangement Changes Date-Aware And First-Class

**Why it matters:** The product rule is that a vehicle-day belongs to exactly one arrangement, and expense defaults depend on who bears cost under that arrangement. Today, expense borne-by defaults are resolved from the vehicle's current arrangement, not the expense date. If a vehicle changes from daily lease to trip/charter or monthly rental, late-entered costs can be assigned to the wrong party.

**Evidence:**

- `api/src/domain/expense.ts:37` says current-arrangement lookup is a deliberate simplification.
- `api/src/domain/expense.ts:58` and `api/src/domain/expense.ts:64` look up the active/current lease or daily lease without passing `spentOn`.
- `api/src/domain/vehicles.ts` creates only the opening `vehicle_arrangement`; lease/daily-lease/trip start paths do not close/open effective-dated arrangement rows.

**Must fix:**

- Add a domain service for arrangement transitions.
- Starting/closing a lease, starting/ending a daily lease, and booking/cancelling/closing trips must write or reconcile effective-dated arrangement/allocation facts.
- Expense defaults must resolve arrangement, active lease/customer, and active daily-lease/driver as of `spentOn`.
- Add integration tests for late-entered fuel/toll/cleaning after arrangement changes.

### 2. Turn Incident Customer Contributions Into Receivables

**Why it matters:** UC-12/W-10 says accident contributions are negotiated, payable in parts or from deposit. The schema says customer contributions become receivables, but the domain currently records only `incident_recovery`. That means agreed customer money will not appear in receivables, ageing, generic payment allocation, or deposit application.

**Evidence:**

- `api/src/domain/incident.ts:205` documents that `obligation_id` intentionally stays null.
- `api/src/domain/incident.ts:229` inserts only `incident_recovery`.
- `api/migrations/0001_initial_schema.sql` defines `incident_recovery.obligation_id` with the comment "customer contributions become receivable."

**Must fix:**

- In the same transaction, create an `obligation` with `kind = 'customer_contribution'`, `direction = 'owed_to_us'`, party/customer, vehicle/source context, and period linkage.
- Link `incident_recovery.obligation_id` to that obligation.
- Ensure `recordPayment`, deposit application, receivables, ageing, write-off, and reversal flows treat it like any other customer due.

### 3. Generate Management Fee Obligations

**Why it matters:** W-53 says a management fee is a vehicle operating cost to the owner and income to the manager. The report query already counts `management_fee` obligations as vehicle cost, but nothing generates them from `management_fee_agreement`, so vehicle profit can be overstated every month.

**Evidence:**

- `api/src/queries/reports.ts:60` says costs include driver fee and management fee obligations.
- `api/src/queries/reports.ts:77` reads `obligation.kind IN ('driver_fee', 'management_fee')`.
- `management_fee_agreement` exists in schema and APIs, but there is no domain generator equivalent to billing-period generation.

**Must fix:**

- Build an effective-date-aware monthly generator for `management_fee` obligations.
- Post to the current open accounting period and set belongs-to period for late facts.
- Make period close checklist surface missing/unposted management fees.
- Add report tests proving owner profit is reduced and manager income/current account is visible.

### 4. Make Overpayments/Credits Real Ledger Facts

**Why it matters:** `recordPayment` returns `unallocatedMinor` for surplus money, but no durable credit record is created. The API response knows about a customer credit, while the ledger forgets it. A refresh, later billing-period generation, or ageing report cannot apply or even show that credit.

**Evidence:**

- `api/src/domain/payment.ts:40` calls surplus "overpayment held as customer credit."
- `api/src/domain/payment.ts:42` says applying it forward is not wired.
- `api/src/domain/payment.ts:84` returns `unallocatedMinor` without writing a credit/deposit/obligation equivalent.

**Must fix:**

- Introduce a durable credit/current-account representation for unallocated received money.
- Apply oldest credit to new obligations deterministically, or expose an explicit apply-credit endpoint.
- Include credit in customer/driver statements and payment correction/reversal tests.

## P0 - Authorization And Trust Boundaries

### 5. Implement Per-Vehicle Permission Scoping

**Why it matters:** W-49 says managers see only shared vehicles and must not see ownership/capital blocks. Current policy is flat at business level. This is a data-leak risk for reports, capital, ownership shares, payouts, and management agreements.

**Evidence:**

- `api/src/auth/policy.ts:16` documents that `managePartnerCapital` is only a flat owners check for now.
- `api/src/auth/policy.ts:26` documents that `viewReports` reads across the whole business regardless of role.
- `api/src/handlers/reports.ts` gates broad reports with `viewReports`, then passes only `businessId`.

**Must fix:**

- Define `visibleVehicleIds` and `manageableVehicleIds` per role.
- Apply this in reports, partner capital APIs, ownership-share reads, payouts, exports, vehicle summaries, and future dashboards.
- Add manager/owner-manager overreach integration tests, including report endpoints with no `vehicleId` query.

## P0 - Cross-Entity Integrity

### 6. Validate Related IDs Belong Together, Not Just To The Same Business

**Why it matters:** Many handlers check each supplied ID belongs to the business, but not that the IDs describe one coherent event. This lets API callers attach a trip expense to the wrong vehicle, an incident to a lease on another vehicle, or a post-closure charge to a party unrelated to the source. Reports then count the fact in the wrong place.

**Evidence:**

- `api/src/handlers/expense.ts:38` validates `tripId`, but does not require `body.vehicleId` to match `trip.vehicleId`.
- `api/src/handlers/expense.ts:43` validates `incidentId`, but does not require `body.vehicleId` to match `incident.vehicleId`.
- `api/src/queries/expense.ts:309` lists expenses by `tripId` only, relying on the handler's prior check, but the stored row can still carry a different `vehicleId`.
- `api/src/handlers/post-closure-charge.ts:23` validates source, party, and optional vehicle independently.

**Must fix:**

- Add request-level and/or DB-level constraints for composite relationships:
  - expense `tripId` implies `vehicleId = trip.vehicleId` when `vehicleId` is supplied.
  - expense `incidentId` implies `vehicleId = incident.vehicleId` when supplied.
  - incident `leaseId` implies same vehicle and customer context where applicable.
  - post-closure charge party/vehicle/source must match the closed lease/trip unless explicitly overridden with a reason.
- Add adversarial API tests for same-business mismatches.

## P1 - Scheduler, Periods, And Month-End Trust

### 7. Use Each Business Timezone In Scheduled Jobs

**Why it matters:** The docs require a business timezone. API handlers use `businessToday(requireBusinessTimezone(c))`, but scheduled jobs calculate one global `today`. This will produce wrong day cards and billing-period rollovers if more than one timezone exists or the configured timezone changes.

**Evidence:**

- `api/src/scheduled.ts:21` explicitly says the job uses a single `businessToday()` and does not resolve per-business timezones.
- `api/src/scheduled.ts:32` computes `today` once for all businesses.

**Must fix:**

- Query businesses and run day-card/billing generation per `business.timezone`.
- Make scheduled job output grouped by business/date.
- Test a business whose local date differs from the Worker/server date.

### 8. Strengthen Period-Close Safeguards

**Why it matters:** Period close is the point where owners trust the month. The checklist warns but never blocks, which matches U-7, but some missing facts are not visible enough: ungenerated day cards, missing management fees, unapplied credits, customer incident receivables, and scheduler failures can all leave the close looking cleaner than it is.

**Evidence:**

- `api/src/domain/accounting-period.ts:49` says checklist never blocks.
- `api/src/queries/accounting-period.ts:156` says unconfirmed days under-report if cron has not run.
- Current checklist cannot detect missing management-fee obligations or non-durable overpayments because those facts are not written.

**Must fix:**

- Before close, run or simulate day-card generation through the period end and report failures.
- Add checklist rows for missing management fees, unallocated credits, unlinked incident recoveries, and scheduler errors.
- Keep "warn, do not block" only where the warning is complete and actionable.

### 9. Make Concurrent Close/Correction Writes Idempotent At The Database Level

**Why it matters:** Several flows are idempotent by pre-read status checks, but comments acknowledge genuine concurrent races. For money writes that create obligations, a double-submit can duplicate driver fees or other obligations if two requests observe the same pre-close state.

**Evidence:**

- `api/src/domain/trip.ts:267` documents `closeTrip` is idempotent on observed trip status, not a DB constraint.
- `api/src/domain/trip.ts:270` acknowledges a concurrent double-close is not additionally guarded.
- `api/src/domain/trip.ts:321` creates the driver-fee obligation during close.

**Must fix:**

- Add unique indexes on obligation source where one obligation is allowed, for example `(kind, source_type, source_id, direction)` with appropriate filters.
- Make close/update statements conditional on current state and use returned row count as the idempotency boundary.
- Add concurrent double-submit tests for close trip, post-closure charges, payment correction, and deposit settlement.

## P1 - Use-Case Completeness

### 10. Implement Holds/In-Progress Trip State Or Remove It From The State Machine

**Why it matters:** ST-5 includes `hold -> booked -> in_progress -> closed`, and the use cases distinguish tentative enquiries from confirmed trips. The API currently creates trips directly as `booked`, writes full allocation days immediately, and home treats `booked` as in-progress/open. A tentative enquiry can suppress daily lease income.

**Evidence:**

- `api/src/queries/trip.ts` comments say no path produces `hold` or `in_progress`; `listInProgressTripsForBusiness` filters `status = 'booked'`.
- `api/src/domain/trip.ts` books allocation days immediately and pauses day records for the full range.

**Must fix:**

- Add a real hold endpoint/state with `is_hold = true` allocation rows, expiry, and conversion to booked.
- Add an in-progress transition or remove the state from docs/schema and rename API semantics.
- Test that a hold does not suppress daily lease day records or income.

### 11. Implement Adjustment/Correction Links For Void-And-Replace

**Why it matters:** W-50 says money records are append-only and every correction should have a readable audit trail. Expense voiding records a reason, but the replacement expense is not linked to the voided original. That weakens audit review when someone asks "what corrected this wrong entry?"

**Evidence:**

- `api/src/queries/expense.ts` says the schema has no `replaces_id` column, so void and replacement are not formally linked.
- `api/src/domain/expense.ts` supports void and new create, but no correction group.

**Must fix:**

- Add a correction/replacement linkage for expenses and any other void-and-recreate money record.
- Expose correction history in audit APIs.
- Test an expense wrong-vehicle correction end to end.

## P1 - Backend Test Coverage

### 12. Turn Use-Case Invariants Into API Regression Tests

**Why it matters:** The repo has many integration tests, but the remaining risks are cross-flow and adversarial. They need tests that intentionally combine valid pieces into invalid stories.

**Must add tests for:**

- Late-entered expense after arrangement change resolves borne-by as of `spentOn`.
- Incident contribution appears in receivables and can be paid/applied from deposit.
- Management fee appears in vehicle month report and partner summary.
- Manager cannot read all-business reports for vehicles they do not manage.
- Expense/trip/incident/post-closure mismatched IDs are rejected.
- Scheduled jobs use per-business timezone.
- Concurrent trip close cannot duplicate driver-fee obligations.

## Suggested Fix Order

1. Arrangement/date scoping.
2. Incident contribution obligations.
3. Management-fee generator.
4. Per-vehicle authorization scoping.
5. Cross-entity relationship validation.
6. Durable overpayments/credits.
7. Scheduler and period-close hardening.
8. DB-backed idempotency for close/correction writes.
9. Trip hold/in-progress semantics.
10. Correction linkage and invariant regression tests.

---

# Validation verdict — 7 August 2026

**Every finding above was re-checked against source before anything was scheduled from it**, the same treatment `UI-UX-REVIEW.md` received, for the same reason: this repository's standing rule is that an incoming review is an input, not an authority. `TRACKER.md` §4 carries the resulting gap ids and §6 carries what did not hold; `Plan.md` carries the scheduling.

**This file existed in two editions today.** A **web edition** (13 findings, web/API/use-case alignment) was validated first; it was then regenerated in place as this **backend edition** partway through that pass. Both were validated and both are cited by edition below, since they overlap on only four items.

## Backend edition — verdicts

| # | Finding | Verdict | Lands as |
|---|---|---|---|
| 1 | Arrangement changes date-aware | ✅ **Confirmed — split into two** (see note below) | **GAP-56 → A12** (money) + **GAP-54 → A13** (flow) |
| 2 | Incident contributions → receivables | ✅ Confirmed — already tracked | GAP-10, already **A10** |
| 3 | Management-fee generator | ✅ Confirmed — already tracked | GAP-39, already **A10** |
| 4 | Durable overpayment credits | ✅ Confirmed — already tracked | **GAP-5**, "correct to leave" |
| 5 | Per-vehicle permission scoping | ✅ Confirmed, **and its status changed** — A11 made it reachable | **GAP-1, re-triaged** |
| 6 | Related ids validated apart, not together | ✅ **Confirmed — new** | **GAP-59** |
| 7 | Per-business timezone in scheduled jobs | ✅ Confirmed — already tracked | **GAP-21**, "correct to leave" |
| 8 | Period-close safeguards | ⚠️ **Downstream, not its own item** — the rows it asks for (missing management fees, unapplied credits, unlinked recoveries) describe facts that do not exist yet; they become checklist rows when A10 and GAP-5 write them, not before | folded into A10 |
| 9 | DB-level idempotency for concurrent close | ✅ Confirmed — already tracked | **GAP-8**, "correct to leave" |
| 10 | Trip hold / in-progress states | ✅ Confirmed — already tracked | **GAP-7**, "correct to leave" |
| 11 | Void-and-replace linkage | ✅ **Confirmed — new** | **GAP-60 → A9b** |
| 12 | Adversarial cross-flow API tests | ✅ Confirmed — its list is the right one | folded into each gap's own "done means" |

## Web edition — verdicts for what it alone raised

| # | Finding | Verdict | Lands as |
|---|---|---|---|
| 4 | Trip payment UI stale after `trip_fare` | ✅ **Confirmed — known but unowned until now** | **GAP-57 → A12** |
| 6 | `/more` lacks monthly workflows | ❌ **Does not hold up** — B0's deliberate "rows for what exists only" rule | nothing scheduled |
| 13 | Test manifest is not executable coverage | ✅ **Confirmed — new** (178 cases, 178 `not_started`, never run, 38 of them P0) | **GAP-58**, unscheduled |

## Three corrections to this document's own conclusions

1. **§1 is one heading over two defects, and they want opposite priorities.** The borne-by half is small, reachable today with one lease and *no arrangement change at all*, and puts wrong money on a named person's balance — U-8 makes back-dating ordinary, so it does not need the arrangement transition the finding builds its case around. The arrangement half is a missing **flow** (F-1.2), not a stale write. Split into **A12** (promoted ahead of everything unbuilt) and **A13** (scheduled, unhurried). §1's "must fix" list leads with the arrangement half; **that ordering should be inverted.**
2. **§1's premise that lease/daily-lease/trip paths "must write or reconcile effective-dated arrangement rows" is wrong about the design.** `vehicle_arrangement` is a *standing configuration* — "this vehicle's business model" — not a derived state, and it is meant to survive leases starting and closing. `createVehicle`'s own doc comment settles it: *"F-1.2 is what ever closes it."* Making the lease paths write it would couple a declaration to the facts it is supposed to outlive. The defect is that **F-1.2 can never change it**, not that other flows fail to.
3. **§8's checklist rows cannot be built before the facts they count exist.** Two of the four name obligations nothing writes yet (§3) and credits nothing persists yet (§4).

## One thing this pass surfaced that the document did not

**A11 expired GAP-1's reason for being unscheduled, and that is what changed — not the gap.** Per-vehicle scoping has sat in "correct to leave" since P7 on an unstated premise: **no `manager` could exist**, because `business-member` was GET-only. A11 (7 Aug) shipped the invite that creates one, `businessMemberRoleSchema` admits `manager`, and `manager` sits in `STAFF` holding `viewReports` across the whole business. So §5's data-leak framing is right, though not for the reason given. **Fourth instance of this repository's own "a gap's reason is a fact with a date on it"** (GAP-13, GAP-23, GAP-3 are the others).

**Operational guard until it is scoped: do not invite a `manager` to a real business.** Recorded against B0b in `Plan.md`.

## Reconciled order

This document's order is right about **§1a** and wrong about **§1b**. Merged with the existing queue, and with the reasoning in `Plan.md`:

**A12** (money, small, on every expense's path) → **B0b** (small, unblocks three items) → **B3** (the only hard date on either track) → **B4 / B5** (two roles with accounts and no screen) → **A10** → **A13**. GAP-1 needs a design call before it needs a slot; GAP-59 and GAP-60 are latent and ride with their neighbours (GAP-60 with A9b).
