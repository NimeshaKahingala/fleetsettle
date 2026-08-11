# Pending Review Items - 2026-08-10

This file replaces the root-level review/audit files listed in the disposition table at the end.

Evaluation method: each review file was checked against the current source tree, `TRACKER.md`, and `Plan.md`. When an older review file conflicted with a newer tracker/source state, the newer source/tracker state won. Completed, superseded, or explicitly declined items are not carried as work.

## Highest Priority

- [ ] **F3 / GAP-103 - Opening balances do not become ledger facts.**
  Decide the model first: either materialize the six opening-balance entry kinds into the same money tables the rest of the product reads, or keep opening balances as a separate ledger that every relevant report and balance query reads alongside live facts. Then implement all six entry kinds: `customer_due`, `driver_arrears`, `owed_to_driver`, `deposit_held`, `advance_outstanding`, and `cash_held`.
  Acceptance checklist:
  - [ ] Confirming a batch writes or exposes real facts for receivables, driver balances, held deposits, outstanding advances, and opening cash.
  - [ ] Re-confirming or retrying does not double-post money.
  - [ ] Correcting a committed batch before the first close updates the same effective facts or clearly replaces them.
  - [ ] Once the first accounting period is closed, the existing lock still prevents rewriting opening figures.
  - [ ] Reports and balances that currently read `obligation`, `deposit`, `advance`, and cash sources include opening figures.
  - [ ] Opening figures never become income or profit unless the product documents explicitly say so.
  - [ ] API integration tests cover every entry kind plus report/balance visibility.

- [ ] **F4 / GAP-104 - Mobile sheet history race.**
  Fix the shared modal layer so `ActionSheet`, nested picker sheets, and `EntityPicker` add-new handoffs do not close the newly opened sheet or the parent sheet on touch/coarse-pointer devices.
  Acceptance checklist:
  - [ ] `ActionSheet` no longer closes itself and opens the target sheet in the same unsafe synchronous mobile-history path.
  - [ ] `useMobileHistoryDismiss` tracks ownership of the history entry it pushed and does not blindly pop another sheet's entry.
  - [ ] Nested `MoneyField` / `AmountPad`, `EntityPicker`, and reason/date picker sheets leave their parent sheet open after save/select.
  - [ ] Quick Add Fuel, Expense, and New trip work on a phone-sized touch viewport.
  - [ ] Driver money, Vehicle actions, Incident actions, Lease actions, and People Add actions get the same regression coverage.
  - [ ] MP-07 style tests cover touch/coarse-pointer modal behavior at the primitive level before individual screens are trusted.
  - [ ] A real iOS Safari or Android Chrome pass confirms the fix after the desktop touch-emulation pass is green.

- [ ] **GAP-83 / GAP-105 / MP-01 / MP-06 - DateField accessibility and fallback.**
  Make `DateField` one clear date control by default. The hidden native input must not be a separate invisible Tab stop, and the picker button needs a real fallback when `showPicker()` is unavailable.
  Acceptance checklist:
  - [ ] Remove the focusable `sr-only` date input pattern, or overlay the native input over the visible target so keyboard and pointer users get one visible control.
  - [ ] Make Today/Yesterday shortcuts opt-in through a prop, not present on every date field.
  - [ ] Range screens do not render six visible date controls for two values.
  - [ ] The visible date target has an accessible name that says it opens/edits a date.
  - [ ] Safari/non-`showPicker` browsers can still open or focus a usable date input.
  - [ ] Tests cover default DateField, shortcut-enabled DateField, range report fields, keyboard tab order, and the no-`showPicker` branch.

- [ ] **GAP-106 - Cash-position deposit label is party-specific but the data is not.**
  `CashPositionReportScreen` labels a party-agnostic held-deposit total as "Held for customers".
  Acceptance checklist:
  - [ ] Replace all three user-facing labels with neutral copy such as "Held as deposits", or split the server response by party type and label each split accurately.
  - [ ] Update the unit test that currently asserts the wrong "held for customers" wording.
  - [ ] Verify a driver deposit is no longer described as customer money.

- [ ] **GAP-89 - Operate tab mapping for real non-tab routes.**
  `tabForPathname` currently sends every route outside `/vehicles`, `/people`, and `/more` to Home.
  Acceptance checklist:
  - [ ] `/review*`, `/reports*`, `/period/close`, and `/opening-balances` stay in the Operate shell and highlight More.
  - [ ] `/trips/:id`, `/incidents/:id`, `/leases/:id`, and `/leases/:id/close` highlight Vehicles.
  - [ ] Tests cover the route families above, including report detail routes.

