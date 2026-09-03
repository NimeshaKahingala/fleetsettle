# FleetSettle — Mobile UI/UX polish recommendations

**Date:** 21 August 2026
**Method:** Live walk-through of `https://qa.fleetsettle.com` at a phone-sized viewport (616×867 CSS px, DPR 2), plus a programmatic audit of tap-target sizes, overflow and focus styles on every screen visited. Screens walked: sign-in, business switcher, Home, Vehicles list, Vehicle overview + Vehicle actions sheet, People, More hub, Quick Add sheet, Reports catalogue, "Who owes us" (receivables table), "How was this month" (chart and table views). No code was changed; everything below is a suggestion with a minimal snippet.

**What already holds up — do not regress these:**
- No horizontal page overflow on any screen visited; `ReportTable` scrolls inside its own box (UI §11.3), the page never does.
- Tap-target floor holds almost everywhere: nav, rows, sheets and CTAs are ≥ 44px. The single exception is finding 1 below.
- Focus rings exist on `Button` (`focus-visible:ring-[3px] ring-focus-ring`); consider extending to raw `<button>` rows (finding 5).
- Colour is never the only signal anywhere observed — every status pairs an icon + a word (`Due`, `Open`, `Voided`).
- Sheet/back behaviour, focus restore and aria-hidden hygiene are already covered by the e2e suite and verified clean.

---

## 1. AlertStrip action link is a 20px-tall tap target (a11y, one-liner)

**Where:** `web/src/components/AlertStrip.tsx:34-40` — seen live on Home's "Paperwork expires soon" strip. Its **View vehicle** link measures ~82×20px. WCAG 2.5.8 minimum is 24px and this project's own floor is 44px (M-1/§4.3). On a moving hand next to a vehicle, 20px of underlined text is genuinely hard to hit.

**Snippet:**

```tsx
// AlertStrip.tsx — replace the action button's className
className="flex min-h-tap shrink-0 items-center -my-2 px-1 text-body-sm font-medium underline underline-offset-2"
```

The negative vertical margin keeps the strip's visual height unchanged while the hit area grows to 44px. No token changes, no spec change — this is the component's own documented intent (§4.3).

## 2. Reports show raw ISO dates and raw period ranges

