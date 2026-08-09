# FleetSettle UI Look And Feel Implementation Plan

Date: 2026-08-09  
Source findings: `UI-LOOK-FEEL-REQUIRED-CHANGES-2026-08-09.md` and latest hosted QA review  
Primary scope: `web/src` UI primitives, operational list rows, calendar state colors, reports/review polish

## Objective

Implement the UI look-and-feel improvements without changing the app's product direction. FleetSettle should stay compact, mobile-first, operational, and list-led. The goal is to make status, money direction, navigation, and irreversible actions faster to understand.

This is not a redesign. It is a visual semantics pass.

## Non-Goals

- Do not add a marketing-style landing page or hero treatment.
- Do not add gradients, blobs, large illustrations, or decorative backgrounds.
- Do not replace the current navigation structure.
- Do not introduce a broad new palette unless existing tokens cannot express the state.
- Do not communicate state with color alone.
- Do not combine unrelated product behavior changes with this visual pass.

## Implementation Strategy

Ship this as a small sequence of focused changes. Start with shared primitives, then update high-traffic screens, then finish with reports/review once those routes are visible in hosted QA.

Recommended branch name:

`codex/ui-look-feel-semantics`

## Phase 1 - Shared Design Primitives

### UI-LF-01 - Add Shared Badge Primitive

Priority: P1  
Dependency: none  
Risk: low, if introduced additively first

Files:

- `web/src/design/primitives/Badge.tsx`
- `web/src/design/primitives/index.ts` if this project uses primitive barrel exports
- New test: `web/src/design/primitives/Badge.test.tsx` if primitive tests are already colocated

Implementation:

- Create `Badge` with semantic variants: `brand`, `good`, `warning`, `serious`, `critical`, `neutral`.
- Use compact styling: `inline-flex`, `rounded-sm`, `text-caption`, `font-medium`, `px-2`, `py-0.5`.
- Use existing tokens first:
  - `brand`: `bg-brand-wash text-brand-ink`
  - `good`: `bg-good/15 text-good-ink`
  - `warning`: `bg-warning/15 text-warning-ink`
  - `serious`: `bg-serious/15 text-serious-ink`
  - `critical`: `bg-critical/15 text-critical-ink`
  - `neutral`: `border border-line-hairline bg-surface text-ink-muted`
- Keep `className` passthrough for local spacing.

Acceptance:

- Badge renders each variant.
- Badge remains readable in light and dark themes.
- Feature screens no longer hand-roll badge-like spans.

Tests:

- Add a small render/class test for variant output.
- Include accessible text assertions in feature tests where badges replace plain text.

### UI-LF-02 - Add Card Accent Support And Tighten Repeated Card Radius

Priority: P1  
Dependency: none  
Risk: medium, because `Card` is widely used

Files:

- `web/src/design/primitives/Card.tsx`
- Existing screens using repeated row cards

Implementation:

- Add optional `accent` prop to `Card`, or create a `RowCard` wrapper if changing `Card` globally is too broad.
- Use a narrow left accent only: `border-l-[3px]` or `border-l-4`.
- Keep the rest of the card surface neutral.
- Change repeated card radius to 8px:
  - Preferred: change `Card` default from `rounded-md` to `rounded-sm` only if visual QA confirms sheets/dialogs do not depend on `Card`.
  - Safer alternative: keep `Card` unchanged and introduce `RowCard` with `rounded-sm`.

Accent mapping:

- Arrangement A: `brand`
- Arrangement B: `good`
- Arrangement C: `serious`
- Open incident: `warning`
- Closed incident: `good`
- Voided expense: `critical`
- Paid money out: `direction-payable`
- Received money: `brand` or `good`, depending on nearby product language

Acceptance:

- Repeated rows look compact and operational.
- Accent color is always paired with text, badge, or icon.
- No screen becomes visually dominated by saturated backgrounds.

Tests:

- Add primitive coverage for `accent`.
- Update feature tests only where class or structure changes affect selectors.

### UI-LF-03 - Add Active Tab Indicator Beyond Color

Priority: P1  
Dependency: none  
Risk: low

Files:

- `web/src/design/primitives/AppShell.tsx`
- `web/src/app/App.test.tsx` or existing shell tests

Implementation:

- Add `relative` to bottom navigation buttons.
- For active tabs, render a stable visual marker beyond icon/text color.
- Recommended shape: a `before` top pill on active buttons.
- Preserve `aria-current="page"`.
- Keep tab bar height stable at `h-14`.

Acceptance:

- Active tab is identifiable without relying on color.
- No layout shift when switching tabs.
- The Add quick action remains visually distinct but not incorrectly marked as a route.

Tests:

- Assert `aria-current="page"` remains present.
- Add a class or DOM assertion for the active indicator.

## Phase 2 - High-Traffic Operational Screens

### UI-LF-04 - Vehicle List And Vehicle Overview Semantics

Priority: P1  
Dependencies: UI-LF-01, UI-LF-02

Files:

- `web/src/features/vehicles/VehicleListScreen.tsx`
- `web/src/features/vehicles/VehicleOverviewScreen.tsx`
- Existing tests for both screens

Implementation:

- Replace arrangement muted text with `Badge`.
- Apply arrangement accents to vehicle list rows.
- Add trailing `ChevronRight` to rows that navigate.
- On the vehicle detail card, render current arrangement as a badge rather than plain body text.
- In incident rows, replace muted status text with `Badge`.
- Add incident row accent by status.

Mappings:

- `Lease out`: `brand`
- `Daily lease`: `good`
- `Trips / charter`: `serious`
- `Open`, `Repairs recorded`, `Recovery pending`: `warning`
- `Closed`: `good`

Acceptance:

- Arrangement can be understood in one glance on the vehicle list.
- Incident status is scan-readable before opening the incident.
- Navigating rows look tappable.

Tests:

- Vehicle list renders arrangement badge labels.
- Vehicle overview renders arrangement badge and incident status badge.
- Clicking navigable rows still calls the expected handler.

### UI-LF-05 - Expense Void Styling And Destructive Confirmation

Priority: P1  
Dependencies: UI-LF-01, UI-LF-02

Files:

- `web/src/features/costs/ExpenseCostRow.tsx`
- `web/src/features/costs/VoidExpenseSheet.tsx`
- Tests for expense rows and void sheet

Implementation:

- For voided expenses, show `Badge variant="critical"` with label `Voided`.
- Keep category and amount struck through.
- Render void reason with stronger visual treatment than current muted appended text.
- Keep voided rows non-tappable.
- Make the final `Void expense` submit button use `variant="destructive"`.
- Keep the sheet body calm until final confirmation.

Acceptance:

- A voided expense cannot be mistaken for a live expense.
- The void reason is visible without opening another screen.
- Live expense rows still open the void sheet.
- Voided expense rows do not open the void sheet.

Tests:

- Live row click opens `VoidExpenseSheet`.
- Voided row has no click action.
- Voided row shows `Voided` badge and reason.
- Submit button in `VoidExpenseSheet` is destructive.

### UI-LF-06 - More Screen Navigation And Consequence Treatment

Priority: P1  
Dependencies: UI-LF-02, optionally UI-LF-01

Files:

- `web/src/features/more/MoreScreen.tsx`
- `web/src/features/more/MoreScreen.test.tsx`
- `web/src/features/period/CloseMonthScreen.tsx`

Implementation:

- Add trailing `ChevronRight` to More rows that navigate.
- Keep Sign out separate from navigation mental model, since it opens a sheet.
- Use icon tone only where it carries meaning:
  - `Opening balances`: brand or neutral
  - `Close the month`: warning or serious
  - `Reports`: brand/chart
  - `My share`: direction/payable or brand
  - `Sign out`: muted
- In `CloseMonthScreen`, use serious/critical visual emphasis only for the final irreversible confirmation.

Acceptance:

- `Close the month` no longer looks equivalent to low-risk rows.
- Rows that navigate have consistent affordance.
- Icon color does not become decorative noise.

Tests:

- More rows still route to the same paths.
- Capability-gated rows remain absent when unavailable.
- Sign out still opens confirmation sheet.

## Phase 3 - Calendar And Money Semantics

### UI-LF-07 - Calendar State Color Mapping

Priority: P1  
Dependencies: UI-LF-01 optional

Files:

- `web/src/features/vehicles/VehicleCalendarScreen.tsx`
- Existing or new `VehicleCalendarScreen.test.tsx`

