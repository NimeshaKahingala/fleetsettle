# FleetSettle API Contract Audit Findings

Date: 2026-08-09

Scope: API contract review across mounted Hono routes, route definitions, shared schemas, frontend API callers, and visible route wiring. This document focuses on contract drift: where a route, schema, frontend caller, or product workflow disagrees about what is available or what failure modes mean.

Companion documents:

- `STATIC-SOURCE-AUDIT-FINDINGS-2026-08-09.md`
- `BACKEND-API-QUERY-EVALUATION-2026-08-09.md`
- `QA-ROOT-CAUSES-AND-REQUIRED-MODIFICATIONS-2026-08-09.md`

## Contract Audit Summary

| ID | Priority | Contract area | Status |
| --- | --- | --- | --- |
| ACA-01 | P1 | API errors vs frontend query states | Contract not consistently consumed |
| ACA-02 | P1 | Daily lease start vs calendar/lost-days reports | Contract contradiction |
| ACA-03 | P1 | Report date-window params | Missing semantic validation |
| ACA-04 | P1 | Partner payment party type | Schema/handler/docs mismatch |
| ACA-05 | P1 | Advance settlement | API exists, current UI lacks completion path |
| ACA-06 | P2 | Driver self/staff history | API exists, route UI is placeholder/incomplete |
| ACA-07 | P2 | Customer detail and statements | API exists, route UI is placeholder |
| ACA-08 | P2 | Backend-only admin/owner workflows | API ahead of UI release surface |
| ACA-09 | P2 | Phase-2 reports | Mounted API, intentionally absent UI |
| ACA-10 | P2 | Role/shell navigation contract | Route tree and shell ownership diverge |
| ACA-11 | P2 | Report empty-state metadata | API cannot distinguish true empty from missing generation |
| ACA-12 | P2 | Integration validation environment | Contract tests currently blocked |

## Route Surface Snapshot

Mounted API groups in `api/src/index.ts`:

- Public/identity: `/api/health`, `/api/ready`, `/api/me`, `/api/business`, `/api/invite`
- Core operations: `/api/vehicle`, `/api/driver`, `/api/customer`, `/api/mileage-package`, `/api/lease`, `/api/daily-lease`, `/api/trip`, `/api/day-record`
- Money operations: `/api/opening-balance`, `/api/expense`, `/api/adjustment`, `/api/advance`, `/api/deposit`, `/api/offset`, `/api/payment`
- Admin/ownership: `/api/business-member`, `/api/ownership-share`, `/api/capital-contribution`, `/api/management-fee-agreement`, `/api/banking-event`, `/api/partner-payout`, `/api/partner`
- Incident/month-end/reporting: `/api/incident`, `/api/audit-log`, `/api/accounting-period`, `/api/write-off`, `/api/post-closure-charge`, `/api/reports`, `/api/driver-view`, `/api/home`

Frontend callers observed in `web/src` cover the phase-1 operational core, most report screens, payment correction, opening balances, and partner summary.

Backend routes with no production frontend caller observed:

- `POST /api/mileage-package`
- `POST /api/mileage-package/{id}/archive`
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
- `GET /api/reports/ageing`
- `GET /api/reports/goodwill`
- `GET /api/reports/utilisation`
- `GET /api/driver-view`

No HTTP `DELETE` routes were found. Destructive domain actions are modeled as `POST` void/archive/revoke/correct operations, which is consistent with the audit trail style in the source.

## ACA-01 - API Error Contract Is Preserved But Not Consistently Rendered

Priority: P1

Contract evidence:

- `api/src/errors/handler.ts` returns a shared `ErrorBody` with `error`, `code`, `requestId`, and optional `details`.
- `api/src/errors/openapi-hook.ts` maps route validation failures into the same error envelope.
- `web/src/lib/api.ts` turns non-2xx responses into `ApiError(status, code, message, requestId)`.
- Many read screens branch only on `query.data === undefined`, so rejected API calls render as loading.

Affected screens found in source:

- `web/src/features/review/ReviewMoneyScreen.tsx`
- `web/src/features/review/ReviewThisMonthScreen.tsx`
- `web/src/features/review/ReviewVehiclesScreen.tsx`
- `web/src/features/reports/VehicleMonthReportScreen.tsx`
- `web/src/features/reports/TripRankingReportScreen.tsx`
- `web/src/features/reports/FuelEfficiencyReportScreen.tsx`
- `web/src/features/reports/ReceivablesReportScreen.tsx`
- `web/src/features/reports/CashPositionReportScreen.tsx`
- `web/src/features/reports/LostDaysReportScreen.tsx`

Root cause:

The route/client contract is adequate, but the UI query-state contract is incomplete. Screens treat "no data yet" as the only non-success state.

Required modifications:

1. Add a shared `QueryState` or `ReportQueryState` component that handles pending, error, empty, and success.
2. Use `query.isError` before checking `query.data`.
3. Render `ApiError.message` and request ID for support/debugging.
4. Disable retry for known stable 401/403/404 states.
5. Add UI tests for each report/review screen with 403, 404, and 500 responses.

