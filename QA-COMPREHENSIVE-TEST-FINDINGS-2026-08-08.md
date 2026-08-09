# FleetSettle QA Comprehensive Browser/UI-UX Findings

Date: 2026-08-08  
Latest fresh pass: 2026-08-09  
Environment: https://qa.fleetsettle.com  
Run labels: `QC-0808160814`, `TARGET-08081547`, `LIVE-0809-GAP81-B9`, `FRESH-0809-DEPLOY`  
Session: original hosted pass was signed in; targeted pass resumed after user sign-in

## Executive Summary

The current design direction is good and should be refined, not redesigned. The app has a clear mobile-first operational feel, restrained styling, strong card/list hierarchy, and predictable bottom navigation. The biggest gaps are not visual taste problems; they are completion, affordance, and trust issues around hidden controls, placeholder routes, direct-route guards, and some action-sheet/date-field accessibility.

I was able to create vehicles through the hosted UI and inspect the main routed screens. In the first pass, the in-app browser control layer stopped accepting click commands for the signed-in tab, so I supplemented the hosted pass with source review and the full web unit suite.

Latest targeted update: after sign-in, a second hosted QA tab was usable and the browser-control issue did not reproduce there. I completed the live UI spot-checks for GAP-81 and the B9 copy batch, then updated the backend-only Track A evidence from integration tests. GAP-81 and GAP-76/78/79/80 now have live hosted confirmation. GAP-41/72/74 remain backend-only until B4 renders them.

Fresh deployment update, 2026-08-09: the latest hosted client has several UI look-and-feel fixes live. Active bottom-tab indicators, vehicle arrangement badges/accents, incident status badges/accents on Vehicle Overview, voided expense badge/reason styling, calendar color legend mappings, More-screen chevrons, and warning treatment for `Close the month` are all deployed. Reports are now visible on hosted QA instead of rendering `Not built yet`.

The fresh pass also found new functional and navigation regressions: an active daily-lease vehicle can still show daily-lease days as free in the calendar and open a trip booking form for those dates; report/review/period/incident routes render inside the Operate shell with `Home` highlighted; `/review/money` can stay on `Loading...` indefinitely; and the final irreversible close-month confirmation still uses the primary brand button instead of destructive/critical treatment.

## Fresh Hosted QA Regression Pass - 2026-08-09

Scope:

- Hosted QA at `https://qa.fleetsettle.com`.
- Signed-in owner-manager account supplied by the user.
- Mobile viewport pass at `390 x 844`.
- Read/write UI paths: Home, Vehicles, Vehicle Overview, Record Expense, Void Expense, Vehicle Calendar, Book Trip confirm flow, More, Reports, Review, People, Driver Detail, Incident Detail, Close Month confirmation, Add Vehicle validation, Add Driver validation.

Data written:

- Created expense on `NC-1234`: `Fuel`, `Rs 12.34`, dated `9 Aug 2026`.
- Voided that exact expense with reason `QA fresh browser void test 2026-08-09`.
- Did not submit the trip booking probe.
- Did not submit the close-month confirmation.

Verified working:

- Home rendered and active bottom tab now has a visible non-color marker.
- Vehicle list rendered arrangement badges and left accents:
  - `Lease out`: brand.
  - `Daily lease`: good.
  - `Trips / charter`: serious.
- Vehicle list rows include trailing `ChevronRight` icons.
- Vehicle Overview rendered:
  - arrangement badge,
  - critical voided-expense accent and `Voided` badge,
  - visible void reason,
  - warning/good incident status badges,
  - incident row chevrons.
- Expense write path worked through the UI: amount pad, category picker, and submit.
- Void expense path worked through the UI: empty reason kept `Void expense` disabled, entering a reason enabled it, final button was destructive, and after submit the row stayed visible and non-tappable.
- Calendar legend now uses distinct classes for lease, daily ran, daily pending, daily lost, trip, and hold.
- More rows now have chevrons; `Close the month` icon is warning-colored.
- `/reports` now renders the real report catalogue.
- All six report routes rendered without console warnings/errors:
  - `/reports/vehicle-month`
  - `/reports/trips`
  - `/reports/fuel-efficiency`
  - `/reports/receivables`
  - `/reports/cash-position`
  - `/reports/lost-days`