Implementation:

- Update `cellStyle` mapping:
  - Lease out `L`: `bg-brand-wash text-brand-ink`
  - Daily lease ran check glyph: `bg-good/15 text-good-ink`
  - Daily lease not yet confirmed `B`: `bg-warning/15 text-warning-ink`
  - Daily lease lost `!`: `bg-critical/15 text-critical-ink`
  - Trip `T`: `bg-serious/15 text-serious-ink`
  - Hold `T?`: hide until persisted, or keep outline only if real data can produce it
- Update legend rows to match the exact same classes and labels.
- Keep glyphs because state must not rely on color alone.

Acceptance:

- Calendar states are visually distinct.
- Legend and cell colors match exactly.
- Daily lease ran and daily lease pending no longer share the same color.
- Lost days use critical treatment.

Tests:

- Add direct tests for each state mapping.
- Verify legend labels and glyphs.
- Keep free-day click tests passing for lease and trip creation entry points.

### UI-LF-08 - Money Direction Consistency

Priority: P2  
Dependencies: UI-LF-01, UI-LF-02

Files:

- `web/src/components/TwoBalances.tsx`
- `web/src/features/period/CloseMonthScreen.tsx`
- `web/src/features/costs/PayDriverSheet.tsx`
- `web/src/features/costs/DepositSheet.tsx`
- `web/src/features/costs/AdvanceSheet.tsx`
- `web/src/features/review/*`

Implementation:

- Keep `TwoBalances` as the source for the established direction language:
  - `He owes you`: brand/good direction
  - `You owe him`: `direction-payable`
- Apply the same visual language to rows for payments, deposits, advances, and partner balances.
- Avoid inventing new terms in UI copy during this pass.

Acceptance:

- User can distinguish money received vs money paid out by both label and visual accent.
- Direction colors are consistent across operate and review shells.

Tests:

- Add or update tests around rendered labels and signs.
- Do not snapshot broad pages unless the project already prefers snapshots.

## Phase 4 - Supporting Structure And Empty States

### UI-LF-09 - Section Header Treatment

Priority: P2  
Dependencies: UI-LF-01 optional

Files:

- `web/src/design/primitives/Section.tsx`
- `web/src/features/vehicles/VehicleOverviewScreen.tsx`
- `web/src/features/incidents/*`
- `web/src/features/trips/*`

Implementation:

- Add optional `icon` and `tone`/`accent` props to `Section`.
- Move count out of title text and into a compact neutral badge.
- Use `text-body-sm font-semibold text-ink-secondary` for important section headers.
- Keep existing collapse behavior unchanged.

Acceptance:

- Dense detail screens are easier to scan.
- Count is still visible and accessible.
- Section changes do not make headers feel like dashboard cards.

Tests:

- Section renders title and count.
- Collapse and `Show all` behavior remains unchanged.

### UI-LF-10 - EmptyState And NotAvailable Variants

Priority: P2  
Dependencies: UI-LF-01 optional

Files:

- `web/src/components/EmptyState.tsx`
- `web/src/components/NotAvailable.tsx`
- Screens that show positive empty states or unavailable detail rows

Implementation:

- Add `EmptyState tone="calm"` for positive empty states like `Nothing needs you today`.
- Add optional icon support, but use it sparingly.
- Add `NotAvailable variant="inline" | "row"`.
- Keep current inline rendering as the default.
- Use row variant only where unavailable data otherwise looks unfinished.

Acceptance:

- Empty screens feel intentional, not blank.
- Unavailable values remain honest and compact.
- No decorative illustration is added.

Tests:

- EmptyState renders message and action as before.
- NotAvailable preserves `aria-label`.
- Row variant renders the reason visibly.

## Phase 5 - Reports And Review Polish

### UI-LF-11 - Reports Catalogue Grouping

Priority: P3  
Dependencies: UI-LF-01, UI-LF-02  
Release dependency: hosted QA must expose `/reports` for this account

Files:

- `web/src/features/reports/ReportsCatalogueScreen.tsx`
- `web/src/features/reports/ReportScreen.tsx`
- `web/src/features/reports/charts/*`

Implementation:

- Group report cards by purpose:
  - Profit
  - Operations
  - Money owed
  - Cash held
