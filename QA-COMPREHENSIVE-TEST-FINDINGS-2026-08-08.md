# FleetSettle QA Comprehensive Browser/UI-UX Findings

Date: 2026-08-08  
Environment: https://qa.fleetsettle.com  
Run labels: `QC-0808160814`, `TARGET-08081547`, `LIVE-0809-GAP81-B9`  
Session: original hosted pass was signed in; targeted pass resumed after user sign-in

## Executive Summary

The current design direction is good and should be refined, not redesigned. The app has a clear mobile-first operational feel, restrained styling, strong card/list hierarchy, and predictable bottom navigation. The biggest gaps are not visual taste problems; they are completion, affordance, and trust issues around hidden controls, placeholder routes, direct-route guards, and some action-sheet/date-field accessibility.

I was able to create vehicles through the hosted UI and inspect the main routed screens. In the first pass, the in-app browser control layer stopped accepting click commands for the signed-in tab, so I supplemented the hosted pass with source review and the full web unit suite.

Latest targeted update: after sign-in, a second hosted QA tab was usable and the browser-control issue did not reproduce there. I completed the live UI spot-checks for GAP-81 and the B9 copy batch, then updated the backend-only Track A evidence from integration tests. GAP-81 and GAP-76/78/79/80 now have live hosted confirmation. GAP-41/72/74 remain backend-only until B4 renders them.

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

### P2 - Complete Or Hide Placeholder Routes

These routes still render `Not built yet`:

- `/review`
- `/review/vehicles`
- `/review/money`
- `/reports`
- `/me`
- Customer detail route, from source review

If these are not ready, hide the corresponding tabs/links for roles that can reach them or replace them with useful read-only summaries. Placeholders in production-like QA make the product feel unfinished even when core flows are improving.

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
