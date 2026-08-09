# FleetSettle UI Look And Feel Required Changes

Date: 2026-08-09  
Environment reviewed: `https://qa.fleetsettle.com`  
Scope: live QA UI plus `web/src` design primitives and feature screens

## Verdict

Do not redesign FleetSettle. The current direction is right: compact, mobile-first, operational, and list-led. The needed change is a tighter visual system for meaning.

The live app currently reads as too neutral. Most rows are the same surface card, the same hairline border, the same muted metadata, and the same gray icons. That makes the app calm, but it also makes important differences too slow to scan: daily lease vs trip, open vs closed, paid vs received, voided vs live, safe action vs irreversible action.

The code already has useful tokens: `brand`, `direction-payable`, `good`, `warning`, `serious`, `critical`, plus chart colors. The first pass should use those existing tokens before adding new colors.

## Live Evidence

Reviewed live surfaces:

- Home: `Nothing needs you today`
- Vehicles list
- Vehicle detail for `NC-1234`
- Vehicle actions sheet
- People list
- Driver detail for `Sunil Perera`
- More
- Calendar for `QA-52656`
- Direct `/reports`

Observed:

- Dark theme contrast is strong.
- Repeated cards are clean, but too visually similar.
- Active tab is only a text/icon color change.
- Vehicle arrangement labels are plain muted text.
- Incident status labels are plain muted text.
- Voided expense rows are struck through correctly, but the void reason is visually muted rather than correction-colored.
- Calendar uses only two main state color families: brand for lease/daily/open and serious for trip/lost/hold.
- More rows use icons, but all icons are neutral gray. `Close the month` does not look more consequential than `Opening balances`.
- Direct `/reports` still renders `Not built yet` in the hosted environment for this account.

## Code Evidence

Relevant files:

- `web/src/design/tokens.css`
- `web/src/design/primitives/Card.tsx`
- `web/src/design/primitives/Button.tsx`
- `web/src/design/primitives/AppShell.tsx`
- `web/src/design/primitives/Section.tsx`
- `web/src/design/primitives/Sheet.tsx`
- `web/src/components/EmptyState.tsx`
- `web/src/components/NotAvailable.tsx`
- `web/src/components/TwoBalances.tsx`
- `web/src/features/vehicles/VehicleListScreen.tsx`
- `web/src/features/vehicles/VehicleOverviewScreen.tsx`
- `web/src/features/vehicles/VehicleCalendarScreen.tsx`
- `web/src/features/costs/ExpenseCostRow.tsx`
- `web/src/features/more/MoreScreen.tsx`
- `web/src/features/period/CloseMonthScreen.tsx`
- `web/src/features/reports/*`
- `web/src/features/review/*`

## Required Changes

### P1 - Add A Status/Badge Primitive

Create one shared primitive for small semantic labels, then replace plain muted labels where the label carries state.

Suggested primitive:

- File: `web/src/design/primitives/Badge.tsx`
- Shape: inline-flex, `rounded-sm`, `text-caption`, `font-medium`, `px-2`, `py-0.5`
- Variants:
  - `brand`: `bg-brand-wash text-brand-ink`
  - `good`: `bg-good/15 text-good-ink`
  - `warning`: `bg-warning/15 text-warning-ink`
  - `serious`: `bg-serious/15 text-serious-ink`
  - `critical`: `bg-critical/15 text-critical-ink`
  - `neutral`: `bg-surface text-ink-muted border border-line-hairline`

First use sites:

- `VehicleListScreen`: arrangement label
- `VehicleOverviewScreen`: arrangement label and incident status
- `ExpenseCostRow`: voided marker/reason
- `CloseMonthScreen`: payment status
- Reports/review cards: report status and warning labels

Recommended mappings:

- `Lease out`: `brand`
- `Daily lease`: `good`
- `Trips / charter`: `serious`
- `Open`: `warning`
- `Closed`: `good`
- `Voided`: `critical`
- `Draft`: `warning`
- `Settled`: `good`
- `Pending`: `warning`

### P1 - Make Navigation Rows Look Tappable

Live rows are clickable, but many look like static cards. Add a consistent trailing affordance for navigation rows.

Required:

- Add a trailing `ChevronRight` to list rows that navigate.
- Do not add it to rows that open a correction sheet or submit an action unless navigation is the mental model.
- Keep the icon muted by default, but color it on active/pressed state.

First use sites:

- `VehicleListScreen`
- `PeopleListScreen`
- `MoreScreen`
- `ReportsCatalogueScreen` already does this; use it as the local pattern.
- `VehicleOverviewScreen` incident rows