- Add small purposeful icons per group.
- Use `Badge` for report status or warning labels.
- Keep chart colors inside chart components only.
- Keep navigation row affordance consistent with the rest of the app.

Acceptance:

- Reports catalogue does not look like an undifferentiated neutral list.
- Report grouping helps users choose the right report faster.
- Existing report screens remain readable on mobile.

Tests:

- Catalogue renders expected report groups.
- Existing report screen tests remain green.
- Chart smoke tests remain green.

### UI-LF-12 - Review Shell Visual Alignment

Priority: P3  
Dependencies: UI-LF-01, UI-LF-02, UI-LF-08

Files:

- `web/src/features/review/ReviewThisMonthScreen.tsx`
- `web/src/features/review/ReviewMoneyScreen.tsx`
- `web/src/features/review/ReviewVehiclesScreen.tsx`
- `web/src/features/review/ReviewVehicleDetailScreen.tsx`
- `web/src/features/review/VehiclePerformanceCard.tsx`

Implementation:

- Apply the same badge, accent, and money direction rules used in Operate.
- Do not make the Review shell more decorative than Operate.
- Prefer table precision for exact money values and charts only for comparison.

Acceptance:

- Operate and Review feel like one product.
- Owner-facing summaries remain compact and scannable.

Tests:

- Existing review tests remain green.
- Add coverage for any new grouped card headings or money direction labels.

## Recommended Delivery Order

1. UI-LF-01 Badge primitive
2. UI-LF-03 Active tab indicator
3. UI-LF-02 Card accent and repeated row radius
4. UI-LF-04 Vehicle list and overview semantics
5. UI-LF-05 Expense void styling and destructive confirmation
6. UI-LF-07 Calendar state color mapping
7. UI-LF-06 More screen navigation and consequence treatment
8. UI-LF-09 Section header treatment
9. UI-LF-10 EmptyState and NotAvailable variants
10. UI-LF-08 Money direction consistency
11. UI-LF-11 Reports catalogue grouping
12. UI-LF-12 Review shell alignment

## Test Plan

Run focused tests after each phase, then run the full web suite before handoff.

Focused examples:

```sh
npm run test -w @fleetsettle/web -- Badge
npm run test -w @fleetsettle/web -- AppShell
npm run test -w @fleetsettle/web -- VehicleListScreen
npm run test -w @fleetsettle/web -- VehicleOverviewScreen
npm run test -w @fleetsettle/web -- ExpenseCostRow
npm run test -w @fleetsettle/web -- VehicleCalendarScreen
npm run test -w @fleetsettle/web -- MoreScreen
```

Final local gate:

```sh
npm run test -w @fleetsettle/web
```

Hosted QA smoke after deployment:

- Home, including positive empty state.
- Vehicles list.
- Vehicle detail for arrangement A, B, and C vehicles.
- Vehicle detail with live and voided expense rows.
- Vehicle detail with open and closed incidents.
- Calendar month containing lease, daily ran, daily pending, daily lost, and trip states.
- More screen with capability-gated rows visible for an owner-manager user.
- Close month final confirmation state.
- Direct `/reports` once the hosted account exposes it.
- Review shell tabs for owner and owner-manager roles.
- Mobile viewport around 360 x 640.
- Desktop/narrow browser viewport.
- Dark and light theme, if theme switching is available.

## Release And Rollback Plan

- Release phases 1 to 4 together if tests are stable; they form the core visual semantics package.
- Hold Phase 5 until report/review routes are confirmed visible in hosted QA.
- If card radius or accent changes have too much blast radius, rollback by switching feature screens to `RowCard` while leaving base `Card` unchanged.
- If any semantic color fails contrast in dark mode, keep the text/icon label and adjust the token usage before shipping.
- If a new trip token is proposed, defer it unless `serious` becomes overloaded in real screens.

## Definition Of Done

- All P1 tickets complete.
- P2 tickets complete unless explicitly deferred.
- Every visual state uses text or icon plus color.
- Active tab is identifiable without color.
- Repeated row cards are 8px radius or use an equivalent compact row wrapper.
- Calendar legend and cells match exactly.
- Irreversible actions have final-step destructive or serious treatment.
- `npm run test -w @fleetsettle/web` passes.
- Hosted QA visual smoke passes on the screens listed above.
