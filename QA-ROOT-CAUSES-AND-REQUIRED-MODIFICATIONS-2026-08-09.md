# FleetSettle QA Root Causes And Required Modifications

Date: 2026-08-09

Environment tested: `https://qa.fleetsettle.com`

Companion findings document: `QA-COMPREHENSIVE-TEST-FINDINGS-2026-08-08.md`

Backend/API companion document: `BACKEND-API-QUERY-EVALUATION-2026-08-09.md`

Scope: fresh hosted UI pass after the latest deployment, followed by source review of the matching application areas. This document focuses on exact root causes and required modifications, not implementation details already completed.

## Priority Summary

| ID | Priority | Area | Current status |
| --- | --- | --- | --- |
| RC-01 | P1 | Daily-lease calendar, trip conflict warning, lost-days report | Current hosted defect |
| RC-02 | P1 | Active bottom tab for non-tab routes | Current hosted defect |
| RC-03 | P1 | Review money loading forever on error | Current hosted defect |
| RC-04 | P1 | Close-month final confirmation tone | Current hosted defect |
| RC-05 | P2 | UI look and feel refinements | Partially fixed, still open |
| RC-06 | P2 | Error, empty, and unavailable states | Current quality gap |
| RC-07 | P3 | Older direct route arrangement guards | Source appears fixed, needs hosted retest |

## RC-01 - Daily-Lease Days Are Not Authoritative Immediately After Setup

Priority: P1

User impact: a vehicle can appear as actively assigned to a daily lease while the calendar, trip flow, and lost-days report behave as if no daily lease exists. This can let a manager book over a daily-lease day without seeing the expected "pauses daily lease" warning, and it makes the lost-days report show a false empty state.

Hosted evidence:

- Vehicle `NC-1234` shows an active daily lease in history: `Daily lease`, `Rs 3,000/day`, `Sunil Perera`, `9 Aug 2026 - ongoing`.
- The same vehicle calendar for August and September 2026 does not show daily-lease `B`, ran, or lost markers.
- `day-2026-08-10` is rendered as a free trip button with label `Book a trip from 2026-08-10`.
- Booking flow for `2026-08-10` reaches confirmation without the daily-lease pause warning.
- `/reports/lost-days` shows `No daily-lease days in this window.`

Exact root cause:

- `api/src/domain/dailyLease.ts` starts a daily lease by writing only `daily_lease` and `daily_lease_rate`.
- `api/src/route-defs/dailyLease.ts` documents the same behavior: calendar/day-record generation is delegated to the `generate-day-cards` rolling-horizon cron job.
- `api/src/domain/day-card-generation.ts` is the only service that materializes arrangement `B` rows into `vehicle_day_allocation` and current-period rows into `day_record`.
- `api/src/queries/vehicle.ts` builds the vehicle calendar only from `vehicle_day_allocation`, with a left join to `day_record`. It does not derive active daily-lease occupancy from `daily_lease` if allocation rows are missing.
- `web/src/features/vehicles/VehicleCalendarScreen.tsx` treats an absent calendar row as a free day.
- `web/src/features/trips/BookTripScreen.tsx` computes `pausedDaysCount` only from the calendar endpoint. If the calendar endpoint has no arrangement `B` rows, the warning is suppressed.
- `api/src/queries/reports.ts` implements `listLostDays` from `day_record` only. If `day_record` has not been generated yet, the report cannot distinguish "no daily leases" from "daily leases exist but day cards have not been generated."

Required modifications:

1. Introduce a reusable calendar materialization path for daily leases, shared by daily-lease start/update flows and the existing cron. Do not duplicate the day-card generation rules in a second place.
2. On successful daily-lease start, synchronously materialize arrangement `B` `vehicle_day_allocation` rows for at least the open period plus the existing rolling horizon.
3. For dates inside the current open period, synchronously create the corresponding `day_record` rows when a rate exists.
4. Keep the generation idempotent so repeated cron runs and start-flow generation cannot create duplicates.
5. Add server-side trip booking validation against the authoritative allocation or active daily-lease source, so a stale client calendar cannot silently book a conflicting trip.
6. Update the trip confirmation warning to read an authoritative occupancy source, or ensure the calendar endpoint itself is authoritative immediately after setup.
7. Update lost-days reporting or its empty-state metadata so the UI can distinguish:
   - no daily leases in the selected range
   - active daily leases exist, but no lost days
   - active daily leases exist, but day records are missing and need generation

Required test coverage:

- API integration: start a daily lease on `2026-08-09`, then immediately call vehicle calendar for `2026-08-10`; response includes an arrangement `B` row.
- API integration: start a daily lease, then call lost-days report for the same period; eligible days are present or the response exposes a clear generation state.
- API integration: attempt to book a trip over an active daily-lease day; server returns either a warning-capable response or a guarded conflict according to the product rule.
- UI regression: a daily-lease day is rendered with the warning `B` calendar marker and cannot appear as an ordinary free day.
- UI regression: trip confirmation shows the daily-lease pause warning before submit.

## RC-02 - Operate Shell Active Tab Falls Back To Home For Many Real Routes

Priority: P1

User impact: users land on real, working screens such as Reports, Review, Close month, or incident details, but the bottom navigation highlights Home. This creates weak orientation and makes the app feel less trustworthy after navigation from More or Review-like routes.

Hosted evidence:

- `/reports` and all six report detail routes highlight Home in the Operate tab bar.
- `/review`, `/review/vehicles`, and `/review/money` highlight Home for the tested owner-manager session.
- `/period/close` highlights Home even though it is launched from More.
- `/incidents/:id` highlights Home even when reached from a vehicle detail flow.

Exact root cause:

- `web/src/app/router.tsx` defines `tabForPathname(pathname)` for the Operate shell with only these mappings:
  - `/vehicles` -> `vehicles`
  - `/people` -> `people`
  - `/more` -> `more`
  - everything else -> `home`
- The same route tree contains real routes for `/reports`, `/review`, `/period/close`, `/opening-balances`, `/incidents/:id`, `/trips/:id`, and `/leases/:id`.
- For the tested role, `FirstRunGate` renders the Operate shell, not the Review shell, so `/review*` and `/reports*` are visible inside Operate and fall through to Home unless explicitly mapped.
- Detail routes such as `/incidents/:id`, `/trips/:id`, and `/leases/:id` do not preserve their originating tab, so the router cannot infer whether the user arrived from Home, Vehicles, Review, or More.

Required modifications:

1. Decide the product rule for owner-manager review/report routes:
   - Option A: render `/review*` and `/reports*` inside the Review shell for roles allowed to review.
   - Option B: keep them inside Operate, but map them to a stable parent tab such as More.
2. Expand `tabForPathname` for known More-owned routes:
   - `/more`
   - `/period`
   - `/opening-balances`
   - `/reports`
   - possibly `/review` if Option B is selected
3. Define a policy for entity detail routes:
   - use the domain parent (`/vehicles/:id` -> Vehicles)
   - preserve origin with search/router state
   - or intentionally show no active tab for cross-entry detail routes
4. Add routing tests that render each major path and assert the selected bottom tab.

Required test coverage:

- `/reports`, `/reports/vehicle-month`, `/reports/trips`, `/reports/fuel-efficiency`, `/reports/receivables`, `/reports/cash-position`, `/reports/lost-days`.
- `/review`, `/review/vehicles`, `/review/vehicles/:vehicleId`, `/review/money`.
- `/period/close`, `/opening-balances`.
- `/incidents/:incidentId`, `/trips/:tripId`, `/leases/:leaseId`.

## RC-03 - Review Money Masks Errors As Infinite Loading

Priority: P1

User impact: the user sees `Loading...` indefinitely on `/review/money`. With no error message, retry affordance, or empty state, it is impossible to tell whether the issue is permissions, missing period data, backend failure, or network failure.

Hosted evidence:

- `/review/money` stayed on the loading state after several seconds.
- The browser console remained clean, so the user-facing defect is the UI state handling even if the underlying response is a 403, 404, or 500.

Exact root cause:

- `web/src/features/review/ReviewMoneyScreen.tsx` checks only `query.data === undefined` and renders `Loading...`.
- The component does not branch on `query.isError`, so React Query errors are indistinguishable from an in-flight request.
- The component calls `/api/partner/${me.userId}`.
- `api/src/route-defs/partner.ts` documents valid non-200 responses for this endpoint, including 403 and 404.
- `api/src/handlers/partner.ts` requires `managePartnerCapital` and verifies business membership before returning a summary.
- `api/src/domain/partner.ts` calculates `holdingMinor` with a non-null assertion: `cashPositions.find((p) => p.userId === userId)!.heldMinor`. If the active member has no cash-position row, the API can throw and the UI still presents it as loading.

Required modifications:

1. Add explicit `query.isError` rendering in `ReviewMoneyScreen`.
2. Show the API error message where available, with a concise fallback such as `Could not load your money summary.`
3. Add a retry action or rely on a visible reload button consistent with other app screens.
4. Consider `retry: false` for known authorization and not-found states so the UI does not sit in retry/backoff before showing feedback.
5. Replace the backend non-null assertion in `getPartnerSummary` with an explicit domain rule:
   - return `0` if an active member with no movements should have a zero cash position
   - or return a controlled domain error if missing cash-position data means corrupted/missing setup
6. If `owner_manager` should read their own money page, either loosen the endpoint capability for self-summary or route the UI away from `/review/money` for roles that cannot call it.

Required test coverage:

- UI: loading state renders while pending.
- UI: 403/404/500 responses render an error state, not `Loading...`.
- UI: successful response renders `balanceMinor`, all-time put-in/taken-out, period earned, and holding.
- API: active member with no cash-position row returns the selected controlled behavior.
- API: member without permission receives a stable 403 response.

## RC-04 - Final Close-Month Confirmation Uses Primary Tone Instead Of Destructive Tone

Priority: P1

User impact: the final irreversible action `Close August permanently` is styled as the normal brand primary action. That weakens the risk signal for a permanent accounting operation.

Hosted evidence:

- The final confirmation dialog copy says the close cannot be undone.
- The confirm button uses the blue primary styling instead of a critical/destructive style.

Exact root cause:

- `web/src/features/period/CloseMonthScreen.tsx` renders `<DialogConfirmFooter ... />` for the final close confirmation without passing a `variant`.
- `web/src/design/primitives/Dialog.tsx` defaults `DialogConfirmFooter` to `variant = "primary"`.
- The shared `Button` primitive already supports `variant="destructive"` in `web/src/design/primitives/Button.tsx`, so the missing behavior is at the call site, not the design system foundation.

Required modifications:

1. Pass `variant="destructive"` to `DialogConfirmFooter` in `CloseMonthScreen`.
2. Keep the first `Close this month` call-to-action primary if desired; the final irreversible confirmation is the critical point.
3. Add a regression test that opens the close-month confirmation and verifies the final confirm action uses the destructive variant.

Required test coverage:

- UI: final close-month dialog has the permanent copy and destructive confirm button.
- UI: cancel remains a ghost/plain button and remains below the destructive action.

## RC-05 - Remaining UI Look And Feel Gaps Are Mostly Primitive-Level

Priority: P2

User impact: the app is now more usable than the earlier pass, but some surfaces still feel flatter and less scannable than the operational domain deserves. The remaining work is best done in primitives and shared row patterns so it improves many screens consistently.

Already improved in the latest hosted build:

- Active tab indicator exists and animates.
- Vehicle arrangement badges and row accents are visible.
- Vehicle list rows have chevrons.
- Calendar legend uses distinct semantic colors and glyphs.
- Expense voiding shows critical tone, strikethrough, and reason.
- Incident rows in vehicle history now show status badges and accents.
- More rows have chevrons.
- Close month entry in More uses a warning icon.

Remaining exact root causes and modifications:

### Card radius remains too rounded for dense operational rows

Root cause:

- `web/src/design/primitives/Card.tsx` uses `rounded-md`.
- The token system maps medium radius to the app's broader rounded card look.
- The Card primitive is used for many repeated list rows, so this single default makes the whole app feel softer than necessary.

Required modifications:

- Introduce a row-focused card shape, or add a `density`/`shape` prop to `Card`.
- Use `rounded-sm` for repeated list rows, report rows, checklist rows, and compact operational cards.
- Reserve `rounded-md` or larger shapes for sheets, dialogs, and genuinely elevated panels.

### Section headings are still low-signal muted text

Root cause:

- `web/src/design/primitives/Section.tsx` renders `{title} - {count}` as one muted text heading.
- There is no badge, icon, or tone prop for section count/status.

Required modifications:

- Split title and count into separate elements.
- Render the count as a compact badge or counter pill.
- Add optional section tone/icon support for categories like due, warning, money, trip, incident.
- Preserve collapse behavior and validation-driven expansion.

### Action sheet icons cannot carry semantic tone

Root cause:

- `web/src/design/primitives/ActionSheet.tsx` defines action rows with `key`, `label`, `icon`, and `onSelect` only.
- The icon class is hardcoded to `text-ink-secondary`.
- Call sites cannot mark actions like `Report incident` as warning/critical without bypassing the primitive.

Required modifications:

- Add a `tone` property to `ActionSheetAction`, for example `neutral`, `brand`, `warning`, `critical`.
- Map tones to existing color tokens in the primitive.
- Update vehicle actions, incident actions, and quick-add actions where semantic color helps scanning.

### Reports catalogue is functional but not yet scannable