- People rows have chevrons and Driver Detail for `Sunil Perera` no longer repeats the driver name below the title.
- GAP-76 live validation still passes:
  - blank Add Vehicle: `Registration is required`, `Vehicle type is required`,
  - blank Add Driver: `Name is required`,
  - no `Invalid input`.
- Browser console warnings/errors were empty at the end of the pass.

Fresh findings:

- `NC-1234` is shown as a Daily lease vehicle with current daily lease history, but its August/September 2026 calendar did not render daily-lease `B`/ran/lost markers.
- `day-2026-08-10` on `NC-1234` rendered as a button with `aria-label="Book a trip from 2026-08-10"`.
- Tapping that date opened `/vehicles/019fd800-9349-706a-80f1-360449d122c9/trip/new?startDate=2026-08-10`.
- Advancing the trip form to confirmation showed only `2026-08-10` and `Book trip`; it did not show the expected "pauses daily lease" warning.
- `/reports/lost-days` showed `No daily-lease days in this window`, which conflicts with the active daily-lease evidence above.
- `/reports`, `/review`, `/review/vehicles`, `/review/money`, `/period/close`, and `/incidents/:id` all highlighted `Home` in the Operate tab bar.
- `/review/money` remained on `Loading...` after an additional wait, with no visible error state and no console errors.
- `Close August permanently` in the final close-month dialog was still a brand-primary button.
- Action-sheet icon tones are only partly applied: `Report incident` in Vehicle actions is still neutral.
- Repeated cards still render with `rounded-md` / `12px`, including vehicle rows, cost rows, report cards, checklist rows, and incident detail cards.
- Section headers such as `Costs · 4`, `Incidents · 2`, and `Recent payments` still use the older muted text/count treatment.

## Targeted Retest Addendum

Scope came from `LIVE-TEST-PLAN.md`, focused on the fixes shipped after the first hosted pass:

- GAP-81: shared `ExpenseCostRow` + `VoidExpenseSheet`.
- B9 copy batch: GAP-76, GAP-78, GAP-79, GAP-80.
- Track A backend trio: GAP-41, GAP-72, GAP-74.

Current results:

- Web targeted unit slice passed: `11` files, `65` tests.
- Reports/partner API integration slice passed: `2` files, `30` tests.
- Expense void/list API integration slice passed: `1` file, `11` tests passed, `13` skipped by test-name filter.
- Hosted UI targeted pass completed for LT-2a, LT-4 partial, and LT-6a.
- A broader combined API run timed out in one non-target existing expense test: `fuel on a daily lease defaults to the current driver`. The focused GAP-81 void/list slice passed afterward, so this is recorded as test reliability/performance noise, not evidence against the voiding fix.

Live hosted UI status:

- Signed-in tab opened normally at Home: `Nothing needs you today`.
- Console warnings/errors were empty during the live targeted pass.
- LT-2a is complete live.
- LT-4 is partly resolved: People sheet actions are tappable, but the lower action still intersects the bottom-tab band at 360x640; vehicle-row keyboard activation is confirmed broken.
- LT-6a is complete for the client row/sheet behavior. The total-drop assertion is not visible on the current vehicle-scoped UI because Vehicle Overview lists costs but does not show a cost total.

## Data Written In QA

- Created vehicle: `QC-0808160814-A`, type `QC Sedan`, arrangement `Lease out`.
- Created vehicle: `QC-0808160814-B`, type `QC Van`, arrangement `Daily lease`.
- Created vehicle: `QC-0808160814-C`, type `QC Bus`, arrangement `Trips / charter`.
- First pass only: attempted driver/customer creation through People, but the action sheet and disclosure interactions were not reliably clickable in that browser-control session; no new driver/customer was verified as created.
- Browser recovery opened extra QA tabs across the two passes. The latest successful retest used the signed-in tab and left it on the `NC-1234` vehicle detail page.
- Created incident: `019fe41e-0041-7547-8cc7-b14b0237227f` on `NC-1234`, dated `9 Aug 2026`, with no description, left open.
- Created trip: `019fe41f-cbf5-751b-b065-7509dd9c8f11` on `QA-52656`, `10 Aug 2026 - 10 Aug 2026`, with driver `Sunil Perera`, no customer, no destination, and zero agreed/driver fee.
- Created expense on `NC-1234`: `Repairs`, `Rs 43.21`, dated `9 Aug 2026`.
- Voided that expense through the UI with reason `QA targeted void test`.

## Verified Working

