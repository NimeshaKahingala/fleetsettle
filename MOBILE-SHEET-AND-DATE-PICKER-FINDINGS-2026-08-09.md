# FleetSettle Mobile Sheet And Date Picker Findings

Date: 2026-08-09

Scope: source audit after user-reported UX concern and iPhone Chrome bug.

User observations:

- Date fields show `Today`, `Yesterday`, and a separate picker control. This feels confusing when repeated across most date inputs.
- On iPhone Chrome, tapping `Add` -> `Fuel`, `Expense`, or `New trip` appears to do nothing.
- The same flow works on laptop.

No source code changes were made for these findings.

## Finding MP-01 - DateField Default Is Too Busy Across The App

Priority: P2 UX

Current behavior:

- `web/src/components/DateField.tsx` renders:
  - `Today` chip
  - `Yesterday` chip
  - a separate button showing the selected weekday/date
  - a visually-hidden native `<input type="date">`
- The field is reused broadly across expense, fuel, trip, lease, incident, payment, report, opening-balance, and close/correction flows.

Why this is confusing:

- Three visible controls compete for one value.
- `Today` and `Yesterday` are useful shortcuts in a few operational flows, but when they appear everywhere they stop feeling like shortcuts and start looking like alternative modes.
- Date range screens show the same quick chips twice, once for `From` and once for `To`, which makes the form visually heavier and easier to misread.
- Users may not know whether the visible weekday button or the Today/Yesterday buttons are the primary picker.

Technical note:

- The actual native date input is `sr-only`.
- The visible picker button calls `inputRef.current.showPicker()` only when that function exists.
- On mobile browsers with inconsistent `showPicker()` support, the visible button may become weaker than a normal visible native date input.

Recommendation:

1. Make the shared `DateField` default to one clear picker control only.
2. Keep the displayed weekday/date hint, because it helps users verify the date.
3. Remove `Today` and `Yesterday` from the default field.
4. If shortcuts are still useful, make them opt-in via a prop such as `quickPresets`.
5. Use shortcuts only in high-frequency operational actions where the majority of entries are same-day or previous-day, for example:
   - fuel fill
   - ordinary expense
   - payment received/paid
   - daily day confirmation
6. Avoid shortcuts on setup/report/range fields, for example:
   - lease start/end
   - daily-lease effective dates
   - report `from`/`to`
   - opening balance go-live date
   - insurance/registration expiry dates

Required modification:

- Refactor `DateField` so the base component is a single picker. Add a deliberate optional preset area only where product wants speed shortcuts.

Required tests:

- Shared component test: default `DateField` does not render `Today` or `Yesterday`.
- Shared component test: optional presets render only when requested.
- UI smoke tests for fuel/expense/payment flows where shortcuts remain enabled, if chosen.
- UI smoke tests for report/date-range fields proving shortcuts are absent.

## Finding MP-02 - iPhone Chrome Quick Add Actions Can Close The New Sheet Immediately

Priority: P1 mobile UX/functionality

Affected observed flow:

- `Add` -> `Fuel`
- `Add` -> `Expense`
- `Add` -> `New trip`

Likely affected source areas beyond Quick Add:

- `web/src/features/quick-add/QuickAddSheet.tsx`
- `web/src/features/people/DriverDetailScreen.tsx`
- `web/src/features/people/PeopleListScreen.tsx`
- `web/src/features/incidents/IncidentScreen.tsx`
- `web/src/features/leases/LeaseHubScreen.tsx`
- `web/src/features/vehicles/VehicleOverviewScreen.tsx`

Source evidence:

- `web/src/design/primitives/ActionSheet.tsx` closes the current sheet and immediately runs the selected action in the same click handler:
  - `onOpenChange(false)`
  - `onSelect()`
- Quick Add actions set another sheet open immediately:
  - Fuel -> `setFuelOpen(true)`
  - Expense -> `setExpenseOpen(true)`
  - New trip -> `setTripVehiclePickerOpen(true)`
- Every `Sheet` uses `useMobileHistoryDismiss(open, onOpenChange)`.
- `web/src/lib/useMobileHistoryDismiss.ts` only activates on coarse-pointer devices:
  - `window.matchMedia("(pointer: coarse)").matches`