- [ ] **GAP-91 - Close-month final confirmation needs destructive tone.**
  The irreversible close-month dialog still uses the primary button style.
  Acceptance checklist:
  - [ ] Pass `variant="destructive"` to `DialogConfirmFooter` in `CloseMonthScreen`.
  - [ ] Keep the first non-final call to action primary if desired.
  - [ ] Add a regression test that opens the final confirm dialog and verifies destructive styling.

- [ ] **GAP-100 - Advance settlement and trip-scoped advances are not reachable in the UI.**
  The client can issue a driver-scoped advance, but it cannot attach an advance to a trip or settle one from the product.
  Acceptance checklist:
  - [ ] Add a trip-scoped advance issue path where the flow needs it.
  - [ ] Add a settlement/reconciliation path for `POST /api/advance/{id}/settle`.
  - [ ] Unblock and test the `TRIP_ADVANCE_UNSETTLED` close-trip path.
  - [ ] Re-run MP-08 validation for a `Dialog` inside `CloseTripSheet` once the precondition is reachable.

- [ ] **A7 / GAP-16 - Attachment upload is implemented for expense receipts but not fully product-complete.**
  Current tracker state says the attachment integration suite and golden fixture verification ran successfully; older pending notes saying otherwise are stale.
  Acceptance checklist:
  - [ ] Open a fresh PR or otherwise merge the expense-receipt branch.
  - [ ] Run manual QA on a 360x640 viewport: fuel fill with two receipts, reopen expense, see thumbnails, void one receipt, confirm 404 for the voided object, and confirm linked-driver access is forbidden.
  - [ ] Build the remaining photo call sites when their owning flows are scheduled: condition photos at lease start, condition photos at close, incident damage photos, and handover/return comparison.
  - [ ] Close or schedule GAP-17: move expensive photo encoding off the main thread or add the documented timeout behavior.
  - [ ] Decide GAP-107 attachment retention before any purge/archive job is built.

## Backend Integrity And Trust Boundaries

- [ ] **GAP-1 - Per-vehicle capability scoping.**
  Design decision is recorded but not built: `ownership_share` scopes owner/owner-manager vehicles; `management_fee_agreement` scopes manager vehicles.
  Acceptance checklist:
  - [ ] Apply scoped checks in reports, partner capital, ownership shares, payouts, exports, vehicle summaries, and future dashboards.
  - [ ] Keep UI copy from implying manager per-vehicle scoping exists until the API enforces it.
  - [ ] Add tests proving a manager cannot read all-business reports or capital for vehicles outside their scope.

- [ ] **GAP-59 - Related IDs are validated independently, not coherently.**
  Acceptance checklist:
  - [ ] Expenses that name a vehicle plus trip/incident verify those IDs refer to the same vehicle/event relationship.
  - [ ] Post-closure-charge source, party, and vehicle relationships are validated as one coherent business event.
  - [ ] Decide whether each invariant belongs in handler validation, database constraints, or both.

- [ ] **GAP-5 - Durable overpayments/credits.**
  Acceptance checklist:
  - [ ] Persist `recordPayment` surplus as a reusable ledger fact.
  - [ ] Later billing, ageing, statements, and close checklist warnings can see and apply the credit.
  - [ ] Tests cover refresh/retry behavior and allocation of existing credits.

- [ ] **GAP-21 - Scheduled jobs use one global business date.**
  Acceptance checklist:
  - [ ] Compute scheduled work per business timezone.
  - [ ] Log scheduled output per business and business date.
  - [ ] Test a business whose local date differs from the Worker/server date.

- [ ] **GAP-94 - Close checklist can still miss facts that were never generated.**
  Acceptance checklist:
  - [ ] Warnings account for missing generated facts, not only rows that already exist.
  - [ ] Ongoing daily leases remain visible when the cron has not extended the new period yet.
  - [ ] Revisit this once durable credits and the remaining generated facts exist.

- [ ] **GAP-8 - Concurrent close/correction idempotency at the database level.**
  Acceptance checklist:
  - [ ] Add database-backed uniqueness/locking for close and correction writes that must be idempotent under concurrent attempts.
  - [ ] Add adversarial concurrent integration tests around month close and correction paths.