## ACA-02 - `POST /api/daily-lease` Conflicts With Calendar And Report Contracts

Priority: P1

Contract evidence:

- `POST /api/daily-lease` returns the newly-created daily lease and rate.
- `GET /api/vehicle/{id}/daily-lease` can then show the daily lease in history.
- `GET /api/vehicle/{id}/calendar` reads only generated `vehicle_day_allocation` rows.
- `GET /api/reports/lost-days` reads only generated `day_record` rows.
- The frontend trip flow reads calendar rows to decide whether it should warn that a trip pauses daily lease days.

Root cause:

One contract says "daily lease exists now"; the adjacent contracts say "daily-lease operational days exist only after generation." The UI has no way to know that the arrangement exists but its generated facts are missing.

Required modifications:

1. Make daily-lease start synchronously generate current operational facts, or explicitly return a generation state that the UI must honor.
2. Make calendar and lost-days endpoints authoritative for active leases even before cron runs.
3. Add response metadata for missing generation if a delayed-generation model is intentionally kept.
4. Add contract tests that call daily-lease start, calendar, lost-days, and trip booking in sequence.

## ACA-03 - Date-Window Contracts Validate Shape But Not Order

Priority: P1

Contract evidence:

- `api/src/route-defs/reports.ts` defines `windowQuery` and `vehicleWindowQuery` with `businessDateSchema` for `from` and `to`.
- No `.refine()` enforces `from <= to`.
- `web/src/app/router.tsx` accepts report search params as date-like strings and does not enforce ordering.
- `GET /api/reports/utilisation` can produce nonsensical day counts because it uses `inclusiveDays(from, to)`.

Root cause:

The API has a field-level contract but not a range-level contract.

Required modifications:

1. Add a shared ordered date-window schema.
2. Use it for report routes and similar ranged endpoints.
3. Return 400 with field-specific details when `from > to`.
4. Mirror the same rule in UI date controls to prevent avoidable requests.

## ACA-04 - `POST /api/payment` Allows `partner` In Schema But Handler/Docs Do Not Fully Validate It

Priority: P1

Contract evidence:

- `packages/shared/src/schemas/lease-billing.ts` allows `partyType: "customer" | "driver" | "partner"`.
- `api/src/handlers/payment.ts` validates customer and driver IDs, but does not validate a partner ID as an active business member.
- `api/src/route-defs/payment.ts` documents 404 as "No such customer or driver in this business"; partner is omitted.
- `api/src/domain/payment.ts` writes `partyUserId` when `partyType === "partner"`.

Root cause:

The shared schema has a broader party contract than the route handler and route documentation actually enforce.

Required modifications:

1. Decide whether generic partner payments are currently supported.
2. If supported, validate `partyId` against active business members and update the 404 description.
3. If not supported, remove `partner` from the payment request schema until a partner-payment workflow exists.
4. Add tests for valid partner payments, cross-business partner IDs, revoked partner IDs, and unknown partner IDs.

## ACA-05 - Advance Settlement Exists In API But Has No UI Completion Path

Priority: P1

Contract evidence:

- `api/src/route-defs/advance.ts` exposes `POST /api/advance/{id}/settle`.
- `web/src/features/people/AdvanceSheet.tsx` creates advances.
- No production frontend caller for `/api/advance/{id}/settle` was found.
- `api/src/queries/accounting-period.ts` close checklist counts unreconciled advances.

Root cause:

The API can create and settle advances, but the visible UI appears to only create them. Users can create a condition that close-month warns about without an obvious app-native resolution path.

Required modifications:

1. Add advance settlement actions on driver detail and any trip close/cancel unresolved-advance flow.
2. Link close-month unreconciled advance warnings to the relevant driver/trip/advance action.
3. Add UI tests for partial settlement, full settlement, over-settlement error, and close-checklist resolution.

## ACA-06 - Driver Self/History Contracts Are Built But UI Is Incomplete

Priority: P2

Contract evidence:

- `GET /api/driver-view` is mounted for linked drivers.
- `GET /api/driver/{id}/view` is mounted for staff viewing a driver's history.
- `web/src/app/router.tsx` renders `/me` as `NotBuiltYetScreen`.
- `web/src/features/people/DriverDetailScreen.tsx` reads only driver details and balances, not the history endpoint.

Root cause:

The backend has the read models for driver history and self-service, but the visible route surface does not consume them.

Required modifications:

1. Build the `/me` driver self-view from `GET /api/driver-view`.
2. Add a staff driver history section using `GET /api/driver/{id}/view`.
3. Add linked-driver route tests proving a driver sees only their own records.
4. Add owner/manager tests for the staff history route.

## ACA-07 - Customer Detail Route Is Navigable But Still Placeholder

Priority: P2

Contract evidence:

- `web/src/features/people/PeopleListScreen.tsx` navigates customers to `/people/customers/$customerId`.
- `web/src/app/router.tsx` renders that route with `NotBuiltYetScreen`.
- Backend routes exist for `GET /api/customer/{id}`, `GET /api/customer/{id}/obligation`, and `GET /api/customer/{id}/payment`.