- When a sheet closes by tap/overlay/drag rather than a real popstate, the hook calls `history.back()` to remove the mobile sheet history entry.

Root cause:

This is a mobile sheet handoff race.

On iPhone Chrome, the first sheet has pushed a history entry. When the user taps `Fuel`, `Expense`, or `New trip`, the action sheet closes and the target sheet opens during the same user action. The closing action sheet then runs its mobile cleanup and calls `history.back()`. Depending on timing, that back navigation can pop the history entry for the newly opened sheet or deliver a `popstate` to the new sheet, causing the new sheet to close immediately.

Why laptop works:

- Laptop/desktop usually does not match `(pointer: coarse)`.
- Therefore `useMobileHistoryDismiss` does not push a sheet history entry and does not call `history.back()` during sheet close.
- Without the mobile history cleanup, the immediate close/open handoff appears to work.

Required modification:

1. Fix this in the shared sheet/action-sheet layer, not only in Quick Add.
2. Do not close an `ActionSheet` and open the next `Sheet` in the same synchronous click path on mobile.
3. Introduce a safe handoff mechanism, for example:
   - close the current action sheet, wait until its history cleanup completes, then run the selected action
   - or add a sheet stack/replace API so one sheet can replace another without calling `history.back()`
   - or update `useMobileHistoryDismiss` so it only removes the specific history entry it created and cannot pop a newer sheet entry
4. Avoid blind `history.back()` when another modal has already opened.
5. Keep the fix shared so Driver actions, Incident actions, Lease actions, People add actions, Vehicle actions, and Quick Add all inherit it.

Required tests:

- Unit/regression test with `window.matchMedia("(pointer: coarse)")` returning true:
  - ActionSheet item closes the action sheet and opens the next sheet.
  - The next sheet remains open after the mobile history cleanup.
- Quick Add tests on coarse pointer:
  - `Fuel` leaves `Log a fuel fill` visible.
  - `Expense` leaves `Record expense` visible.
  - `New trip` leaves the vehicle picker visible.
- Add the same regression shape for DriverDetail, IncidentScreen, LeaseHubScreen, PeopleListScreen, and VehicleOverviewScreen.
- Real browser/e2e mobile viewport test for the hosted app:
  - Use a touch/coarse-pointer context.
  - Tap `Add` -> `Fuel`.
  - Assert the target sheet remains visible.

## Finding MP-03 - The Same ActionSheet Handoff Risk Exists Outside Quick Add

Priority: P1 mobile UX/functionality

Source-confirmed shared pattern:

- `web/src/design/primitives/ActionSheet.tsx` handles every action click by calling `onOpenChange(false)` and then immediately calling the action's `onSelect()`.
- That means every caller that opens a second modal from an `ActionSheet` can hit the same close/open/history race described in MP-02.

Affected source areas:

- `web/src/features/quick-add/QuickAddSheet.tsx`
  - `Fuel`, `Expense`, and `New trip`.
- `web/src/features/people/DriverDetailScreen.tsx`
  - `Pay the driver`, `Record advance`, and `Refund deposit`.
- `web/src/features/people/PeopleListScreen.tsx`
  - `Add driver` and `Add customer`.
- `web/src/features/incidents/IncidentScreen.tsx`
  - `Off-road`, customer contribution, and insurance claim actions.
- `web/src/features/leases/LeaseHubScreen.tsx`
  - collect, adjust, renew, and read-odometer actions.
- `web/src/features/vehicles/VehicleOverviewScreen.tsx`
  - record expense and report incident actions.

Likely user-visible symptoms on iPhone Chrome:

- Tapping an action appears to do nothing.
- The target sheet flashes briefly and closes.
- The browser may move one history step while the app looks unchanged.

Root cause:

The root cause is not each screen's state setter. The common issue is that the shared `ActionSheet` performs an immediate synchronous handoff while the closing `Sheet` still owns a mobile history entry. On touch devices, the closing sheet's cleanup calls `history.back()`, and the newly opened sheet can receive the resulting `popstate` or lose its newly pushed history entry.

Required modification:

1. Fix the shared handoff behavior once in the primitive layer.
2. Add either an `onActionComplete`/deferred action path to `ActionSheet`, or a modal-stack/history owner that can replace the active sheet without a blind `history.back()`.
3. Keep the call sites declarative; avoid one-off `setTimeout` patches in each feature screen.
4. Regression-test at least one caller from each affected area above.