- [ ] **A9b / GAP-12 / GAP-36 / GAP-60 - Remaining soft delete, void-and-replace, and correction links.**
  Acceptance checklist:
  - [ ] Add void paths for the remaining W-50 money tables.
  - [ ] Add archive/delete lifecycle for driver, customer, vehicle, and any other currently permanent setup rows that need correction.
  - [ ] Add per-table self-referencing replacement/correction links where a void is replaced by a new row.
  - [ ] Preserve closed-period protections.

- [ ] **GAP-7 - Trip hold/in-progress semantics.**
  Acceptance checklist:
  - [ ] Either implement hold/in-progress states end to end, or remove/hide UI/legend language that implies they exist.
  - [ ] Ensure tentative enquiries cannot suppress daily-lease income as if they were confirmed trips.

- [ ] **A8 / GAP-30 / GAP-32 - Expense detail completion.**
  Acceptance checklist:
  - [ ] Wire `expense.odometer_reading_id` through request schema, domain transaction, queries, and UI, following the existing odometer-reading convention.
  - [ ] Decide and implement borne-by override to a specific driver/customer, not only "Us".

- [ ] **GAP-58 / GAP-86 - Acceptance coverage and test noise.**
  Acceptance checklist:
  - [ ] Turn the 178-case test manifest from all `not_started` into actual tracked evidence.
  - [ ] Reduce recurring non-failing test warnings so real regressions are not hidden in noise.
  - [ ] Stabilize slow/flaky API integration coverage where it masks real failures.

## Product And UI Surface Completion

- [ ] **B9 - Remaining UI/UX fixes.**
  Acceptance checklist:
  - [ ] GAP-44: enrich `VEHICLE_DOUBLE_BOOKED` with conflicting dates/entity, carry it through the wire schema, and render the INV-1 blocking `Dialog` in `StartLeaseScreen` and `BookTripScreen`.
  - [ ] GAP-45: trip detail title only shows the year where needed and does not clip at 360px.
  - [ ] GAP-46: occupied vehicle-calendar cells get `aria-label`s naming the state.
  - [ ] GAP-47: landscape mobile app bar/tab bar collapse according to M-26 and keep Home actions above the fold at 640x360.
  - [ ] GAP-48: build a `Toast` primitive, wire it to `#toast-root`, and decide which writes qualify for the 5-second undo window.
  - [ ] GAP-55: add `autoComplete` support/tokens for name, phone, and address fields.
  - [ ] GAP-96: show the scoped vehicle cost total that expense voiding changes, or provide another clear aggregate surface.
  - [ ] GAP-97: add Book trip to the vehicle-actions sheet for arrangement-C vehicles.
  - [ ] GAP-99: remove user-facing "presigned upload storage" implementation copy, or let it disappear when the relevant photo flow ships.
  - [ ] M-25: rename "Excess rate per km" to "Excess fee per km" or "Excess charge per km".
  - [ ] Add e2e coverage for keyboard activation of real row/button surfaces; the earlier row-keyboard bug itself was treated as likely browser-control artifact, but the coverage request remains valid.
  - [ ] `npm run check` clean; axe checks cover calendar and any new dialog.

- [ ] **B16 Phase 2 and Phase 3 - Visual semantics still open.**
  Acceptance checklist:
  - [ ] Section headers have stronger treatment than muted text plus a count.
  - [ ] EmptyState and NotAvailable get intentional variants.
  - [ ] ActionSheet actions can carry semantic tone where consequences differ.
  - [ ] Reports catalogue is grouped by purpose and easier to scan.
  - [ ] Review/report money-direction presentation is consistent.
  - [ ] Do not carry the 8px card-radius recommendation; it was explicitly declined against the current UI spec.

- [ ] **B15 / GAP-82 - Quick Add payment actions.**
  Acceptance checklist:
  - [ ] Add Payment received and Payment made to Quick Add.
  - [ ] Put an entity/party picker in front of the existing payment write path.
  - [ ] Preserve the existing direct lease/driver payment entry points.

- [ ] **B5 - Mine shell.**
  Acceptance checklist:
  - [ ] Replace `/me` placeholder with a separate Mine component tree.
  - [ ] Wire `GET /api/driver-view`.
  - [ ] Show `TwoBalances`, days including excused days, trips and fees, advances, offsets, and held deposit.
  - [ ] Provide the statement link.
  - [ ] Assert there are no write affordances and no `driverId` prop/param.

