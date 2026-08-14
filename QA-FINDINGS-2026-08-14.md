# QA findings — 14 August 2026

Fresh browser QA against `https://qa.fleetsettle.com` on 14 August 2026.
Default mobile viewport for the confirmed flow check was 390 x 844 with touch/coarse-pointer emulation.

## Scope

Covered:

- Login and Home visual audit that fed UI M-31 / GAP-124.
- Mobile Quick Add handoff: `Add → New trip → choose a vehicle`.
- Source cross-check for the same handoff in `QuickAddSheet`, `ActionSheet`, `ReasonPicker`, and `Sheet`.

No QA data mutations were made. The trip flow stopped before any booking/write.

## Passes

- QA sign-in succeeded and landed on Home.
- In a slower mobile/touch run, `Add → New trip` did load the vehicle picker: `/api/vehicle` returned 200, no console/page errors were emitted, and vehicles were present in the picker.
- The Home screen remained usable at 390 x 844.

## Findings

### QA-2026-08-14-01 — Quick Add → New trip can stack two sheets and hide the vehicle picker on mobile

Severity: high for mobile.

Reproduction:

1. Sign in to QA at 390 x 844 with touch/coarse-pointer emulation.
2. Open `Add`.
3. Tap `New trip` immediately from the Add sheet.

Observed result:

- Two visible dialogs existed at the same time.
- Dialog 1 was still `Add`, with the original actions: Fuel, Expense, Payment received, Payment made, New trip.
- Dialog 2 was `New trip — choose a vehicle`, but it was positioned almost entirely below the viewport.
- The vehicle picker dialog had no visible vehicle buttons in the failing state.
- Tapping could not proceed to `/vehicles/:id/trip/new`; the route stayed on `/`.
- `/api/vehicle` returned 200 in the same flow family, so this is not simply missing vehicle data.
- No console errors or page errors were captured.

Geometry captured from the failing run:

- `Add` dialog: `x=0`, `y=525.10`, `width=390`, `height=341`.
- `New trip — choose a vehicle` dialog: `x=0`, `y=837.19`, `width=390`, `height=105`.

Source cross-check:

- `ActionSheet` closes itself and opens the selected target in one click handler: `onOpenChange(false); onSelect();`.
- `QuickAddSheet` renders the `Add` action sheet and the `New trip — choose a vehicle` `ReasonPicker` as sibling sheets.
- `ReasonPicker` has a proper read-error branch, but a sheet-handoff race can make the picker unreachable even when the vehicle read is fine.

Likely class: regression or uncovered edge of GAP-104's mobile sheet handoff fix. GAP-104 was verified under Chromium touch emulation for the original cases, but its own real-device acceptance item remains LT-10. This exact immediate `ActionSheet → ReasonPicker` path now needs its own failing Playwright/mobile regression.

## Test Data Changes

None.

## Test Limitations

- This was verified in Chromium touch/coarse-pointer emulation, not yet on physical iOS Safari or Android Chrome.
- The broader phase-1 mobile interaction sweep remains open as LT-13.