## Finding MP-04 - Nested Picker Sheets Can Close Their Parent Sheet On Touch

Priority: P1 mobile UX/functionality

Source-confirmed shared pattern:

- `web/src/components/MoneyField.tsx` opens its own internal `Sheet` for `AmountPad` unless `degrade` is true.
- `web/src/components/EntityPicker.tsx` opens its own internal searchable `Sheet`.
- `web/src/components/ReasonPicker.tsx` is a controlled `Sheet` that closes and then calls `onSelect(reason)`.
- These picker components are frequently rendered inside another open `Sheet`.

High-risk usage areas:

- `web/src/features/costs/FuelFillSheet.tsx`
- `web/src/features/costs/RecordExpenseSheet.tsx`
- `web/src/features/daily/SomethingElseSheet.tsx`
- `web/src/features/incidents/CustomerContributionSheet.tsx`
- `web/src/features/incidents/InsuranceClaimSheet.tsx`
- `web/src/features/incidents/RecoveryReceivedSheet.tsx`
- `web/src/features/incidents/SettleInsuranceClaimSheet.tsx`
- `web/src/features/leases/AdjustObligationSheet.tsx`
- `web/src/features/leases/RenewLeaseSheet.tsx`
- `web/src/features/opening-balance/AddOpeningBalanceEntrySheet.tsx`
- `web/src/features/people/AdvanceSheet.tsx`
- `web/src/features/people/DepositSheet.tsx`
- `web/src/features/people/OffsetSheet.tsx`
- `web/src/features/people/PayDriverSheet.tsx`
- `web/src/features/period/CorrectPaymentSheet.tsx`
- `web/src/features/trips/BookTripScreen.tsx`
- `web/src/features/vehicles/StartDailyLeaseScreen.tsx`
- `web/src/features/vehicles/StartLeaseScreen.tsx`

Likely user-visible symptoms on iPhone Chrome:

- Selecting an amount closes the amount pad and also dismisses the parent form.
- Selecting a driver/customer/vehicle closes the whole form instead of returning to it.
- Selecting a reason/category closes more UI than intended.

Root cause:

Every `Sheet` independently calls `useMobileHistoryDismiss`. When a parent sheet is open, it pushes one history entry. When a nested picker sheet opens, it pushes another. When the nested picker closes by save/select, its cleanup calls `history.back()`. That browser back event returns to the parent's history entry, but the parent sheet's `popstate` listener is still active and treats the event as a request to close itself.

Required modification:

1. Add a sheet-stack/history manager so only the topmost sheet handles a given `popstate`.
2. Make `useMobileHistoryDismiss` track ownership of the history entry it created instead of treating every `popstate` as its own close event.
3. Consider a non-modal mode for nested pickers:
   - `MoneyField` can degrade to inline input automatically when it is already inside a sheet.
   - `EntityPicker` can render an inline searchable panel or use the parent sheet as the active modal surface.
   - `ReasonPicker` can share a safe handoff path with `ActionSheet`.
4. Add tests where a parent sheet remains open after:
   - saving an amount in `MoneyField`
   - selecting an entity in `EntityPicker`
   - selecting a reason in `ReasonPicker`

## Finding MP-05 - EntityPicker Add-New Handoffs Have The Same Mobile Race

Priority: P2 mobile UX/functionality

Source-confirmed examples:

- `web/src/features/trips/BookTripScreen.tsx`
  - customer picker `onAddNew={() => setAddCustomerOpen(true)}`
  - driver picker `onAddNew={() => setAddDriverOpen(true)}`
- `web/src/features/vehicles/StartLeaseScreen.tsx`
  - customer picker `onAddNew={() => setAddCustomerOpen(true)}`
- `web/src/features/vehicles/StartDailyLeaseScreen.tsx`
  - driver picker opens an add-driver sheet.
- `web/src/components/EntityPicker.tsx` closes the picker and immediately calls `onAddNew()`.

Root cause:

This is the same immediate modal handoff as MP-02 and MP-03, but it is triggered from a picker inside a workflow rather than from a top-level action sheet. The picker closes, starts mobile history cleanup, and the add-new sheet opens in the same click path.

