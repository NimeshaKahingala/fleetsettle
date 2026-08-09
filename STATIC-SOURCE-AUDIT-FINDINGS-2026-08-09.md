# FleetSettle Static Source Audit Findings

Date: 2026-08-09

Scope: local source review of the deployed QA application areas requested after the latest fixes. This pass focused on implementation logic that can create user-visible gaps without needing another browser interaction.

Companion documents:

- `QA-COMPREHENSIVE-TEST-FINDINGS-2026-08-08.md`
- `QA-ROOT-CAUSES-AND-REQUIRED-MODIFICATIONS-2026-08-09.md`
- `BACKEND-API-QUERY-EVALUATION-2026-08-09.md`
- `API-CONTRACT-AUDIT-FINDINGS-2026-08-09.md`

## Static Audit Summary

| ID | Priority | Area | Status |
| --- | --- | --- | --- |
| SSA-01 | P1 | Daily-lease calendar/day-record materialization | Source-confirmed gap |
| SSA-02 | P1 | Vehicle-scoped authorization | Source-confirmed design debt |
| SSA-03 | P1 | Cross-entity relationship validation | Source-confirmed integrity gap |
| SSA-04 | P1 | Payment surplus/current-account handling | Source-confirmed money gap |
| SSA-05 | P1 | Management-fee accounting | Source-confirmed report correctness gap |
| SSA-06 | P1 | Date-window validation | Source-confirmed validation gap |
| SSA-07 | P1 | Query error rendering in frontend screens | Source-confirmed UX/reliability gap |
| SSA-08 | P2 | Scheduled jobs and close checklist | Source-confirmed operational gap |
| SSA-09 | P2 | Workflow endpoints without UI completion paths | Source-confirmed product gap |
| SSA-10 | P2 | Navigation state for non-tab routes | Source-confirmed UX gap |

## SSA-01 - Daily-Lease Setup Does Not Materialize Calendar Facts

Priority: P1

Source evidence:

- `api/src/domain/dailyLease.ts` writes only `daily_lease` and `daily_lease_rate`.
- `api/src/route-defs/dailyLease.ts` documents that `vehicle_day_allocation` and `day_record` are left to `generate-day-cards`.
- `api/src/domain/day-card-generation.ts` is the only implementation that creates arrangement `B` allocation rows and current-period day records.
- `api/src/queries/vehicle.ts` reads the vehicle calendar only from `vehicle_day_allocation`.
- `api/src/queries/reports.ts` reads lost days only from `day_record`.
- `web/src/features/vehicles/VehicleCalendarScreen.tsx` treats an absent calendar row as a free day.
- `web/src/features/trips/BookTripScreen.tsx` calculates daily-lease pause messaging only from the calendar response.

Root cause:

The source of truth is split between the arrangement write (`daily_lease`) and derived operational facts (`vehicle_day_allocation`, `day_record`). The setup command returns success before the derived facts exist, while the UI and reports already depend on those facts as if they are immediate.

Required modifications:

1. Extract daily-lease allocation/day-record materialization into a shared idempotent service.
2. Call that service from daily-lease start/update flows and from the existing cron.
3. Materialize arrangement `B` allocation rows synchronously for at least the current open period plus the current rolling horizon.
4. Materialize current-period `day_record` rows synchronously when a rate exists.
5. Add server-side trip booking conflict protection against active daily-lease dates, so stale client data cannot create a silent overlap.
6. Add integration tests for "start daily lease, then immediately read calendar/lost-days/book-trip."

## SSA-02 - Report And Partner-Capital Access Is Not Vehicle-Scoped

Priority: P1

Source evidence:

- `api/src/auth/policy.ts` explicitly documents `managePartnerCapital` and `viewReports` as flat role checks.
- `api/src/handlers/reports.ts` checks only `viewReports` or `viewOwnerOnlyReports`, then passes `businessId` to report domains.
- Partner-capital handlers in `api/src/handlers/partner.ts` use `managePartnerCapital` without a per-vehicle ownership/management scope.

Root cause:

The capability model knows only business-level roles. It does not compute the set of vehicles a manager or owner-manager is allowed to see/manage, even though the source comments say that "shared vehicles only" is an intended rule.

Required modifications:

1. Add a role-aware scope resolver that returns visible/manageable vehicle IDs for the caller.
2. Apply that resolver in report domains and partner-capital domains, not only in the UI.
3. For non-vehicle reports, decide whether managers can see all parties or only parties connected to visible vehicles.
4. Add adversarial tests with two vehicles and two ownership/management arrangements.

