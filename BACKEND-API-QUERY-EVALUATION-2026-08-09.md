# FleetSettle Backend API And Query Logical Evaluation

Date: 2026-08-09

Environment reviewed: local source for the QA-deployed app, plus attempted integration validation against the configured test database.

Companion documents:

- `QA-COMPREHENSIVE-TEST-FINDINGS-2026-08-08.md`
- `QA-ROOT-CAUSES-AND-REQUIRED-MODIFICATIONS-2026-08-09.md`

## Validation Run

Commands run:

- `npm run typecheck -w @fleetsettle/api` - passed.
- `npm test -w @fleetsettle/api` - passed: 3 files, 10 unit tests.
- Targeted integration run for reports, daily lease, scheduled jobs, trip, partner summary, expense, and incident - blocked.
- `npm run migrate:status -w @fleetsettle/api` - blocked by configured database credentials.

Integration blocker:

- Initial sandboxed database commands failed DNS resolution to Neon.
- With unrestricted network, the migration status command reached Neon but failed with `password authentication failed for user 'neondb_owner'`.
- Therefore the integration failures are not valid product failures yet. The local `DATABASE_URL` / `TEST_DATABASE_URL` credentials need refreshing before backend behavior can be confirmed by tests.
- Source re-check: `business.go_live_date` is present in `api/migrations/0001_initial_schema.sql`, so the fixture insert shape is not explained by committed migration drift.

## BE-01 - Daily-Lease Setup Does Not Immediately Materialize Calendar Or Day Records

Priority: P1

Status: current hosted defect and source-confirmed backend gap.

Root cause:

- `api/src/domain/dailyLease.ts` writes only `daily_lease` and `daily_lease_rate`.
- `api/src/route-defs/dailyLease.ts` documents that `vehicle_day_allocation` and `day_record` are left to `generate-day-cards`.
- `api/src/domain/day-card-generation.ts` is the only path that writes arrangement `B` allocation rows and current-period day records.
- `api/src/queries/vehicle.ts` reads calendar state only from `vehicle_day_allocation`.
- `api/src/queries/reports.ts` reads lost days only from `day_record`.
- `api/tests/integration/dailyLease.test.ts` tests setup only; `api/tests/integration/scheduled.test.ts` tests generation separately. There is no test for "start daily lease, then immediately read calendar or report."

Required modifications:

1. Factor daily-lease calendar materialization into a shared idempotent service.
2. Call it from daily-lease start/update flows and from the scheduled job.
3. Create current-period `day_record` rows synchronously when an open period and active rate exist.
4. Add API tests for immediate calendar/report visibility after daily-lease setup.
5. Add server-side trip booking protection against active daily-lease conflicts even when client calendar data is stale.

## BE-02 - Report And Partner-Capital Access Is Business-Wide, Not Vehicle-Scoped

Priority: P1

Status: source-confirmed design/security debt.

Root cause:

- `api/src/auth/policy.ts` documents that `managePartnerCapital` and `viewReports` are flat role checks.
- `viewReports` gives owner, owner-manager, and manager access to broad reports.
- `api/src/handlers/reports.ts` validates capability, then passes only `businessId` into report domains.
- Broad report queries such as receivables, cash position, trip ranking, lost days, and vehicle month do not take a caller-specific visible-vehicle set.
- The source comment says the intended "shared vehicles only" manager rule is not implemented yet.

Required modifications:

1. Define `visibleVehicleIds` and `manageableVehicleIds` per role.
2. Apply those scopes inside report domain/query functions, not only in UI.
3. Scope partner-capital APIs by ownership/management rules, not just business membership.
4. Add adversarial manager tests proving a manager cannot read vehicles, ownership, partner capital, payouts, or reports outside their scope.
5. Until fixed, do not invite a real `manager` into a multi-vehicle/multi-owner business with sensitive data.

## BE-03 - Related IDs Are Validated Independently, Not As One Coherent Business Event

Priority: P1

Status: source-confirmed API integrity gap.

Root cause:

- `api/src/handlers/expense.ts` verifies `vehicleId`, `tripId`, and `incidentId` each belong to the business, but does not verify that the trip or incident belongs to the supplied vehicle.
- `api/src/handlers/incident.ts` verifies optional `leaseId` belongs to the business, but does not verify that the lease belongs to the same vehicle as the incident.
- `api/src/handlers/post-closure-charge.ts` verifies the source lease/trip and party IDs independently, but does not require the party/vehicle/source relationship to match.
- The database schema has foreign keys, but not composite constraints that express "this trip's expense must use this trip's vehicle."

Required modifications:

1. In expense creation, reject a `tripId` whose `trip.vehicleId` differs from `body.vehicleId` when both are supplied.
2. In expense creation, reject an `incidentId` whose `incident.vehicleId` differs from `body.vehicleId` when both are supplied.
3. In incident creation, reject a `leaseId` whose `lease.vehicleId` differs from the incident vehicle.
4. In post-closure charges, derive party and vehicle from the source lease/trip by default, and require an explicit audited override if mismatches are intentionally allowed.
5. Add adversarial integration tests that combine individually valid IDs into an invalid story.

## BE-04 - Unallocated Payments Are Returned But Not Persisted As Credits

Priority: P1

Status: source-confirmed money completeness gap.

Root cause:

- `api/src/domain/payment.ts` allocates a payment oldest-first and returns `unallocatedMinor`.
- There is no durable customer/driver/partner credit or current-account table for surplus money.
- Future obligations cannot automatically consume prior surplus because the surplus is not represented as a reusable ledger fact.
- Payment correction and statements cannot fully explain surplus after the response has gone away.

Required modifications:

1. Add a durable credit/current-account representation for unallocated received or paid money.
2. Decide whether future obligations auto-apply credit oldest-first or require an explicit apply-credit action.
3. Include credits in customer/driver/partner statements and close-month checks.
4. Add tests for overpayment, future due creation, correction/reversal, and reporting.

## BE-05 - Management Fee Agreement And Vehicle Profit Report Do Not Share One Money Source

Priority: P1

Status: source-confirmed report correctness gap.

Root cause:

- `api/src/queries/reports.ts` includes `obligation.kind IN ('driver_fee', 'management_fee')` as vehicle costs.
- No current generator writes `management_fee` obligations.
- `api/src/queries/partner.ts` therefore calculates a manager's management-fee earning directly from `management_fee_agreement.monthly_amount_minor`.
- Result: partner summary can show management-fee earnings while vehicle month profit does not subtract the corresponding management-fee cost.

Required modifications:

1. Add a management-fee generator that posts period obligations from active `management_fee_agreement` rows.
2. Reuse the accounting-period linkage model used by rent/billing generation.
3. Make partner summary read the generated obligations once they exist, or explicitly reconcile direct agreement reads with posted obligations.
4. Add tests proving management fee reduces vehicle profit and increases the manager's earned/balance figures exactly once.
5. Add close-checklist warning for missing management-fee obligations until generation is complete.

## BE-06 - Report Date Windows Do Not Validate `from <= to`

Priority: P1

Status: source-confirmed API validation gap.

Root cause:

- `api/src/route-defs/reports.ts` validates `from` and `to` as business-date strings but does not refine their order.
- `getFuelEfficiencyReport`, `getLostDaysReport`, and `getGoodwillReport` will generally return empty data for an inverted range.
- `getUtilisationReport` calls `inclusiveDays(from, to)`, which can produce a zero or negative total-day count for an inverted range.

Required modifications:

1. Add shared date-window schemas with `from <= to` validation.
2. Use the shared schema in report routes and other date-window endpoints.
3. Return 400 validation errors for inverted ranges.
4. Add integration tests for inverted windows on fuel efficiency, lost days, goodwill, and utilisation.

## BE-07 - Review Money Endpoint Has Valid 403/404 Failure Modes That The UI Masks

Priority: P1

Status: source-confirmed UI/API contract gap.

Root cause:

- `api/src/route-defs/partner.ts` explicitly allows 403 and 404 from `GET /api/partner/{userId}`.
- `api/src/handlers/partner.ts` requires `managePartnerCapital`.
- `api/src/domain/partner.ts` returns 404 when no open accounting period exists.
- `web/src/features/review/ReviewMoneyScreen.tsx` renders loading whenever `query.data === undefined`, without checking `query.isError`.

Required modifications:

1. Add an error branch in `ReviewMoneyScreen`.
2. Show API error copy for no open period, no permission, or missing partner.
3. Disable retries for stable 403/404 states.
4. Decide whether owner-manager self-summary belongs under `managePartnerCapital` or a narrower self-read capability.
5. Add UI tests for 403, 404, and success.

## BE-08 - Scheduled Jobs Use One Global Business Date

Priority: P1

Status: source-confirmed scheduler gap.

Root cause:

- `api/src/scheduled.ts` calls `businessToday()` once.
- The default timezone is `Asia/Colombo`.
- `business.timezone` exists, and request handlers use `businessToday(requireBusinessTimezone(c))`.
- Scheduled jobs are global and unscoped, so they currently cannot respect different business timezones.

Required modifications:

1. Query active businesses with their timezone.
2. Run day-card generation and billing-period generation per business date.
3. Change scheduled-job result logging to group by business/date.
4. Add tests for a business whose local date differs from the Worker/default date.

## BE-09 - Close Checklist Counts Existing Rows, So Missing Generated Facts Stay Invisible