- [ ] **B6 - Customer detail.**
  Acceptance checklist:
  - [ ] Replace `/people/customers/:id` placeholder.
  - [ ] Wire customer obligation and payment reads.
  - [ ] Reuse the lease-hub dues interaction where appropriate.
  - [ ] Add a statement view.

- [ ] **B2 - Partners, banking, and cash.**
  Acceptance checklist:
  - [ ] Add `/cash` and `/partners/:id`.
  - [ ] Build Partner detail over `GET /api/partner/{userId}`.
  - [ ] Build OwnershipSharesForm, CapitalContributionSheet, ShareVehicleForm, BankingEventForm, and CashPositionScreen.
  - [ ] Wire `BorneByPaidBy` paid-by picker to `GET /api/business-member`.
  - [ ] Add MileagePackageForm for create/list/archive without repricing existing leases.
  - [ ] Add RecordPayoutSheet for partner payouts.
  - [ ] Avoid UI that implies GAP-1 per-vehicle scoping exists before it is enforced.

- [ ] **GAP-102 - Vehicle paperwork can be read but not updated in the client.**
  Acceptance checklist:
  - [ ] Add a small UI for `PUT /api/vehicle/{id}/document`.
  - [ ] Let managers resolve paperwork warnings by entering renewed expiry/reference data.

- [ ] **A14 / GAP-65 - Printed slip signed share link.**
  Acceptance checklist:
  - [ ] Build signed, expiring, no-login share links for printed statements/slips.
  - [ ] Keep this separate from the authenticated Mine statement link.

- [ ] **GAP-68 - Scheduled maintenance predictive prompt.**
  Acceptance checklist:
  - [ ] Keep the existing servicing/repairs recording path.
  - [ ] Add the missing "next time" prompt based on maintenance history and odometer data.

- [ ] **Admin/owner workflows still API-ahead-of-UI.**
  Acceptance checklist:
  - [ ] Decide whether to build in-app invite, revoke, role-change, and driver link/unlink management screens.
  - [ ] Decide where write-off and post-closure charge UIs belong.
  - [ ] Keep backend-only endpoints either intentionally hidden or clearly owned by a future UI item.

- [ ] **Phase-2 report surfaces remain intentionally hidden.**
  Acceptance checklist:
  - [ ] Keep UC-77/UC-78/UC-79 out of the phase-1 report catalogue unless the owning docs bring them forward.
  - [ ] Before exposing them, resolve GAP-73 goodwill date basis/breakdown and GAP-98 notes about mounted-but-incomplete endpoints.
  - [ ] Utilisation must answer the use case, including revenue-per-available-day or an explicitly narrower title.

## Live And Manual Verification Still Needed

- [ ] A7 attachment manual QA on real mobile-size viewport.
- [ ] Real iOS Safari / Android Chrome pass for GAP-104 and DateField `showPicker` fallback.
- [ ] LT-1 second-identity check for Review and Mine shells once B5 is ready.
- [ ] LT-3 360px trip-form pass after GAP-45/GAP-47.
- [ ] LT-6 driver money writes after the mobile sheet handoff is fixed.
- [ ] LT-8 close-month live pass last, after all earlier destructive/write checks.
- [ ] MP-08 dialog-inside-sheet validation after GAP-100 makes the advance-block precondition reachable.

## Completed, Declined, Or Superseded Items Not Carried

- Daily-lease start/change materialization for the initial 90-day horizon is complete via GAP-88/D-9.
- Trip booking server arrangement guard is complete via GAP-87.
- Report `from <= to` validation is complete via GAP-92.
- Partner payment membership validation is complete via GAP-93.
- Management-fee obligations are generated via GAP-39/A10a.
- Incident customer contributions now create/settle receivables via GAP-10/A10b.
- Read-error contract is complete via GAP-101 and guarded by `check-forbidden.mjs`.
- Revoked-member review-money 500 is closed via GAP-90 plus GAP-101.
- B4 Wave 1 and Wave 2 are complete, including GAP-70, GAP-71, GAP-72, and GAP-74.
- GAP-76, GAP-78, GAP-79, GAP-80, and GAP-81 have source/unit/live confirmation and are not carried.
- GAP-84, GAP-85, and LT-7/GAP-3 are regression-clean or confirmed fixed.
- Generic collapsed Disclosure labels and the 8px card-radius recommendation were explicitly declined against the owning UI spec.
- The old M-10 default "Confirm" complaint is resolved because `DialogConfirmFooter` now requires `confirmLabel`.

## Source File Disposition