Required modification:

1. Route `EntityPicker` add-new actions through the same safe modal handoff mechanism used for `ActionSheet`.
2. Add regression tests that tap `Add new driver` or `Add new customer` on a coarse-pointer device and verify the add sheet remains open.
3. Verify the original parent workflow still has its selected value updated after creating the new entity.

## Finding MP-06 - DateField Picker Button Has No Fallback When `showPicker()` Is Missing

Priority: P2 mobile UX/accessibility

Source-confirmed behavior:

- `web/src/components/DateField.tsx` renders a visually hidden `<input type="date">`.
- The visible date button only calls `inputRef.current.showPicker()` when that function exists.
- If `showPicker()` is unavailable or blocked, the visible button does nothing.

Root cause:

The component assumes the modern `HTMLInputElement.showPicker()` API is available. The input is visually hidden, so there is no visible native fallback control if that API is missing or behaves differently on a mobile browser.

Required modification:

1. Prefer one visible native date control, or provide a fallback path that focuses/clicks the input when `showPicker()` is unavailable.
2. Test the no-`showPicker` branch explicitly.
3. Combine this with MP-01 so the field becomes one clear picker instead of chips plus a hidden picker.

## Finding MP-07 - Current Tests Miss The Touch-Only Modal Failure Class

Priority: P1 test coverage

Source-confirmed test gaps:

- `web/src/test/setup.ts` defaults `window.matchMedia` to `matches: false`, which means most component tests run as desktop.
- `web/src/features/quick-add/QuickAddSheet.test.tsx` renders `<QuickAddSheet open onOpenChange={() => {}} ... />`, so the parent action sheet never actually closes in response to the click.
- `web/src/lib/useMobileHistoryDismiss.test.tsx` covers one sheet at a time, but not:
  - an action sheet closing while another sheet opens
  - a child sheet closing while a parent sheet remains open
  - two `useMobileHistoryDismiss` listeners active during one history transition
- `MoneyField`, `EntityPicker`, and `ReasonPicker` tests validate isolated behavior, not nested behavior inside a parent sheet on coarse pointer.

Required modification:

1. Add a reusable test helper that renders with `matchMedia("(pointer: coarse)")` returning true.
2. Add a controlled parent wrapper for sheet-to-sheet tests instead of passing no-op `onOpenChange`.
3. Simulate or spy on `history.back()` plus `popstate` so tests observe the same failure class as iPhone Chrome.
4. Add one integration-style test for each shared primitive:
   - `ActionSheet`
   - `MoneyField`
   - `EntityPicker`
   - `ReasonPicker`

## Watch Item MP-08 - Dialog Inside Sheet Has A Stacking/Focus Risk

Priority: P3 validation needed

Source-confirmed shape:

- `web/src/features/trips/CloseTripSheet.tsx` renders a `Dialog` inside a `Sheet`.
- `web/src/design/primitives/Sheet.tsx` gives sheet content `z-50`.
- `web/src/design/primitives/Dialog.tsx` gives both dialog overlay and dialog content `z-50`.

Why this is only a watch item:

- This may work because the dialog portal is likely appended after the sheet portal.
- However, equal z-index values make the layering order dependent on portal ordering rather than an explicit modal hierarchy.

Required validation:

1. In a real browser, trigger the `TRIP_ADVANCE_UNSETTLED` path from `CloseTripSheet`.
2. Confirm the dialog overlay appears above the sheet.
3. Confirm focus lands in the dialog and returns correctly after closing it.
4. If it fails, give `Dialog` a clearly higher modal layer than `Sheet`, or route the confirm through the same modal stack used for the sheet-history fixes.

## Proposed Fix Order

1. Fix MP-02 first because it blocks core mobile workflows.
2. Fix MP-03, MP-04, and MP-05 in the same shared modal-history pass.
3. Add MP-07 regression coverage before changing individual feature screens.
4. Then simplify the shared DateField default and fallback behavior from MP-01 and MP-06.
5. Validate MP-08 in a real browser and only change it if the stacking/focus issue reproduces.

## Notes

- This document records source-confirmed root causes and required changes only.
- No implementation changes were made as part of this documentation pass.