This will also help keyboard/accessibility work because rows will read more clearly as actions.

### P1 - Use Domain Accents On Repeated Cards

Keep cards quiet, but add a narrow left accent for rows whose category matters.

Required:

- Add optional `accent` support to `Card`, or create a `RowCard` wrapper.
- Use `border-l-[3px]` or `border-l-4`; avoid full saturated card backgrounds.
- Continue to pair color with text, badge, or icon.

First mappings:

- Vehicle arrangement A: brand
- Vehicle arrangement B: good
- Vehicle arrangement C: serious
- Open incident: warning
- Closed incident: good
- Voided expense: critical
- Paid money out: direction-payable
- Received money: brand or good, depending on product language

Candidate files:

- `web/src/design/primitives/Card.tsx`
- `web/src/features/vehicles/VehicleListScreen.tsx`
- `web/src/features/vehicles/VehicleOverviewScreen.tsx`
- `web/src/features/costs/ExpenseCostRow.tsx`
- `web/src/features/period/CloseMonthScreen.tsx`

### P1 - Make Irreversible Actions Visually Serious

`Close the month` currently looks like any other row in More, but it is irreversible. `Void expense` uses a plain sheet action until the final button.

Required:

- In `MoreScreen`, tint `Close the month` with `warning` or `serious` icon treatment.
- In `CloseMonthScreen`, use a serious/critical confirm style only at the final irreversible confirmation.
- In `VoidExpenseSheet`, keep the sheet calm, but make the final `Void expense` button `destructive`.
- Use `critical` only for irreversible destructive correction, not every warning.

Candidate code:

- Add `warning` or `serious` button variant in `Button.tsx`, or keep screen entry rows neutral and use `destructive` only on confirmation.
- `MoreScreen`: color `CalendarCheck` with `text-warning-ink` or `text-serious-ink`.
- `VoidExpenseSheet`: `Button variant="destructive"` for final submit.

### P1 - Improve Calendar Color Semantics

The calendar is the clearest place to use color, but the current mapping compresses too many meanings.

Current:

- Lease, daily ran, daily open all use brand wash.
- Trip, lost, tentative hold all use serious.

Required mapping:

- Lease out (`L`): `bg-brand-wash text-brand-ink`
- Daily lease ran (`check` glyph): `bg-good/15 text-good-ink`
- Daily lease not yet confirmed (`B`): `bg-warning/15 text-warning-ink`
- Daily lease lost (`!`): `bg-critical/15 text-critical-ink`
- Trip (`T`): use a dedicated trip token, or `bg-serious/15 text-serious-ink` until that token exists.
- Hold (`T?`): hide until the hold state is persisted, or keep as outline only if it can really occur.

Required code:

- Update `cellStyle` in `VehicleCalendarScreen.tsx`.
- Update legend rows to match exactly.
- Add unit tests that assert the class mapping for each state.

Optional token addition:

- `--color-trip`
- `--color-trip-ink`
- `--color-trip-wash`

Do this only if `serious` is also needed for warning-like states elsewhere; otherwise keep trip on `serious` to avoid palette sprawl.

### P2 - Strengthen Section Headers

Current section headers like `Costs - 3` and `Incidents - 2` are small muted labels. They work, but they do not help scanning on dense detail screens.

Required:

- Update `Section.tsx` to support an optional icon and semantic accent.
- Use `text-body-sm font-semibold text-ink-secondary` rather than `text-label` for high-value sections.
- Move count into a small neutral badge, for example `Costs` + `3`.

First use sites:

- Vehicle Overview: Paperwork, Costs, Incidents, History
- Incident Detail: repair/recovery sections
- Trip Detail: Costs
- Driver Detail: balances/actions if sections expand later

Keep it compact. This is not a dashboard header; it is a scan aid.

### P2 - Make Empty And Unavailable States Feel Intentional

Live Home shows only `Nothing needs you today`. That is correct, but visually bare. Inline unavailable rows show `not available - reason`, which is accurate but easy to read as unfinished.

Required:

- Update `EmptyState` to allow an optional calm state icon and/or soft wash.
- Use a quiet `bg-brand-wash` or neutral surface row for positive empty states.
- Update `NotAvailable` to optionally render as a small info row for form/detail contexts.

Suggested variants:

- `EmptyState tone="calm"`: `bg-surface border border-line-hairline`
- `NotAvailable variant="inline"`: current behavior
- `NotAvailable variant="row"`: `rounded-sm bg-brand-wash text-brand-ink` or neutral surface

Do not add decorative illustrations. Keep it operational.