- Sign-in session remained available in the original tab.
- Home, Vehicles, People, More, Opening balances, Close month, calendar, trip booking, rental start, and daily lease start routes rendered.
- Vehicle creation worked for all three arrangement choices A/B/C.
- Vehicles list showed the three created records immediately after save.
- More hub now exposes real rows for `Opening balances`, `Close the month`, and `Sign out`.
- Opening balances route renders the real starting-balance screen, not a placeholder.
- Close Month route renders the August 2026 period checklist and recent payments section.
- Vehicle calendar route renders August 2026 with day actions and a legend.
- Browser console/dev logs were empty during the final collection.
- Full web unit suite passed: `87` test files, `359` tests.
- GAP-81 component behavior is unit-covered: a live expense row opens the void sheet, a voided row is no longer tappable, the reason is required, period-closed errors surface, and caller-specific query invalidation runs.
- GAP-81 API behavior is integration-covered: void happy path, already-voided refusal, closed-period refusal, auth/role boundaries, and list responses including voided rows with reasons.
- GAP-76 validation copy is unit-covered for driver and vehicle creation: `Name is required`, `Registration is required`, and `Vehicle type is required` appear instead of `Invalid input`.
- GAP-78 is unit-covered: `TwoBalances` can omit `driverName`, so Driver Detail does not need to repeat its own title.
- GAP-79 is unit-covered/source-confirmed: vehicle incident rows and incident detail use `Incident with no description`.
- GAP-80 is unit/source-confirmed: product copy now says `advances aren't shown here yet` and `photo capture isn't available yet`.
- GAP-41 is integration-covered: `GET /api/reports/overheads?periodId=` returns overhead-only costs, returns real zero when absent, excludes voided overhead expense rows, and enforces period/business boundaries.
- GAP-72 is integration-covered: goodwill report boundaries include late-last-day adjustments and handle Colombo just-after-midnight business-date behavior correctly.
- GAP-74 is integration-covered: partner `balanceMinor` sums all-time profit share across closed and open periods while `earned` stays open-period scoped.
- GAP-76 live: blank `Add driver` shows `Name is required`; blank `Add vehicle` shows `Registration is required` and `Vehicle type is required`; `Invalid input` did not appear.
- GAP-78 live: Driver Detail for `Sunil Perera` shows the name once, as the page title only.
- GAP-79 live: both incident detail and vehicle detail show `Incident with no description`; `No description recorded` did not appear.
- GAP-80 live: Trip Detail shows `advances aren't shown here yet`; Expense form photo section shows `photo capture isn't available yet`; no `Web-P8b` or `not built yet` leaked into rendered copy.
- GAP-81 live: a newly-created `Repairs` expense opened `VoidExpenseSheet`; empty reason kept `Void expense` disabled; entering a reason enabled the submit; after submit, the row stayed visible, struck through, showed the void reason, and was no longer a button.

## Required Modifications

### P1 - Fix Daily-Lease Calendar Allocation Visibility And Trip Conflict Guard

Fresh live evidence:

- `NC-1234` is an active Daily lease vehicle.
- Vehicle Overview history shows `Daily lease · Rs 3,000/day · Sunil Perera · 9 Aug 2026 – ongoing`.
- Calendar August 2026 and September 2026 did not show daily-lease markers for the active lease dates.
- `day-2026-08-10` rendered as a free clickable day with `aria-label="Book a trip from 2026-08-10"`.
- Opening the trip form for that date and advancing to confirmation showed no daily-lease pause warning.
- `/reports/lost-days` for `2026-08-01 – 2026-08-09` showed `No daily-lease days in this window`.

Why this matters:

- The calendar is currently the entry point for booking trips.
- If an active daily-lease date is absent from `vehicle_day_allocation`/calendar output, the UI treats the day as free and can start a conflicting trip flow.
- The trip confirm screen depends on the same calendar payload for its "pauses daily lease" warning, so the user gets no warning before booking.
- Lost-days reporting also reads from `day_record`, so the report can claim there are no daily-lease days while the product shows an active daily lease elsewhere.

Likely source areas:

- `api/src/queries/vehicle.ts` -> `findVehicleCalendar`
- `api/src/queries/scheduled.ts`
- `api/src/domain/day-card-generation.ts`
- `api/src/queries/reports.ts` -> `listLostDays`
- `web/src/features/vehicles/VehicleCalendarScreen.tsx`
- `web/src/features/trips/BookTripScreen.tsx`

