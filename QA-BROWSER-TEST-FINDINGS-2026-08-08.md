# QA Browser Test Findings - FleetSettle

Date: 2026-08-08  
Environment: https://qa.fleetsettle.com/  
Tester: Codex browser session  
Scope: signed-in read/write UI smoke test, responsive UX pass, and CRUD/state-transition review.

## Summary

The hosted QA app is usable for the currently exposed core workflows. Login, navigation, create flows, expense/fuel writes, trip booking, trip cancellation, trip closing, mobile layout, and console health all passed basic browser testing.

No browser console errors or warnings were observed during the tested flows.

The biggest issues found are not crashers; they are product correctness and UX clarity issues:

- A booked trip with a customer and agreed amount displayed `Received -> Due -> Rs 0`, hiding the amount actually due.
- Required-field validation often falls back to generic `Invalid input`.
- Trip history is not visible from a vehicle detail page, even for a trips/charter vehicle.
- There is no visible UI to void/correct expenses or clean up test-created vehicles/drivers/customers.
- Several shipped UI areas expose implementation gaps as user-facing copy.

## QA Data Written

The following QA records were created intentionally:

- Driver: `QA Driver 0808052656`
- Customer: `QA Customer 0808052656`
- Vehicle: `QA-52656`, type `QA Van`, arrangement `Trips / charter`
- Overhead expense: `Other`, `Rs 123.45`, no vehicle selected
- Fuel expense on `NC-1234`: `Rs 22.22`
- Trip on `QA-52656` with customer/driver/destination, then cancelled with reason `QA cancellation 0808052656`
- Trip on `QA-52656` with no customer/driver, then closed

These records were left in QA because the visible UI does not expose delete/archive/unlink/void controls for the created people/vehicle records, and expense voiding is API-level only in the current app surface.

## Flows Tested

Passed:

- Signed-in Home loads.
- Bottom navigation: Home, Vehicles, Add, People, More.
- Deep links and route URLs for list/detail screens.
- People list and driver detail navigation.
- Vehicle list and vehicle detail navigation.
- Create driver, including empty required-field validation.
- Create customer, including person-without-mobile/NIC validation.
- Create vehicle, including empty required-field validation.
- Quick Add -> Expense -> amount -> category -> submit.
- Quick Add -> Fuel -> amount -> submit.
- Quick Add -> New trip -> choose vehicle -> book trip.
- Trip detail -> Cancel trip with reason.
- Trip detail -> Close trip.
- More -> Sign out sheet -> cancel/close only.
- 320px and 360px responsive checks for major screens.

Not fully tested:

- Actual sign-out submission, to avoid ending the session.
- Payment collection, lease closure, and daily-lease start, because the visible QA data did not present a low-risk complete path for those in this pass.
- Expense voiding through API, because the user-facing UI does not expose it.

## Required Modifications

### P0 - Fix trip receivable display

Observed:

After booking a trip with:

- Customer: `QA Customer 0808052656`
- Agreed amount: `Rs 555`
- Driver fee: `Rs 111`

The trip detail showed:

```text
Agreed
Rs 555

Received
Due
Rs 0
```

This reads as if nothing is due, even though the trip has a customer and agreed amount.

Required modification:

- Update `TripDetailScreen` so the receivable row shows the amount owed/outstanding, not only `settledMinor`.
- If the obligation shape does not include a direct outstanding amount, compute display as due amount minus settled amount.
- Use copy such as `Outstanding` or `Received / Outstanding` so managers can distinguish what was collected from what is still owed.
- Add a regression test for a booked trip with customer + agreed amount + unpaid receivable.

Likely source:

- `web/src/features/trips/TripDetailScreen.tsx`

### P1 - Replace generic validation messages

Observed:

Empty driver form:

```text
Name
Invalid input
```

Empty vehicle form:

```text
Registration
Invalid input

Vehicle type
Invalid input
```

Customer missing mobile/NIC is better:

```text
A person needs an NIC or a mobile number
```

Required modification:

- Replace generic Zod fallback messages with field-specific copy:
  - `Name is required`
  - `Registration is required`
  - `Vehicle type is required`
- Keep the existing customer contact validation style; it is much clearer.
- Add tests asserting the exact user-facing validation text.

Likely sources:

- `web/src/features/people/CreateDriverForm.tsx`
- `web/src/features/vehicles/CreateVehicleForm.tsx`

### P1 - Add visible correction/void paths for money records

Observed:

The API supports voiding expenses (`POST /api/expense/{id}/void`), and vehicle detail displays voided rows correctly, but the visible QA UI does not expose a way to void/correct a mistaken expense.

Required modification:

- Add an expense row action from vehicle/trip/incident cost lists:
  - `Void expense`
  - required reason
  - confirmation suitable for correction workflows
- After voiding, keep the row visible with strike-through and reason, matching the existing display convention.
- Add browser/e2e coverage for create expense -> void expense -> row remains visible and struck through.

Likely sources:

- `web/src/features/vehicles/VehicleOverviewScreen.tsx`
- `web/src/features/trips/TripDetailScreen.tsx`
- `web/src/features/incidents/IncidentScreen.tsx`

### P1 - Show trip history on vehicle detail

Observed:

After creating, cancelling, and closing trips on vehicle `QA-52656`, the vehicle detail page showed only the vehicle facts:

```text
Registration
QA-52656
Type
QA Van
Arrangement
Trips / charter
```

No trip history section appeared.

Required modification:

- Add a trip history section to vehicle overview, especially for arrangement `C` vehicles.
- Include booked, closed, and cancelled trip rows.
- Make rows tap through to trip detail.
- Ensure cancelled trips show cancellation status/reason.

Likely sources:

- `web/src/features/vehicles/VehicleOverviewScreen.tsx`
- API may need a `GET /api/vehicle/{id}/trip` or equivalent route if one does not already exist.

### P2 - Improve mobile trip form layout

Observed at 360px:

On trip step 1, `Next` appears before the bottom navigation while `Agreed amount` sits close to the bottom-nav area. The form is functional, but the visual order feels cramped and easy to misread.

Required modification:

- Revisit `Screen` primary-action placement on long mobile forms.
- Ensure the primary CTA remains visually after the form content, or make it a clearly sticky footer separated from fields.
- Add a mobile visual regression for trip step 1 at 360x640.

Likely sources:

- `web/src/design/primitives/Screen.tsx`
- `web/src/features/trips/BookTripScreen.tsx`

### P2 - Reduce repeated headings on driver detail

Observed:

Driver detail starts with:

```text
Sunil Perera
Sunil Perera
```

Required modification:

- Avoid repeating the same name as both page title and first content heading.
- Use the second slot for metadata, status, or remove it.

Likely source:

- `web/src/features/people/DriverDetailScreen.tsx`

### P2 - Improve empty/vague incident labels

Observed:

Vehicle incident row:

```text
No description recorded
6 Aug 2026
Closed
```

Required modification:

- Use a fallback with more operational value, for example `Incident with no description`.
- Consider including incident type/cost/recovery status where available.

Likely source:

- `web/src/features/vehicles/VehicleOverviewScreen.tsx`

### P2 - Add management paths for created entities

Observed:

Created drivers, customers, and vehicles are visible but not manageable from the tested UI surface. There is no obvious edit/archive/delete/unlink path from list/detail screens.

Required modification:

- Add appropriate management actions by entity:
  - Vehicle: archive/dispose/edit paperwork/basic details.
  - Driver: unlink, archive/inactivate, edit mobile/fees.
  - Customer: edit contact/identity, archive/inactivate if supported by domain.
- If hard delete is intentionally forbidden, label the domain action clearly (`Archive`, `Dispose`, `Unlink`, `Void`) rather than hiding correction paths.

## UX Notes

Positive:

- Bottom navigation is stable and muscle-memory friendly.
- Core sheets are fast and generally easy to dismiss.
- 320px and 360px checks did not show horizontal scrolling.
- Tap targets in sampled flows were at least 44px.
- Customer validation copy is specific and helpful.
- Cancel and close trip state transitions are understandable once on trip detail.

Needs attention:

- Some intentionally unbuilt areas are exposed as plain text (`no advance list read exists yet (Web-P8b)`, `photo capture needs upload support, not built yet`). That is useful to engineers but should not ship as production-facing copy.
- Quick Add omits payment received/payment made, even though the product flow comments say those are part of the intended fixed list. If not ready, consider whether managers need a visible disabled/unavailable explanation or a staged release note.
- There is no central list for overhead expenses, so the overhead expense created in this pass is not discoverable from the tested UI.

## Console And Responsive Status

- Console errors/warnings observed: none.
- Horizontal overflow observed at 320px/360px: none on sampled screens.
- Major sampled mobile screens:
  - Home
  - Vehicles
  - Vehicle detail
  - People
  - Driver detail
  - More
  - Quick Add sheets
  - Trip booking/cancel/close