### P2 - Make Voided Money Rows More Explicit

The live voided expense row behaves correctly, but the reason is in muted text. For a money correction, the reason should be easier to notice.

Required:

- In `ExpenseCostRow`, add a `Badge variant="critical"` with label `Voided`.
- Put the reason after the badge in `text-critical-ink` or `text-ink-muted` with a critical icon.
- Keep category and amount struck through.
- Keep the row non-tappable once voided.

Suggested rendered shape:

`Repairs` + `Rs 43.21` struck through  
`Voided` badge + `9 Aug 2026 - QA targeted void test`

### P2 - Add Active Tab Indicator Beyond Color

Live bottom navigation uses color only for the active tab. In dark mode it is readable, but subtle.

Required:

- Add a small top border, dot, or pill behind the active icon/label.
- Use `brand` token.
- Keep nav height stable.

Suggested implementation:

- In `AppShell.tsx`, add `relative` to tab buttons.
- For active tabs, render `before:absolute before:top-0 before:h-0.5 before:w-8 before:rounded-full before:bg-brand`.
- Keep `aria-current="page"` as-is.

### P2 - Use Existing Icons More Expressively

Icons exist, especially in More and action sheets, but most are neutral. Use color where the icon is the quickest signal.

Required:

- `Opening balances`: brand or neutral
- `Close the month`: warning/serious
- `Reports`: brand/chart
- `My share`: direction/payable or brand
- `Sign out`: muted
- `Report incident`: warning/serious
- `Void expense`: critical

Avoid coloring every icon. Color means state or consequence, not decoration.

### P2 - Tighten Card Radius For Operational Density

`Card.tsx` uses `rounded-md`. The token file currently sets `--radius-md: 12px`, while `--radius-sm` is `8px`. Repeated list cards should stay at 8px or less for a utilitarian product feel.

Required:

- Change repeated `Card` default to `rounded-sm`, or adjust `--radius-md` to `8px`.
- Reserve larger radius for bottom sheets/dialogs only.

Likely file:

- `web/src/design/primitives/Card.tsx`

### P3 - Improve Report Catalogue Visual Grouping

The local code now has report catalogue and review screens, but hosted QA still rendered direct `/reports` as `Not built yet` for this account. Once deployed/visible, these screens should not be just another neutral list.

Required:

- Group report cards by purpose:
  - Profit
  - Operations
  - Money owed
  - Cash held
- Add a small colored icon per report group.
- Use `ReportTable` for precise numbers and charts only where comparison is useful.
- Use chart colors only inside charts; do not leak chart palette into ordinary navigation rows.

Candidate files:

- `web/src/features/reports/ReportsCatalogueScreen.tsx`
- `web/src/features/reports/ReportScreen.tsx`
- `web/src/features/reports/charts/*`

### P3 - Improve Money Direction Consistency

`TwoBalances` already has a good start: brand for `He owes you`, payable orange for `You owe him`. Extend that language elsewhere.

Required:

- Received money: use brand/good accent.
- Paid money out: use `direction-payable`.
- Held deposits: use brand or a new `held` token if it becomes common.
- Partner owed/balance rows: use the same direction mapping.

Candidate files:

- `TwoBalances.tsx`
- `CloseMonthScreen.tsx`
- `PayDriverSheet.tsx`
- `DepositSheet.tsx`
- `AdvanceSheet.tsx`
- Review/My share screens

## Suggested Implementation Order

1. Add `Badge`.
2. Add active tab indicator in `AppShell`.
3. Change `Card` default repeated radius to 8px.
4. Update vehicle list/detail rows with badges and left accents.
5. Update `ExpenseCostRow` voided styling.
6. Update `VehicleCalendarScreen` color mapping and legend.
7. Update More row icon tones and irreversible action treatment.
8. Update `Section` header treatment.
9. Update `EmptyState` and `NotAvailable` variants.
10. Polish report/review catalogue once B4 is visible on hosted QA.

## Acceptance Checks

- No screen becomes dominated by one color family.
- Every color-coded state also has text or an icon.
- Cards remain compact, with 8px radius for repeated rows.
- Active tab is identifiable without relying on color alone.
- Voided, open, closed, pending, paid, received, and irreversible states are scan-readable within one second.
- Calendar legend and cell colors match exactly.
- Dark mode and light mode both pass visual inspection.
- `npm run test -w @fleetsettle/web` remains clean.

## Non-Goals

- No full redesign.
- No marketing-style hero treatment.
- No decorative gradients, blobs, or large illustrations.
- No broad palette expansion until existing tokens are exhausted.
- No color-only state communication.