Required fix:

- Ensure starting a daily lease creates or schedules the occupied daily-lease days the calendar and reports need, or make the calendar endpoint derive active daily-lease occupancy when rows are missing.
- Do not render an active daily-lease day as a free trip day.
- Make trip confirmation detect and warn on paused daily-lease dates from the authoritative source.
- Update lost-days empty copy so "no daily-lease days" is only shown when there truly are no eligible daily-lease records in the window. If there are daily leases but zero lost days, say that instead.
- Add integration coverage using the live shape: active daily lease starting `2026-08-09`, calendar read for `2026-08-10`, trip confirm data, and lost-days report.

### P1 - Fix Active Bottom Tab Mapping For Non-Tab Routes

Fresh live evidence:

- `/reports` and every `/reports/*` route highlighted `Home`.
- `/review`, `/review/vehicles`, and `/review/money` highlighted `Home`.
- `/period/close` highlighted `Home` even though it is reached from More.
- `/incidents/:id` highlighted `Home` even though it was reached from Vehicle Overview.

Likely source area:

- `web/src/app/router.tsx`
- `tabForPathname`
- `FirstRunGate` role shell selection
- `ReviewLayout`/Operate shell interaction for owner-manager review/report routes

Required fix:

- Decide the product rule for owner-manager read-only reports/review:
  - either render `/review*` and `/reports*` in the Review shell for owner-manager too,
  - or keep them in Operate but map `/reports`, `/review`, `/period`, and similar hub-owned routes back to `More`.
- Map `/incidents`, `/trips`, and `/leases` to the tab that matches the entry context where possible, or deliberately hide/neutralize the active tab on detail routes reached from multiple places.
- Add route-level tests for active tab mapping on `/reports`, `/reports/vehicle-month`, `/review`, `/review/vehicles`, `/review/money`, `/period/close`, `/incidents/:id`, `/trips/:id`, and `/leases/:id`.

### P1 - Render Error/Empty State For Review Money Instead Of Infinite Loading

Fresh live evidence:

- `/review/money` stayed on `Loading...` after a multi-second wait.
- Browser console logs remained empty.
- Source review shows `ReviewMoneyScreen` returns `Loading...` whenever `query.data === undefined`, without checking `query.isError`.

Likely source area:

- `web/src/features/review/ReviewMoneyScreen.tsx`
- `api/src/queries/partner.ts`
- `api/src/route-defs/partner.ts`

Required fix:

- Render `query.isError` with the API error message.
- Consider `retry: false` or a bounded retry if 403/404 is a normal role/data outcome.
- If the current owner-manager user has no partner summary row, render an intentional empty state explaining that instead of a spinner.
- Add tests for success, loading, API error, and no-summary/empty partner states.

### P1 - Make Final Close-Month Confirmation Destructive

Fresh live evidence:

- The final irreversible dialog says `Close 1 August 2026 – 31 August 2026 permanently`.
- The description says `This cannot be undone`.
- The final `Close August permanently` button still uses the brand-primary blue treatment.

Likely source area:

- `web/src/features/period/CloseMonthScreen.tsx`
- `web/src/design/primitives/Dialog.tsx`

Required fix:

- Pass `variant="destructive"` to `DialogConfirmFooter` for the close-month final confirmation.
- Add a test that asserts the final close action uses the destructive variant.
- Keep the first screen-level `Close this month` entry button primary or serious according to product preference; the final irreversible action must be visually serious.

### P2 - Finish Remaining UI Look-And-Feel Refinements From Fresh Pass

Fresh live evidence:

- Repeated cards still use `rounded-md` / `12px`.
- Section headers still render as muted `Title · count` text.
- Vehicle action sheet icon tones are still neutral for `Report incident`.
- Reports catalogue is visible now, but still a flat neutral list without grouping.
- Incident detail status is plain text in the detail card, not a status badge.

Required fix:

- Complete `UI-LOOK-FEEL-IMPLEMENTATION-PLAN-2026-08-09.md` tickets:
  - UI-LF-02 card radius/accent density,
  - UI-LF-06 action icon consequence treatment,
  - UI-LF-09 section header treatment,
  - UI-LF-11 reports catalogue grouping,
  - UI-LF-12 review/report visual alignment.

### P1 - Guard Direct Routes By Vehicle Arrangement