| Reviewed file | Disposition |
| --- | --- |
| `API-CONTRACT-AUDIT-FINDINGS-2026-08-09.md` | Deleted after consolidation. ACA-01/02/03/04 are complete; ACA-05/06/07/08/09/10/11 survive as GAP-100, B5, B6, B2/admin UI, phase-2 report notes, GAP-89, and GAP-94. ACA-12 is stale except for general test-stability tracking. |
| `ATTACHMENT-UPLOAD-IMPLEMENTATION-PLAN-2026-08-09.md` | Deleted after consolidation. Expense-receipt upload implementation exists; non-goals and open questions survive as A7 follow-ons, GAP-17, and GAP-107. |
| `ATTACHMENT-UPLOAD-PENDING-2026-08-10.md` | Deleted after consolidation. Integration/golden/wrangler-placeholder blockers are stale in current tracker/source; manual QA, PR/merge, remaining call sites, GAP-17, and retention survive. |
| `B4-REPORTS-DESIGN-REVIEW.md` | Deleted after consolidation. B4 is complete; phase-2 report caveats and GAP-1 survive. |
| `B4-REPORTS-DESIGN.md` | Deleted after consolidation. B4 design decisions are now implemented or recorded in tracker; UC-77/78/79 remain phase-2. |
| `BACKEND-API-QUERY-EVALUATION-2026-08-09.md` | Deleted after consolidation. BE-01/05/06/07/11 are complete; BE-02/03/04/08/09/10 survive as GAP-1, GAP-59, GAP-5, GAP-21, GAP-94, and GAP-98/phase-2 notes. |
| `FLOW-INVENTORY-AUDIT.md` | Deleted after consolidation. GAP-61/62/63/64/66 are complete; GAP-65/67/68/69 and the advance-completion residue survive. |
| `GAP-101-READ-ERROR-CONTRACT-PLAN-2026-08-10.md` | Deleted after consolidation. Fully implemented; no unique pending work. |
| `LIVE-BROWSER-FINDINGS-2026-08-10.md` | Deleted after consolidation. GAP-103, GAP-104, GAP-83/GAP-105, GAP-106, and GAP-100/MP-08 validation survive; GAP-84, GAP-85, and LT-7 are fixed/regression-clean. |
| `LIVE-TEST-PLAN.md` | Deleted after consolidation. Remaining live checks are listed above; fixed or superseded checks are dropped. |
| `MOBILE-SHEET-AND-DATE-PICKER-FINDINGS-2026-08-09.md` | Deleted after consolidation. MP-01 through MP-07 survive under GAP-104/GAP-105/GAP-83; MP-08 survives as validation after GAP-100. |
| `MUST-FIX-FINDINGS.md` | Deleted after consolidation. Arrangement, incident receivables, and management fees are complete; durable credits, per-vehicle scoping, related-ID validation, timezone, close safeguards, DB idempotency, trip states, correction links, and acceptance coverage survive. |
| `QA-COMPREHENSIVE-TEST-FINDINGS-2026-08-08.md` | Deleted after consolidation. Verified fixes dropped; GAP-89, GAP-91, GAP-83, GAP-96, GAP-97, B16 residue, test noise, and acceptance coverage survive. Row-keyboard app bug was treated as likely tooling artifact, but e2e keyboard coverage survives. |
| `QA-ROOT-CAUSES-AND-REQUIRED-MODIFICATIONS-2026-08-09.md` | Deleted after consolidation. RC-01/03/07 are complete or regression-clean; RC-02/04/05/06 survive as GAP-89, GAP-91, B16 residue, and shared empty/unavailable variants. |
| `STATIC-SOURCE-AUDIT-FINDINGS-2026-08-09.md` | Deleted after consolidation. Completed static findings dropped; surviving backend/UI items mapped to the checklist above. |
| `UI-LOOK-FEEL-IMPLEMENTATION-PLAN-2026-08-09.md` | Deleted after consolidation. Phase 1 is complete; Phase 2/3 residue survives. |
| `UI-LOOK-FEEL-REQUIRED-CHANGES-2026-08-09.md` | Deleted after consolidation. Completed/declined design changes dropped; Section, EmptyState/NotAvailable, ActionSheet tone, report grouping, and money-direction consistency survive. |
| `UI-UX-REVIEW.md` | Deleted after consolidation. GAP-3 is fixed; GAP-44 through GAP-48, GAP-55, M-25, and toast/undo survive. |