Root cause:

- `web/src/features/reports/ReportsCatalogueScreen.tsx` uses a flat `CARDS` array with only `key` and `label`.
- Report rows do not expose grouping, intent, icon, or expected audience.

Required modifications:

- Add report metadata: group, icon, tone, and one short supporting label where useful.
- Group reports by purpose, for example performance, money owed, cash held, and operations.
- Keep the catalogue compact; this should feel like a tool menu, not a landing page.

### Incident detail still has muted status treatment

Root cause:

- `web/src/features/incidents/IncidentScreen.tsx` still renders some incident and insurance claim statuses as muted text.
- The shared Badge/status mappings exist elsewhere, but the detail card does not fully reuse them.

Required modifications:

- Render incident status and insurance claim status with Badge.
- Add left accent or small status marker on the primary incident card.
- Keep description, date, cost, and claim amounts in plain readable rows.

Required test coverage:

- Visual or component tests for Card row shape.
- Component tests for `Section` title/count rendering.
- Component tests for `ActionSheetAction` tone mapping.
- Screenshot/manual regression of Home, Vehicles, Vehicle detail, Incident detail, Reports catalogue, Review, Close month.

## RC-06 - Error And Empty States Need A Shared Product Pattern

Priority: P2

User impact: several screens can still show generic loading, generic empty copy, or placeholder-like copy even when the system has enough context to explain what happened.

Exact root cause:

- Error handling is implemented per screen instead of through a small shared query-state pattern.
- Empty states often infer meaning from an empty array without backend metadata. The lost-days report is the clearest example: empty rows are interpreted as `No daily-lease days`, even when the real issue may be missing materialized day records.
- Some form components deliberately use generic labels such as `More` before opening, which is consistent with the original component comment but can reduce clarity in longer forms.

Required modifications:

1. Add shared `QueryState` or screen-level helpers for loading, error, retry, and empty states.
2. Make report endpoints return enough metadata to support accurate empty states where an empty list is ambiguous.
3. Replace generic empty copy with cause-aware copy where the domain can identify the cause.
4. Audit forms using `Disclosure` to decide where `More` should stay generic and where the collapsed label should name the hidden section from the start.

Required test coverage:

- Every route with a query has pending, error, empty, and success tests.
- Report screens include at least one explicit empty-state test per endpoint.
- Form disclosure tests cover hidden validation errors and collapsed labels.

## RC-07 - Older Direct Route Arrangement Guards Appear Fixed In Source

Priority: P3

Current status: source appears fixed; do not keep this as a current defect unless hosted retesting reproduces it.

Earlier issue:

- Deep-linking directly to a monthly rental or daily-lease setup route could show the wrong form for a vehicle arrangement.

Current source evidence:

- `web/src/features/vehicles/StartLeaseScreen.tsx` blocks the monthly rental form when the vehicle arrangement is not `A`.
- `web/src/features/vehicles/StartDailyLeaseScreen.tsx` blocks the daily-lease form when the vehicle arrangement is neither `B` nor unset.
- Route comments indicate the backend independently refuses invalid arrangements on submit.

Required modifications:

- Keep the source behavior.
- Add or keep hosted regression tests for direct route access:
  - arrangement `B` vehicle -> `/lease/new` shows an unavailable message, not the rental form
  - arrangement `A` vehicle -> `/daily-lease/new` shows an unavailable message, not the daily-lease form
  - unset arrangement -> daily-lease setup is allowed only if that is still the intended product rule

## Suggested Implementation Order

1. Fix RC-01 first because it can produce incorrect operational actions and false reports.
2. Fix RC-03 next because it hides backend failures from the user.
3. Fix RC-04 because it is small, high-signal, and protects an irreversible action.
4. Fix RC-02 routing/tab mapping before more screens are added.
5. Apply RC-05 primitive-level UI refinements in one design-system pass.
6. Apply RC-06 shared query and empty-state pattern as screens are touched.
7. Retest RC-07 on hosted and remove it from active QA tracking if confirmed fixed.

## Definition Of Done For The Next QA Pass

- Starting a daily lease immediately changes the calendar and lost-days data without waiting for cron.
- Booking a trip over a daily-lease day cannot happen silently; warning or guard appears from authoritative data.
- `/review/money` never stays on loading after a failed response.
- Close-month final confirmation uses destructive styling.
- Bottom tab state is correct or intentionally absent on every real route.
- Reports catalogue, sections, cards, and action sheets use consistent visual hierarchy and semantic color.
- Fresh hosted browser test updates the companion QA findings document with pass/fail status for each RC item.
