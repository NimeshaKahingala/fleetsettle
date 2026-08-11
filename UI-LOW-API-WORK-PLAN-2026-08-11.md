# UI low-API work plan - 11 Aug 2026

This document is a handoff plan for a fresh Codex chat. It focuses on UI work
that can move with little or no new API dependency. Report work and offline/PWA
support are deliberately delayed.

## Implementation status

Implemented on branch `codex/ui-low-api-work-2026-08-11`:

- UI-1 DateField global simplification.
- UI-2 landscape compact chrome.
- UI-3 Quick Add payments.
- UI-4 Customer detail, except the statement view.
- UI-5 vehicle paperwork metadata write.
- UI-6 Driver Mine screen, except the A14-backed statement link.
- UI-7 staff driver history.
- UI-8 in-app member invite/manage UI and driver access links.
- UI-9 safe callers: Cash screen, Partner detail, capital contribution,
  banking event, partner payout/settlement, mileage-package create/archive,
  `BorneByPaidBy` paid-by member selection, initial ownership-share setup,
  and management-agreement create/revoke under Vehicle sharing.
- UI-10 Toast primitive and host.
- UI-11 GAP-100 client callers: trip-scoped advance issue from Trip detail and
  advance settlement from staff Driver detail. Mine remains read-only.

Still pending after this branch:

- GAP-1 per-vehicle capability scoping and any UI that would imply it.
- A14 signed printed-slip/share-link backend and the statement links that
  depend on it.
- GAP-44 structured double-booking dialog, because its chosen fix requires a
  backend error payload first.
- A8 odometer wiring and borne-by preview.
- A9b broader soft-delete/backfill work.
- Ownership-share replacement for a vehicle that already has a current split;
  the current UI intentionally supports initial setup only because the backend
  has no close-and-replace share operation yet.
- Richer advance settlement context: driver-history advance rows do not yet
  expose `settledMinor` or `tripId`, so the settlement sheet cannot show the
  remaining amount or trip context. The backend still enforces over-settlement.
- Management-agreement API hardening: the UI only offers `manager` members, but
  the handler currently validates membership rather than role.

This is not the product spec. If this plan disagrees with `docs/`,
`TRACKER.md`, or `Plan.md`, use this order of truth:

1. `docs/`
2. `TRACKER.md`
3. `Plan.md`
4. this handoff plan
5. source code

## Read first

Before changing code, read:

1. `AGENTS.md`
2. `CLAUDE.md`
3. `web/AGENTS.md`
4. `web/CLAUDE.md`
5. `docs/README.md`
6. `docs/design/ui-ux-guidelines.md`
7. `docs/product/user-flows.md`
8. `TRACKER.md`
9. `Plan.md`

Then read the source and tests for the item being implemented.

## Scope

In scope:

- UI primitives and screens that can use existing endpoints.
- UX fixes for mobile, date fields, navigation, forms, and role screens.
- Documentation and tracker updates required by each UI behavior change.
- Focused component tests, screen tests, and browser/mobile checks.

Out of scope for this batch:

- New report functionality or report polish beyond fixing active UI defects.
- Offline/PWA support.
- New report API/query work.
- Phase-2 write-off/post-closure flows.
- Full attachment expansion beyond the already-merged expense receipt scope.
- Manager per-vehicle scoping unless the dedicated GAP-1 backend/policy work is
  explicitly scheduled.

## Current state

- `Plan.md` now puts the remaining work behind the low-API UI branch: GAP-44
  when its wire payload is scheduled, GAP-1 policy scoping, then A14/A8/A9b/B7
  unless the user reprioritizes.
- F3 and F4 are recorded closed in `Plan.md` and `TRACKER.md`.
- B9 closed GAP-83 and GAP-105 by rebuilding `DateField` around one real
  native date input.
- GAP-108 then removed the temporary `showShortcuts` branch and removed
  Today/Yesterday shortcut buttons from normal single-date fields too. A future
  product/design decision would need to reintroduce them deliberately.

## Implementation order

### UI-0 - Sync docs and tracker

Do this before or alongside the first code change.

Required updates:

- Update `docs/design/ui-ux-guidelines.md` section M-17 so the standard
  `DateField` is a single native date picker control with weekday display, not
  a date field plus Today/Yesterday shortcut chips.
- Record the product decision in `TRACKER.md`. Either add a new gap or update
  the existing B9/DateField note so "global shortcut removal" is explicit and
  not confused with the already-closed GAP-83/GAP-105 accessibility fallback.
- Keep `Plan.md` consistent if the sequencing or B9 remaining work changes.

Acceptance:

- The docs explain why the shortcut chips are removed: they create duplicate
  date-setting affordances and confusion, especially when several date fields
  are present.
- The tracker distinguishes this design cleanup from the already-closed native
  date-input bug.

### UI-1 - DateField global simplification

Goal:

Remove Today/Yesterday shortcut buttons everywhere and leave one clear native
date-picker control.

Primary files:

- `web/src/components/DateField.tsx`
- `web/src/components/DateField.test.tsx`
- `web/src/features/reports/FuelEfficiencyReportScreen.tsx`
- `web/src/features/reports/LostDaysReportScreen.tsx`

Implementation notes:

- Remove the `showShortcuts` prop if it only exists to keep shortcut chips.
- Remove chip rendering from the component.
- Keep the native `<input type="date">` as the single click, tap, and Tab
  target.
- Keep the decorative weekday display and visible focus ring.
- Remove report-screen opt-outs once the default no longer renders shortcuts.

Acceptance:

- No visible Today/Yesterday buttons render for any `DateField`.
- The field has exactly one focusable control.
- Direct input editing still works when `showPicker()` is unavailable.
- Component tests cover normal and from/to usage.
- Browser check includes mobile width at 360 x 640 and a narrow 320px check.

Suggested command:

```sh
npm test -w @fleetsettle/web -- DateField.test.tsx FuelEfficiencyReportScreen.test.tsx LostDaysReportScreen.test.tsx
```

### UI-2 - Landscape compact chrome

Goal:

Make the shell usable in landscape mobile, especially 640 x 360.

Primary files:

- `web/src/design/primitives/AppShell.tsx`
- `web/src/design/primitives/Screen.tsx`
- related shell tests

Implementation notes:

- Add below-md landscape styles for compact vertical chrome.
- App bar should be closer to 44px high in landscape mobile.
- Bottom tab bar should be closer to 44px high in landscape mobile and can use
  icon-only labels if space requires it.
- Sticky primary actions must remain visible and not hide focused inputs.
- Continue using `100svh`.

Acceptance:

- Home, Quick Add, and at least one long form work at 640 x 360.
- 360 x 640 and 320px portrait remain clean.
- There is no horizontal scroll.
- Tap targets stay at least 44 x 44 CSS px.

### UI-3 - Quick Add payments

Goal:

Add Quick Add entries for payment received and payment made using existing
payment APIs and shared schemas.

Existing contracts to inspect:

- `packages/shared/src/schemas/lease-billing.ts`
- `api/src/domain/payment.ts`
- `POST /api/payment`
- list endpoints for customer, driver, and business member selection

Implementation notes:

- `recordPaymentRequestSchema` already supports `direction` and
  `partyType: customer | driver | partner`.
- Build a party picker before the payment sheet.
- Reuse existing payment sheet logic where possible instead of duplicating
  money/date/reason form code.
- Product copy should be plain: "Payment received" and "Payment made".
- Confirm allowed party types from docs and schema before enabling each option.

Acceptance:

- User can record a received payment from Quick Add.
- User can record a made payment from Quick Add.
- Party selection handles loading, empty, and error states.
- Money stays string on the wire and bigint in logic.
- Successful writes invalidate the relevant balances and lists.

### UI-4 - Customer detail screen

Goal:

Replace the customer detail placeholder with a real read screen.

Primary files:

- `web/src/app/router.tsx`
- customer/person feature files under `web/src/features/`

Existing APIs:

- `GET /api/customer/{id}/obligation`
- `GET /api/customer/{id}/payment`
- existing customer list/detail read, if present

Implementation notes:

- Follow the shape of existing Lease and Driver detail screens.
- Show obligations and payments with clear empty/error/loading states.
- Add collect-payment action only where existing payment flow supports it.
- Use `QueryState`; do not hide failures behind empty arrays or zeroes.

Acceptance:

- `/people/customers/:customerId` is no longer a placeholder.
- Customer balances and history distinguish unknown from zero.
- Screen works at 360 x 640.
- Tests cover loading, error, empty, and populated states.

### UI-5 - Vehicle paperwork write UI

Goal:

Let users add and update vehicle document metadata from the vehicle screen.

Primary files:

- `web/src/features/vehicles/VehicleOverviewScreen.tsx`
- related vehicle document hooks/tests

Existing APIs:

- `GET /api/vehicle/{id}/document`
- `PUT /api/vehicle/{id}/document`

Implementation notes:

- This is metadata only, not file upload.
- Fields should include document type, expiry date, and reference/details if
  supported by the schema.
- Use a sheet from the paperwork section.
- Invalidate vehicle document reads and home paperwork warning reads after
  success.

Acceptance:

- User can create/update paperwork metadata.
- Expiry warnings refresh without a full reload.
- Date picker follows UI-1 behavior with no shortcut chips.
- Tests cover save success, validation, and read-error behavior.

### UI-6 - Driver Mine screen

Goal:

Build the driver role's own `/me` content using the existing driver-view API.

Primary files:

- `/me` route and Mine shell files under `web/src/`

Existing API:

- `GET /api/driver-view`

Implementation notes:

- The Mine shell already exists and should not show the manager tab bar.
- Show the two driver balances separately; never collapse them into only a net.
- Include recent days, trips, advances, offsets, and deposits if present in the
  response.
- Respect driver-only access and copy from the docs.

Acceptance:

- Linked driver no longer lands on a placeholder.
- Driver can understand "I owe the business" and "business owes me" separately.
- Loading, empty, and error states are visible.
- 360 x 640 layout is clean and one-thumb friendly.