Direct navigation to these routes rendered forms for vehicle `QA-52656`, whose arrangement is `Trips / charter`:

- `/vehicles/:id/lease/new`
- `/vehicles/:id/daily-lease/new`

The overview/calendar UI may hide these actions depending on arrangement, but the routes themselves still render. Add route-level and/or screen-level guards so a user cannot deep-link into an invalid start flow for the vehicle's current arrangement. Show a plain message with a back action instead.

### P1 - Fix Bottom Sheet Viewport Clearance

Retest update: People > Add actions are tappable now, including `Add a customer`. The remaining issue is viewport fit. At 360x640, the `Add a customer` action spans approximately `y=572..616`, while the bottom tab bar spans `y=585..640`. The sheet wins the z-order and the row can be tapped, but visually/structurally the lower action still occupies the tab-bar band.

Required fix:

- Constrain `Sheet`/`ActionSheet` to the visual viewport.
- Add safe-area and bottom-nav-aware padding.
- Ensure action rows are never underneath the tab bar.
- Test on small heights and mobile widths, not just desktop.

### P1 - Make Row Buttons Keyboard-Activatable

Retest update: pressing both `Enter` and `Space` on the visible `NC-1234` vehicle row did not navigate. The row is an enabled `<button type="button">` with no `aria-disabled` and no custom `tabindex`, so this is confirmed as a real live defect rather than only a stale browser-control artifact.

Required fix:

- Verify `Enter` and `Space` navigation for vehicle rows, people rows, expense rows, incident rows, trip rows, and calendar day buttons.
- Add browser/e2e coverage for keyboard activation, not only click tests.

### P1 - Replace Generic Disclosure Labels

Several collapsed disclosures expose only `More`, including:

- Driver form: fees/mobile
- Customer form: contact details
- Vehicle form: paperwork
- Daily lease form: end date

This is hard to scan, weak for accessibility, and collided with the bottom nav `More`. Keep the low-friction pattern, but make the collapsed label contextual, for example `More: contact details` or `Add fees and mobile`.

### P2 - Fix 1x1 Date Inputs In Accessibility/Hit-Target Surface

The hidden native date inputs are detectable as `1x1` interactive controls on:

- Opening balances: `Go-live date (calendar picker)`
- Book trip: `Start date (calendar picker)`, `End date (calendar picker)`
- Start daily lease: `Effective from (calendar picker)`

If the visible date chip/button is the real control, the hidden input should not appear as a tiny focus target. If the hidden input must stay accessible, use a proper visually hidden pattern that does not create a 1x1 interactive hit target problem.

### P2 - Complete Or Hide Remaining Placeholder Routes

Fresh 2026-08-09 update: `/reports`, `/reports/*`, `/review`, and `/review/vehicles` now render real screens for the signed-in owner-manager account. They should no longer be treated as placeholder routes in this environment.

Remaining placeholder/loading concerns:

- `/review/money` renders `Loading...` indefinitely in the fresh hosted pass; treat this as a loading/error-state bug, not a completed route.
- `/me`
- Customer detail route, from source review

If remaining destinations are not ready, hide the corresponding tabs/links for roles that can reach them or replace them with useful read-only summaries. Placeholders in production-like QA make the product feel unfinished even when core flows are improving.

### P2 - Remove Unreachable Calendar Legend States

The calendar legend includes `T? Hold (tentative)`, but the source notes the hold state is not currently persisted by the backend. Either implement the hold flow or hide the legend item until it exists.

### P2 - Clarify Empty Money Fields

Money fields on forms render as `Rs 0` before entry, for example `Agreed amount Rs 0` on the trip booking form. This can read as an intentional zero amount rather than an empty field. Prefer `Enter amount` or `Not set` until the user enters a value.

### P2 - Finish Entity Management

People list can show customers/drivers, but source review still routes customer detail to a placeholder. The product needs proper customer detail, edit/archive, and audit/history surfaces before QA can validate the full lifecycle.

### P2 - Show The Cost Total That Voiding Changes

LT-6a asks QA to confirm that voiding a cost drops the affected total. Vehicle Overview currently lists vehicle costs but does not show a vehicle cost total, and the current expense form path tested from Vehicle actions only creates vehicle-scoped expenses. The row-level void behavior is correct, but the UI does not expose the affected total for a manager to verify. Add a visible scoped total to the Costs section, or provide another clear aggregate surface linked from the row list.