## SSA-03 - Related IDs Are Validated Independently, Not Coherently

Priority: P1

Source evidence:

- `api/src/handlers/expense.ts` checks that `vehicleId`, `tripId`, `incidentId`, `borneByDriverId`, and `borneByCustomerId` belong to the business, but does not verify that those IDs describe the same story.
- `api/src/handlers/incident.ts` checks an optional `leaseId` belongs to the business, but not that the lease belongs to the incident vehicle.
- `api/src/handlers/post-closure-charge.ts` checks source lease/trip and party IDs independently, then writes the charge with caller-supplied relationships.

Root cause:

Tenant validation is present, but relationship validation is incomplete. The database protects foreign keys, but it does not encode composite rules such as "an expense with this trip must use that trip's vehicle."

Required modifications:

1. Reject an expense where `tripId` belongs to a different vehicle than `vehicleId`.
2. Reject an expense where `incidentId` belongs to a different vehicle than `vehicleId`.
3. Reject an incident where `leaseId` belongs to a different vehicle than `vehicleId`.
4. For post-closure charges, derive party/vehicle from source where possible and require an explicit override path for exceptions.
5. Add integration tests that combine valid same-business IDs into invalid cross-entity combinations.

## SSA-04 - Payment Surplus Is Returned But Not Persisted As Reusable Credit

Priority: P1

Source evidence:

- `api/src/domain/payment.ts` returns `unallocatedMinor` after oldest-first allocation.
- No durable customer/driver/partner credit table or current-account ledger exists in the searched source.
- Existing queries can reconstruct allocations, but not apply surplus automatically to future obligations.

Root cause:

The API recognizes overpayment/retainer money at response time, but the unallocated amount is not represented as a durable ledger fact that later screens or obligations can consume.

Required modifications:

1. Add a durable credit/current-account representation for unallocated payment surplus.
2. Define whether future obligations auto-apply credit or require an explicit apply-credit action.
3. Include credit rows in statements, partner/customer/driver money views, and close-month checks.
4. Add tests for overpayment, later obligation creation, correction/reversal, and reporting.

## SSA-05 - Management Fees Are Not Posted Into The Vehicle P&L Ledger

Priority: P1

Source evidence:

- `api/src/queries/reports.ts` includes `obligation.kind IN ('driver_fee', 'management_fee')` as vehicle costs.
- `api/src/queries/partner.ts` calculates management-fee earnings directly from `management_fee_agreement`.
- `api/src/domain/partner.ts` adds management fee into partner earned/balance calculations from the agreement path.
- No generator was found that posts `management_fee` obligations from active agreements.

Root cause:

Partner summary can show management-fee earnings from agreements, while vehicle month profit only subtracts management fees if matching obligations exist. Those two paths do not share a single posted money fact.

Required modifications:

1. Add a period management-fee generator that creates `owed_by_us` `management_fee` obligations from active agreements.
2. Make vehicle month reports and partner summaries read the same generated facts, or add explicit reconciliation if direct agreement reads remain.
3. Add close-checklist warning for missing management-fee obligations until generation is complete.
4. Add tests proving the fee reduces vehicle profit and increases manager earned/balance exactly once.

## SSA-06 - Date Windows Accept `from > to`

Priority: P1

Source evidence:

- `api/src/route-defs/reports.ts` validates `from` and `to` as date-shaped strings only.
- `api/src/domain/reports.ts` passes those values into fuel efficiency, lost days, goodwill, and utilisation calculations.
- `getUtilisationReport` uses `inclusiveDays(from, to)`, which can produce zero or negative `totalDays` for inverted windows.
- `web/src/app/router.tsx` accepts report search params as date-like strings and does not enforce ordering.

Root cause:

The contract validates field shape but not the semantic ordering of date ranges.

Required modifications:

1. Add a shared `dateWindowSchema` with `from <= to`.
2. Use it for reports, vehicle calendar, driver history, driver-view, payment filters, expense filters, and write-off filters where applicable.
3. Return a 400 validation error for inverted ranges.
4. Add API and UI tests for inverted date windows.

## SSA-07 - Query Errors Are Often Rendered As Permanent Loading

Priority: P1

Source evidence:

- `web/src/lib/api.ts` throws `ApiError` with status/code/message/requestId for non-2xx responses.
- Report and review screens often render loading whenever `query.data === undefined`.
- Confirmed examples include `ReviewMoneyScreen`, `ReviewThisMonthScreen`, `VehicleMonthReportScreen`, `TripRankingReportScreen`, `FuelEfficiencyReportScreen`, `ReceivablesReportScreen`, `CashPositionReportScreen`, and `LostDaysReportScreen`.

Root cause:

The API client preserves useful error information, but many read screens do not branch on `query.isError`. React Query rejected states therefore look the same as pending states.

Required modifications:

1. Introduce a shared query-state component for loading, error, empty, and success.
2. Render `ApiError.message`, `code`, and request ID where useful.
3. Disable retries for stable 401/403/404 errors.
4. Add UI tests for 403/404/500 on every read-heavy report/review screen.

## SSA-08 - Scheduled Jobs And Close Checklist Can Miss Generated Facts

Priority: P2

Source evidence:

- `api/src/scheduled.ts` calls `businessToday()` once using the default timezone.
- Request handlers use `businessToday(requireBusinessTimezone(c))`, so request flow and scheduled flow have different timezone behavior.
- `api/src/queries/accounting-period.ts` counts existing `day_record` rows for close warnings.

Root cause:

The scheduled path is global, while business logic is supposed to be timezone-aware. The close checklist trusts generated rows that may not exist yet.

Required modifications:

1. Run scheduled jobs per business/timezone.
2. Log scheduled results per business and business date.
3. Before close, generate or simulate required daily-lease facts through period end.
4. Add warnings for generation failures and missing facts.

## SSA-09 - Several Backend Workflows Have No UI Completion Path

Priority: P2

Source evidence:

- Backend routes exist for workflow actions that have no matching frontend caller in `web/src`:
  - `POST /api/advance/{id}/settle`
  - `GET /api/driver/{id}/view`
  - `POST /api/driver/{id}/link-invite`
  - `POST /api/driver/{id}/unlink`
  - `PUT /api/vehicle/{id}/document`
  - `POST /api/business-member/invite`
  - `POST /api/business-member/{id}/revoke`
  - `POST /api/business-member/{id}/change-role`
  - `POST/GET /api/ownership-share`
  - `POST/GET /api/capital-contribution`
  - `POST/GET /api/management-fee-agreement`
  - `POST /api/management-fee-agreement/{id}/revoke`
  - `POST/GET /api/banking-event`
  - `POST/GET /api/partner-payout`
  - `GET/POST /api/write-off`
  - `POST /api/write-off/{id}/recovery`
  - `POST /api/post-closure-charge`

Root cause:

The backend and integration tests have advanced past the visible product shell. That is acceptable only if the endpoints are intentionally internal or phase-later and users are not blocked by missing UI.

Required modifications:

1. Classify each backend-only endpoint as `internal`, `phase-later`, or `required for QA release`.
2. Build UI paths for endpoints that resolve current user-facing warnings or tasks, especially advance settlement, driver invite/unlink, paperwork renewal, write-off, and post-closure charge.
3. Hide or soften UI warnings that require an unavailable action path.
4. Add route/caller tests for each endpoint promoted to product UI.

## SSA-10 - Non-Tab Routes Fall Back To Home In The Operate Shell

Priority: P2

Source evidence:

- `web/src/app/router.tsx` maps only `/vehicles`, `/people`, and `/more` to non-home operate tabs.
- Real routes such as `/reports`, `/period/close`, `/opening-balances`, `/incidents/:id`, `/trips/:id`, and `/leases/:id` are siblings under the same root route.

Root cause:

The tab selection helper is route-prefix based and does not model route ownership for screens launched from More, Vehicles, or cross-entry detail flows.

Required modifications:

1. Map More-owned routes such as `/reports`, `/period/close`, and `/opening-balances` to `more`.
2. Choose a stable policy for entity detail routes: domain parent, route state origin, or no active tab.
3. Add router tests that assert active tab behavior for every major route.

## Positive Findings

- The shared API client preserves structured error fields from the backend.
- The backend now uses a shared OpenAPI validation hook that returns one error envelope.
- Expense voiding has been centralized through shared UI pieces rather than repeated inline blocks.
- `business.go_live_date` exists in the initial schema and was not found to be a committed migration drift issue.

## Validation Note

This audit was source-based. Earlier backend integration execution was blocked by stale Neon credentials: unrestricted migration status reached the database and failed with `password authentication failed for user 'neondb_owner'`. Refresh `DATABASE_URL` / `TEST_DATABASE_URL` before treating live integration coverage as complete.