### UI-7 - Staff driver history

Goal:

Expose the existing staff-side driver history endpoint inside Driver Detail.

Primary files:

- `web/src/features/drivers/DriverDetailScreen.tsx`
- shared driver history components, if created

Existing API:

- `GET /api/driver/{id}/view`

Implementation notes:

- Reuse Mine rendering components where the data shape matches.
- Keep the driver detail title from repeating inside the first balance section.
- Preserve separate balances.

Acceptance:

- Staff can view a driver's recent days, trips, advances, offsets, and deposits.
- Read failures show real error UI.
- Tests cover a populated history and an empty history.

### UI-8 - In-app member invite and manage UI

Goal:

Add an owner-facing way to invite/manage members and link driver accounts.

Existing APIs to inspect:

- `POST /api/business-member/invite`
- revoke/change-role endpoints
- driver link invite/unlink endpoints

Implementation notes:

- Place under More or People, depending on current navigation patterns.
- Gate owner-only actions by capability.
- Do not invite real `manager` users to a production business until GAP-1
  scoping is built or the product explicitly accepts business-wide report
  access.
- Make role copy match the docs exactly.

Acceptance:

- Owner/owner-manager can invite a member.
- Existing members are visible with role and status.
- Revoke and role-change actions have clear confirm states.
- Driver linking flow is discoverable.

### UI-9 - Partner, banking, and cash screens

Goal:

Build the remaining B2 UI surfaces against existing A2 endpoints.

Existing APIs:

- `/api/business-member`
- `/api/ownership-share`
- `/api/capital-contribution`
- `/api/management-fee-agreement`
- `/api/banking-event`
- `/api/partner-payout`
- `/api/partner/{userId}`
- `/api/mileage-package`

Implementation notes:

- Build operational cash and partner management screens, not report polish.
- Include partner list/detail, capital contribution, management fee agreement,
  banking event, partner payout, and mileage package create where schemas exist.
- Avoid UI that implies per-vehicle manager scoping until GAP-1 is built.
- Use existing shared schemas and QueryState.

Acceptance:

- Partner and banking data can be created/read through the UI where endpoints
  already exist.
- Initial ownership splits can be created for vehicles without a current split;
  changing an existing split waits for a close-and-replace backend operation.
- Management agreements can be granted and revoked; revoked rows stay visible
  and inert.
- Money values preserve string/bigint rules.
- Screens are usable at 360 x 640.
- Tests cover at least one happy path and one failed read/write per surface.

### UI-10 - Toast primitive

Goal:

Add the missing toast primitive and host. Wire undo only where it is real and
safe.

Primary files:

- design primitive folder under `web/src/design/`
- app shell/provider files

Implementation notes:

- Build the primitive/provider/host first.
- Use it for non-money, low-risk success/failure confirmations as appropriate.
- Do not fake undo. If a write has no safe undo endpoint or domain operation,
  record the call site as pending instead of adding misleading UI.

Acceptance:

- Toasts are accessible, dismissible, and do not cover sticky actions.
- Multiple toasts stack or queue predictably.
- Tests cover render, dismiss, timeout, and keyboard/screen-reader basics.
- First call sites are documented.

## Delayed work

Delay these unless the user explicitly reprioritizes them:

- Report catalogue, report visual polish, and new report API/query work.
- Offline/PWA support.
- A14 signed printed-slip share link.
- Full structured double-booking conflict dialog if the backend does not yet
  provide conflict details.
- Ownership-share replacement after an existing current split.
- Management-agreement API role validation beyond the UI's manager-only picker.
- Rich advance settlement display until the driver-view response includes
  `settledMinor` and `tripId`.
- A9b broader soft-delete/backfill work.
- GAP-1 per-vehicle capability scoping.
- Phase-2 write-off and post-closure charge screens.

## Common acceptance checklist

For every implemented item:

- Update the owning `docs/` section if behavior changed.
- Update `TRACKER.md`; update `Plan.md` if sequencing changes.
- Use existing primitives before adding new ones.
- Use `QueryState` for reads.
- Preserve money rules: string on the wire, bigint/minor units in logic, never
  number.
- Use color tokens, not raw hex.
- Verify 360 x 640 and 320px portrait.
- For mobile-specific UI, verify 640 x 360 landscape where relevant.
- For sheet/date/navigation fixes, test the primitive and at least one real call
  site.
- Record if real iPhone Safari or Android Chrome verification was not possible.

## Suggested first prompt for the new chat

```text
Read AGENTS.md, CLAUDE.md, web/AGENTS.md, web/CLAUDE.md,
UI-LOW-API-WORK-PLAN-2026-08-11.md, Plan.md, TRACKER.md,
docs/design/ui-ux-guidelines.md, and docs/product/user-flows.md.

Start with UI-1 DateField global simplification. Do not work on reports or
offline/PWA. Update docs/tracker with the design decision, implement the
DateField simplification, and run focused tests plus a mobile browser check.
```