Priority: P2

Status: source-confirmed month-end trust gap.

Root cause:

- `api/src/queries/accounting-period.ts` counts open `day_record` rows for unconfirmed daily-lease days.
- If day-card generation has not materialized rows, the checklist under-reports unconfirmed days.
- The checklist cannot detect missing management-fee obligations or durable payment credits because those facts are not written yet.
- The domain deliberately warns but does not block close, which is acceptable only if the warnings are complete enough to trust.

Required modifications:

1. Before close, run or simulate day-card generation through period end.
2. Add warning rows for generation failures/missing day records.
3. Add warning rows for missing management fees once the management-fee generator is specified.
4. Add warning rows for unallocated credits once durable credits exist.
5. Keep close non-blocking, but make the warning set actionable.

## BE-10 - Phase-2 Report Endpoints Are Mounted Even Where UI Intentionally Omits Them

Priority: P2

Status: source-confirmed API surface risk, not a phase-1 UI bug.

Root cause:

- `api/src/routes/reports.ts` mounts `/ageing`, `/goodwill`, and `/utilisation`.
- Current web routing and `ReportsCatalogueScreen` intentionally expose only six phase-1 reports.
- B4 planning says UC-77, UC-78, and UC-79 are phase 2 even though backend endpoints exist.
- Goodwill and utilisation remain incomplete for their full use cases:
  - `sumGoodwillGiven` sums `amountMinor` for goodwill/waiver types without applying `adjustment.sign`; schema only forces `sign = -1` for waiver/auto-waiver, not goodwill.
  - utilisation returns day counts but not revenue per available day.

Required modifications:

1. Keep these routes owner-gated and out of the phase-1 UI until the phase decision changes.
2. Add explicit endpoint documentation that these are backend-ahead-of-UI surfaces.
3. For goodwill, either enforce goodwill sign semantics in schema/domain or make the query sum signed values where that is the product rule.
4. For utilisation, add the missing revenue-per-available-day contract before rendering a comparison-heavy UI.

## BE-11 - Partner Payment Party Is Accepted But Not Membership-Validated

Priority: P2

Status: source-confirmed API validation gap.

Root cause:

- `packages/shared/src/schemas/lease-billing.ts` allows `partyType: "partner"` for `recordPaymentRequestSchema`.
- `api/src/handlers/payment.ts` validates customer and driver party IDs, but explicitly does not validate partner IDs.
- The payment table can reference an `app_user`, but that does not prove active membership in the current business.

Required modifications:

1. If partner payments are in scope, validate `partyId` against active `business_member`.
2. If partner payments are not in scope yet, remove `partner` from the request schema until supported.
3. Add integration tests for a non-member app user, revoked member, and member of another business.

## BE-12 - Integration Validation Is Blocked By Stale/Invalid Local Database Credentials

Priority: P2

Status: environment/tooling blocker.

Root cause:

- The configured Neon credentials used by local migration/test commands are no longer valid.
- With unrestricted network, `migrate:status` fails with password authentication for `neondb_owner`.
- Targeted integration tests cannot currently distinguish real regressions from setup failures.

Required modifications:

1. Refresh `DATABASE_URL` and `TEST_DATABASE_URL` in local/CI configuration.
2. Run `npm run migrate:status -w @fleetsettle/api`.
3. Run `npm run migrate:check -w @fleetsettle/api`.
4. Re-run targeted integration tests:
   - `reports.test.ts`
   - `dailyLease.test.ts`
   - `scheduled.test.ts`
   - `trip.test.ts`
   - `partner-summary.test.ts`
   - `expense.test.ts`
   - `incident.test.ts`

## Suggested Backend Fix Order

1. BE-01 daily-lease materialization and trip conflict guard.
2. BE-03 cross-entity coherence validation.
3. BE-05 management-fee generator/report consistency.
4. BE-02 per-vehicle authorization scoping.
5. BE-04 durable unallocated credits.
6. BE-06 date-window validation.
7. BE-07 review money error handling.
8. BE-08 scheduled job timezone handling.
9. BE-09 close checklist hardening.
10. BE-10 phase-2 report endpoint contract cleanup.
11. BE-11 partner payment membership validation.
12. BE-12 refresh test DB credentials and keep integration tests runnable.

## Backend Definition Of Done

- API typecheck and unit tests pass.
- Migration status/check can reach the configured test database.
- Targeted integration tests pass on a current migrated database.
- Start daily lease -> immediate calendar/report/trip behavior is covered by tests.
- Adversarial same-business mismatches are rejected by API tests.
- Manager data-scope tests prove reports and capital APIs do not leak unrelated vehicles or ownership data.
- Month-end close checklist warns on missing generated facts, not only facts already written.