Root cause:

The UI navigation promises a customer detail workflow, while the route resolves to a placeholder despite having enough API contracts for a useful first version.

Required modifications:

1. Build a customer detail screen showing profile, outstanding obligations, and recent payments.
2. Add collect-payment and post-closure/write-off entry points where appropriate.
3. Add tests for empty dues, open dues, payment history, and cross-tenant 404 rendering.

## ACA-08 - Owner/Admin Workflow APIs Are Ahead Of The Product UI

Priority: P2

Contract evidence:

The following tested or mounted API groups have no production UI caller observed:

- Business member invite/revoke/change-role.
- Driver link invite/unlink.
- Vehicle document upsert.
- Mileage package create/archive.
- Ownership shares.
- Capital contributions.
- Management fee agreements and revoke.
- Banking events.
- Partner payouts.
- Write-off and recovery.
- Post-closure charge.

Root cause:

Backend contracts are available, but the app shell does not expose the workflows. This makes QA coverage uneven and leaves business-critical owner/admin operations dependent on API-only access.

Required modifications:

1. Create a release-surface matrix for every mounted route: visible now, internal only, or phase-later.
2. Hide or explicitly defer UI references that imply unavailable actions.
3. Prioritize UI for workflows that unblock current operations: document renewal, member/driver invites, advance settlement, write-off, and post-closure charges.
4. Add a contract test that fails when a route is promoted to "visible now" without a frontend caller or route.

## ACA-09 - Phase-2 Report APIs Are Mounted While UI Intentionally Omits Them

Priority: P2

Contract evidence:

- `api/src/routes/reports.ts` mounts `/ageing`, `/goodwill`, and `/utilisation`.
- `web/src/features/reports/ReportsCatalogueScreen.tsx` intentionally exposes only six phase-1 reports.
- `web/src/app/App.test.tsx` asserts goodwill, ageing, and utilisation are not shown and `/reports/goodwill` is not resolved.

Root cause:

The backend and frontend intentionally disagree for phase management. That is acceptable, but it should be documented as a release contract so hidden routes do not become stale or accidentally user-facing.

Required modifications:

1. Mark phase-2 report routes as internal/hidden in docs or deployment notes.
2. Keep integration tests for mounted backend routes until they are either exposed or removed.
3. When exposing them, add frontend routes, catalogue entries, role-gated owner-only sections, and query error handling.
4. Finish report-specific semantics before UI release, especially goodwill sign handling and utilisation's missing revenue-per-available-day decision.

## ACA-10 - Route Tree And Shell Ownership Contracts Diverge

Priority: P2

Contract evidence:

- `FirstRunGate` renders `owner_manager` and `manager` inside the Operate shell.
- `/review*` and `/reports*` are sibling routes in the same root route tree.
- `tabForPathname()` maps only `/vehicles`, `/people`, and `/more`; other routes fall back to Home.
- The Review shell has its own tab mapping for `/review*` and `/reports*`, but owner-managers do not render that shell.

Root cause:

The route contract says review/report paths exist for multiple roles, but the shell contract says owner-manager stays in Operate. The tab-state contract then has no owner for those paths.

Required modifications:

1. Decide whether owner-manager should see Review shell routes or Operate shell routes for review/reporting.
2. Map every visible route to a shell/tab owner.
3. Add router tests for tab selection across all report, review, period-close, and entity detail paths.

## ACA-11 - Report Empty Responses Lack Diagnostic Metadata

Priority: P2

Contract evidence:

- `GET /api/reports/lost-days` returns an array only.
- `GET /api/vehicle/{id}/calendar` returns occupied days only; absence means "free."
- If generation has not created day records, `lost-days` and calendar can appear truthfully empty by shape but misleading by business meaning.

Root cause:

The API uses compact list responses for reports that can be empty for multiple reasons. The response shape does not expose whether the business had active source records but missing derived facts.

Required modifications:

1. Add metadata for report windows where missing generation matters, such as `sourceCount`, `generatedThrough`, or `generationWarnings`.
2. Use that metadata in UI empty states.
3. Add tests for true empty vs source-exists-but-generated-facts-missing.

## ACA-12 - Integration Contract Validation Is Blocked By Stale Database Credentials

Priority: P2

Contract evidence:

- Earlier source validation passed typecheck and unit tests.
- Integration execution against the configured Neon database was blocked by `password authentication failed for user 'neondb_owner'`.

Root cause:

The local test database connection is no longer valid, so the API contract cannot be fully verified against integration tests from this workspace.

Required modifications:

1. Refresh `DATABASE_URL` and `TEST_DATABASE_URL`.
2. Run the full API integration suite.
3. Add a small CI preflight that fails fast with a clear "test database credentials invalid" message before running long integration tests.

## Contract Areas That Look Healthy

- Validation failures now use a shared API error envelope.
- The frontend API client preserves backend status, code, message, and request ID.
- The API avoids hard deletes for business-domain removals; void/archive/revoke/correct patterns preserve auditability.
- Cross-tenant "not found" behavior is consistently documented in many route definitions.