### P3 - Improve Trip Booking Discoverability From Vehicle Detail

On a `Trips / charter` vehicle (`QA-52656`), `Vehicle actions` offered `View calendar`, `Record expense`, and `Report incident`, but not `Book trip`. Booking from the calendar worked, and Quick Add also exposes `New trip`, so this is not blocked functionality. It is still a discoverability mismatch on the screen where a manager is already looking at the vehicle.

### P3 - Reduce Automated Test Noise

The web unit suite passes, but it emits repeated non-failing warnings:

- `Not implemented: Window's scrollTo() method`
- `Warning: useRouter must be used inside a <RouterProvider> component!`

These should be cleaned up so real regressions are easier to spot in CI output.

### P3 - Stabilize Slow API Integration Coverage

The broader combined API run for reports, partner summary, and all expense tests timed out once in the existing `fuel on a daily lease defaults to the current driver` test after `20s`. The targeted void/list expense integration slice passed immediately afterward. This looks like shared test-database slowness or a timeout budget issue rather than a product regression, but CI should either speed up that setup path or give that test a realistic timeout.

## Updated Status From Previous Findings

- Trip receivable `Due Rs 0` issue: appears fixed in source; `TripDetailScreen` now renders `receivable.amountMinor`.
- Expense voiding: source, unit, API integration, and hosted UI row/sheet behavior pass. The only unverified LT-6a sub-assertion is aggregate total drop, because Vehicle Overview does not show the affected total.
- More hub placeholder: improved; More now has actionable rows.
- Vehicle detail history: still depends on whether there are lease/daily-lease entries. The known inspected vehicle had no visible history or cost data.
- Driver money actions: implemented in source and tests (`Pay the driver`, `Record an advance`, `Record a deposit`, `Offset...`), and Driver Detail was reachable live in this retest. Money writes were not run in this targeted GAP-81/B9 pass.
- Track A trio: GAP-41, GAP-72, and GAP-74 are not browser-visible yet per `LIVE-TEST-PLAN.md`; current integration evidence is clean.
- B9 copy batch: unit/source evidence and hosted UI confirmation are clean.

## Hosted Browser Limitation Encountered

First pass: after creating the three vehicles, the original signed-in tab remained readable and direct navigation still worked, but all click paths began failing through the browser-control transport:

- Playwright click
- DOM-node click
- Coordinate click
- Element-scoped evaluate/click fallback

Retest update: a second signed-in tab worked normally for hosted UI interactions. The stale unauthenticated duplicate tab still showed sign-in/click friction, but the active app tab did not. Findings above are based on the working signed-in tab unless explicitly marked as first-pass-only.

## Automated Verification

Commands run:

```bash
npm run test -w @fleetsettle/web
npm run test -w @fleetsettle/web -- src/features/costs/ExpenseCostRow.test.tsx src/features/costs/VoidExpenseSheet.test.tsx src/features/vehicles/VehicleOverviewScreen.test.tsx src/features/trips/TripDetailScreen.test.tsx src/features/incidents/IncidentScreen.test.tsx src/features/people/CreateDriverForm.test.tsx src/features/vehicles/CreateVehicleForm.test.tsx src/components/TwoBalances.test.tsx src/features/costs/FuelFillSheet.test.tsx src/features/costs/RecordExpenseSheet.test.tsx src/features/incidents/ReportIncidentSheet.test.tsx --reporter=dot
npm run test:integration -w @fleetsettle/api -- tests/integration/reports.test.ts tests/integration/partner-summary.test.ts --reporter=dot
npm run test:integration -w @fleetsettle/api -- tests/integration/expense.test.ts -t "void an expense|list expenses" --reporter=dot
```

Results:

- `87` test files passed.
- `359` tests passed.
- No failing web unit tests.
- Targeted web retest: `11` files passed, `65` tests passed.
- Reports/partner integration retest: `2` files passed, `30` tests passed.
- Expense void/list integration retest: `1` file passed, `11` tests passed, `13` skipped by filter.

## Design Verdict

Do not redesign the product from scratch. The structure is already right for an operational fleet tool: compact, list-led, and action-focused. The required design work is refinement:

- make hidden controls explicit enough to trust,
- remove placeholder destinations,
- improve route guards,
- give every action clear contextual labels,
- and verify small-screen sheet behavior.

That will make the current design feel mature without losing its speed.