**Where:** `ReceivablesReportScreen.tsx:38` renders `row.oldestDueOn` verbatim (`2026-04-23`), `FuelEfficiencyReportScreen.tsx:43` renders `row.spentOn` verbatim, and `VehicleMonthReportScreen.tsx` shows `2026-09-01 – 2026-09-30` both as the subtitle and inside the month-picker sheet rows (`:154`). Every other screen in the app (Home's "Due since 23 Apr", `formatShortDate` in 18 files) speaks in "23 Apr 2026" — the reports are the one place the interface suddenly reads like a database.

**Snippet:**

```tsx
// ReceivablesReportScreen.tsx
render: (row) => formatShortDate(row.oldestDueOn),

// VehicleMonthReportScreen.tsx — subtitle and PeriodPickerSheet rows
subtitle={`${formatShortDate(report.period.periodStart)} – ${formatShortDate(report.period.periodEnd)}`}
// picker row:
{formatShortDate(p.periodStart)} – {formatShortDate(p.periodEnd)}
```

`formatShortDate` already exists in 18 features; extracting it once to `web/src/lib/` instead of copying a 19th instance is the better-shaped fix, and each existing copy can be replaced as it is touched.

## 3. Zero-value report rows give no next step

**Where:** "How was this month" renders six vehicle rows of **Rs 0** for the current open period. `Rs 0` is a true answer (M-13 forbids degrading to `NotAvailable`), but a row that says only "NC-1234 — Rs 0" reads as broken on first glance. A one-word caption makes the zero legible.

**Snippet:**

```tsx
// VehicleMonthReportScreen.tsx, VehicleRow — under the profit figure when it is zero
{profit === 0n ? (
  <p className="text-caption text-ink-muted">No activity this month yet</p>
) : null}
```

Same shape applies to the KPI row above the chart: three `Rs 0` tiles are fine once each tile's zero is explained by the row captions below.

## 4. Expandable report rows need a visible disclosure hint

**Where:** In "How was this month"'s table view, tapping a vehicle row reveals Earned/Spent — but the closed row carries no affordance that it expands. The DOM shows the chevron is only present via a rotated icon on the open state; a closed row is indistinguishable from a static list item. This is the classic "hidden interaction" pattern; on a phone nobody taps what doesn't look tappable.

**Snippet:**

```tsx
// VehicleRow's closed state — add a trailing chevron that rotates when open
<ChevronDown
  className={cn("size-4 shrink-0 text-ink-muted transition-transform", open && "rotate-180")}
  aria-hidden
/>
```

(Pair with `aria-expanded={open}` on the row button — the disclosure contract §6's `<Disclosure>` already documents.)

## 5. Keyboard focus is invisible on hand-rolled row buttons

**Where:** `Button`, `Input`, `NativeSelect`, `Checkbox` all carry `focus-visible` rings. The many row-level buttons that don't use `Button` — list rows in Vehicles/People/More, `ActionSheet` items, report rows — have `active:bg-brand-wash` (touch feedback) but no `focus-visible` ring. A keyboard user tabbing the Vehicles list gets no visible position indicator. WCAG 2.4.7/2.2's Focus Appearance asks for exactly this.

**Snippet (one shared class, applied to row-button primitives):**

```css
/* in the design layer, next to the tokens */
.row-button {
  @apply focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset;
}
```

`ring-inset` keeps the ring inside the card border so adjacent rows don't clip it.

## 6. "View as table / View as chart" toggle reads as plain text

**Where:** `ReportScreen.tsx:30-36` — the toggle between chart and table is an underlined-less `text-brand-ink` line. It works, but on a screen whose entire job is "two views of the same numbers", a segmented control communicates the toggle state (which view you're in) rather than just the action.

**Snippet:**

```tsx
<div role="tablist" className="flex rounded-sm border border-line-hairline p-0.5">
  {(["Chart", "Table"] as const).map((label) => (
    <button
      key={label}
      role="tab"
      aria-selected={(label === "Table") === showTable}
      onClick={() => setShowTable(label === "Table")}
      className={cn(
        "min-h-tap flex-1 rounded-sm px-3 text-body-sm",
        (label === "Table") === showTable ? "bg-brand-wash font-medium text-brand-ink" : "text-ink-secondary",
      )}
    >
      {label}
    </button>
  ))}
</div>
```

## 7. Business-switcher strip could state what it does

**Where:** `AppShell`'s business strip shows just "TESTA" with a tiny chevron. For an owner of two businesses this is the single most consequential switcher in the app, and its affordance is a 14px icon. A two-word caption ("TESTA · switch") or the word "Business" as a label costs one line of caption text and removes all ambiguity.

**Snippet:**

```tsx
<span className="text-caption text-ink-muted">Business</span>
<span className="min-w-0 flex-1 truncate text-label font-medium text-ink-primary">{businessName}</span>
```

## 8. Quick Add sheet rows are flat text + icon; the five actions deserve hierarchy

**Where:** The centre `＋` sheet lists Fuel / Expense / Payment received / Payment made / New trip as uniform rows. Given M-4's rationale (muscle memory, ten-second fuel entry), the two money-in rows (Fuel is a cost; Payment received is money in) and the money-out rows could carry the direction marker convention already used by `TwoBalances` (§7.11 step 5) — a 3px leading border in brand/payable — so direction is scannable before reading.

**Snippet:**

```tsx
// ActionSheetAction gains an optional tone; ActionSheet row:
className={cn(
  "flex min-h-tap w-full items-center gap-3 rounded-sm border-l-[3px] px-2",
  tone === "in" && "border-l-brand",
  tone === "out" && "border-l-direction-payable",
  tone === undefined && "border-l-transparent",
)}
```

Words stay as-is (M-15 satisfied); this adds the marker, never replaces the word.

## 9. Vehicle overview's long "Vehicle actions" sheet has no grouping

**Where:** Thirteen actions in one flat list (View calendar … Archive vehicle). The destructive action (Archive vehicle) sits mid-list with no visual separation from "Record expense". M-1's rule is ≥16px spacing when one item is destructive; here it's also about scannability. Two groups — "Do something now" (expense, incident, trip, lease actions) vs "Manage this vehicle" (calendar, paperwork, arrangement, service interval, archive) — with a hairline divider between, and the destructive row last with its own `text-critical-ink` treatment.

**Snippet:**

```tsx
// in VehicleOverviewScreen's ActionSheet list construction — pass actions in two
// groups and render a divider between them; the destructive entry last:
<div role="separator" className="my-1 border-t border-line-hairline" />
// and on the archive row:
className="text-critical-ink"
```

## 10. Loading copy is a bare "Loading…"

**Where:** Several report screens render `<p className="text-body text-ink-muted">Loading…</p>` while `Screen` already provides a stable header. This is fine functionally but is the cheapest-looking moment in an otherwise considered app. The design system already owns `QueryState` (M-28) — pending is one of its four states. Reusing `QueryState`'s pending branch (or a minimal spinner + "Loading who owes us…" naming the read, the way `QueryStateFailure` names the failure) keeps the vocabulary consistent: every read names what it's about.

**Snippet:**

```tsx
) : state.kind !== "ready" ? (
  <p className="text-body text-ink-muted">Loading who owes us…</p>
) : …
```

One word of context per screen; zero new components.

---

## Verification already green (do not repeat)

- 38/38 Playwright e2e pass on this branch, including 360×640 and 320px no-horizontal-scroll on 30+ routes, touch-mode sheet races, and aria-hidden/focus-restore on sheets.
- `npm run check` equivalents were not re-run here (no code changed).

## Suggested order

1, 5, 9 are the only three with real usability risk (tap target, keyboard focus, destructive adjacency) — those first. 2, 4, 7 are one-line polish. 3, 6, 8, 10 are the "looks and feels professional" layer and can ride together.
