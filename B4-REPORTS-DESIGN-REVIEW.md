# B4 Reports Design Deep Review

**Reviewed:** 7 Aug 2026  
**Source:** `B4-REPORTS-DESIGN.md`  
**Reviewer view:** The design is valuable and mostly directionally right, but it is not yet implementation-ready. It should be treated as a gap-discovery and scoping document until the findings below are resolved or explicitly deferred.

## Executive Summary

`B4-REPORTS-DESIGN.md` correctly identifies the real size of B4: this is not just nine report screens. It is Review shell routing, role/capability plumbing, parameter collection, chart infrastructure, report-specific degradation behavior, and several missing backend contracts.

My recommendation is to avoid shipping "nine reports" as the headline unless the owning docs are deliberately updated to bring phase-2 reports forward. The stronger product slice is:

1. Ship the passive owner's 60-second Review experience first.
2. Build the report catalogue and shared reporting infrastructure at the same time.
3. Keep phase-2 or partial reports absent, or label their scope honestly, until their endpoint contracts match their use cases.

The current design catches GAP-41 and the goodwill breakdown gap well. A deeper pass found more contract mismatches, especially around UC-75 cash position and UC-76 lost-day reasons.

## Findings

### F1. B4 Is Really Two Products, Not One

The design uses "Review shell + nine reports" as one item, but those are different product surfaces:

- The **Review shell** is the passive owner's default daily/monthly landing area. It needs to answer "what is my share, what looks wrong, and where is the money?" quickly.
- The **Reports catalogue** is an analytical library. It can contain deeper reports, parameterized views, and table/chart toggles.

This distinction matters because the Review shell can be useful before every analytical report is complete. Treating all nine reports as equally blocking risks delaying the one experience the newly reachable `owner` role needs most.

**Recommendation:** split B4 internally into `B4a Review core` and `B4b Reports catalogue`, even if they remain one Plan.md item. Build shared infrastructure once, but allow the owner home experience to land without pretending every report is complete.

### F2. GAP-41 Is Real, And The Dedicated Endpoint Is The Cleaner Shape

The design is correct that the overheads block cannot be produced today:

- `vehicle-month` is scoped to vehicles.
- `GET /api/expense` treats omitted `vehicleId` as unfiltered.
- The use case says overheads must be shown separately, not spread across vehicles.

Option B in the design, a small dedicated report endpoint, is the better fit. A tri-state `vehicleId` filter is convenient for list browsing, but "overheads for a period" is a report figure. It belongs in the report layer, computed in SQL/domain code, not as a UI-side filtered expense list.

**Recommended contract:**

```ts
GET /api/reports/overheads?periodId=...

{
  period: { id, periodStart, periodEnd },
  overheadsMinor: string
}
```

**Filter semantics:**

- `expense.business_id = businessId`
- `expense.posted_period_id = periodId`
- `expense.vehicle_id IS NULL`
- `expense.borne_by = 'us'`
- `expense.voided_at IS NULL`

This mirrors `sumVehicleCostsForPeriod` while keeping vehicle-month honest.

### F3. UC-75 Cash Position Is Arithmetically Partly There, But Narratively Incomplete

The design says UC-75 should show partner-held cash plus deposits. That matches the current endpoint, but not the full use case.

The use case says UC-75 includes:

- what each partner is holding
- what is in each account
- what is out with drivers as advances
- deposits held as a liability

The current endpoint returns:

- `partners[]`
- `depositsHeldMinor`

Open driver advances do affect the partner-held number because `listPartnerCashPositions` subtracts open advances from the issuing partner's held cash. But they are not separately visible as "money out with drivers." That means the arithmetic partially accounts for advances, while the report still does not answer the user's "where is the money?" question.

Account-level cash is also not represented. `banking_event.destination` exists and is listable through partner banking events, but `cash-position` does not group current account/bank holdings by destination.

**Risk:** A user can see "partner holds Rs X" and "deposits held Rs Y" but cannot distinguish cash banked into accounts from cash advanced to drivers. That weakens the exact use case UC-75 exists for.

**Recommendation:** add a Track A gap for UC-75 completeness. Either extend `cash-position` or add a companion endpoint.

Possible shape:

```ts
{
  partners: [{ userId, displayName, heldMinor }],
  banked: [{ destination, heldMinor }],
  driverAdvances: [{ driverId, driverName, outstandingMinor }],
  depositsHeldMinor: string
}
```

If that is too large for B4, ship the existing endpoint but title the screen narrowly, such as "Partner cash held," not "Where is our cash."

### F4. UC-76 Lost Days Lacks Reason Breakdown

The design catches weekday distribution but misses one use-case promise: UC-76 says lost days are shown "with reasons and weekday distribution."

The current report contract supports:

- driver
- weekday
- lost count
- ran count
- leaseEligible denominator
- lostValueMinor

It does not return `lostReason`, reason labels, or any reason aggregation.

This is not just decoration. The use case distinguishes "four days lost" from patterns that explain why. Weekday distribution catches "Fridays are bad"; reason distribution catches "breakdowns vs no passengers vs driver unavailable."

**Recommendation:** add a Track A gap for lost-day reason aggregation.

Possible shape:

```ts
{
  rows: LostDaysRow[],
  reasons: [
    {
      driverId: string,
      reason: LostReason,
      lost: number,
      lostValueMinor: string
    }
  ]
}
```

Alternative: return one row per `driverId + weekday + reason`, but that makes the client rebuild too many views from a dense cube. A separate `reasons` array is easier to render and test.

Until this lands, the B4 screen should not claim to be the full UC-76 report.

### F5. UC-77 Goodwill Is Total-Only Today

The design correctly identifies this. The current shared schema is:

```ts
{ totalMinor: string }
```

The UI spec asks for "Single number + table by reason." Current query logic sums matching adjustment rows and does no grouping.

**Recommendation:** add a tracked gap before B4 implementation. I would group by `adjustment_type` first, not free-text `reason`, because free-text reason values will be messy and sparse.

Possible first contract:

```ts
{
  totalMinor: string,
  byType: [
    { adjustmentType: "waiver" | "auto_waiver" | "goodwill", totalMinor: string }
  ]
}
```

A later version can add top free-text reasons if product really needs them.

### F6. UC-79 Utilisation Does Not Yet Fulfil Its Own Purpose

The day-count part exists and is tested:

- earningDays
- idleDays
- offRoadDays
- totalDays

But the use case says the report exists to compare revenue per available day across arrangements. The schema explicitly says `revenuePerAvailableDayMinor` is not built this pass.

**Recommendation:** do not foreground UC-79 in the catalogue unless the product accepts a partial "day mix only" report. If it ships now, the title should stay close to the data, for example "Days earning vs idle," not "How hard is each vehicle working" with copy implying revenue comparison.

### F7. Phase Mismatch Needs An Owning-Docs Decision

The design says B4 builds nine reports. The owning docs still mark UC-77, UC-78, and UC-79 as phase Second. UC-73 is excluded because it is phase Second and has no endpoint, but UC-77/78/79 are included because the backend exists.

Backend existence is not the same as phase ownership. This is especially visible for UC-77 and UC-79, where the backend exists but does not fully satisfy the use case.

**Recommendation:** decide one of these explicitly:

1. Bring UC-77, UC-78, and UC-79 forward in the owning docs.
2. Rename B4 to "Review shell + phase-1 reports" and keep phase-2 report cards absent.
3. Ship phase-2 report cards as partial previews with explicit scope.

My preference is option 2.

### F8. "My Money" Is More Buildable Than The Design Implies

The design treats the `My money` tab as inference. It is still not wireframed, but the data source is stronger than the doc suggests.

`GET /api/partner/{userId}` already returns:

- current open period
- put in: contributions and out-of-pocket
- taken out: payouts and settlements
- earned: profit share and management fee for the open period
- holdingMinor

That is a good basis for the passive owner's `My money` tab. It should probably be the read-only partner summary, scoped to the signed-in user.

**Open issue:** `/api/me` currently returns `userId`, so the client can call `/api/partner/{userId}`. But this route is gated by `managePartnerCapital`, which is owners-only. That works for `owner` and `owner_manager`; it does not work for `manager`, which is fine because managers should not have a Review `My money` tab.

**Recommendation:** define `My money` as a read-only partner summary in the design, rather than leaving it as unresolved inference. Add a product caveat that the values mix all-time totals with current-period earned, exactly as the partner summary schema states.

### F9. "What I'm Owed" Is Probably Not A Receivable

The design is right that "What I'm owed" has no obvious source in the report endpoints. Based on existing contracts, the closest honest candidates are:

- `partnerSummary.earned.profitShareMinor` for the open period
- `partnerSummary.earned.profitShareMinor + managementFeeMinor - takenOut.payoutsMinor` if the product means unpaid earnings
- `partnerSummary.holdingMinor` if the product means cash currently held by that partner, though that is not "owed"

The phrase is dangerous because it can imply a legal receivable from the business to the partner, but the schema appears to model partner current accounts through contributions, payouts, settlements, earned share, and holding, not a simple obligation owed to the partner.

**Recommendation:** rename the UI block once the source is chosen. Safer labels:

- "My share this period"
- "Still to settle"
- "Cash I am holding"

Do not keep "What I'm owed" unless there is a precise formula.

### F10. Review Vehicle Detail Should Not Reuse Operate Detail Unmodified

The design leaves open whether Review vehicle cards navigate to `VehicleOverviewScreen` or a read-only variant.

I would not reuse `VehicleOverviewScreen` directly unless B0b capability gating fully strips every write/action affordance. The Review shell's core promise is no entry affordances. The existing vehicle overview is operational: it has actions, costs, incidents, history, document upserts, and navigation paths into write flows.

**Recommendation:** build a read-only `ReviewVehicleScreen` or wrap shared display sections in a Review-specific container. Reuse data-fetching and display components, not the entire Operate screen.

### F11. Warning Strips Need Their Own Rule, Not Just N+1 Fetches

The insurance warning in the wireframe can be sourced from vehicle documents, but the design should define:

- which document types count
- warning threshold, for example 30 days before expiry
- sorting when multiple warnings exist
- behavior when a document is already expired
- whether warnings appear per vehicle card, top-level, or both

For a small fleet, per-vehicle document fetches are acceptable. The bigger issue is semantic consistency: warnings must not become an unbounded feed.

**Recommendation:** define a small warning selector for Review:

```ts
selectVehicleWarnings(vehicle, documents, today): ReviewWarning[]
```

Test it separately from rendering.

### F12. Parameter Defaults Should Be Consistent Across Reports

The design suggests current period for UC-76/77 and 90 days for UC-72. That is sensible, but it should be formalized because parameter defaults shape the perceived usefulness of the catalogue.

Recommended defaults:

- UC-70: open accounting period.
- UC-72: last 90 days ending today, unless the current period is longer.
- UC-76: open accounting period.
- UC-77: current calendar/accounting year is tempting from the use case, but current accounting period is more consistent with B4. This needs a product call.
- UC-78: today.
- UC-79: open accounting period.

Also validate `from <= to` at route-search parsing and render an inline parameter error before fetching.

### F13. URL State Should Own Viewed Report Parameters

Inline expansion in the catalogue is good as an interaction, but viewed reports should be linkable and refresh-stable.

Recommended behavior:

- `/reports` shows the catalogue.
- Parameterized card expands inline to collect fields.
- "View" navigates to `/reports/:key?...`.
- `/reports/:key` validates search params.
- Missing params render the same parameter form on the detail screen.

This avoids a dead detail route and makes reports shareable between partners.

### F14. The Report Catalogue Needs Empty-State Rules

Several reports can validly return empty arrays:

- no trips
- no receivables
- no fuel fills
- no lost days
- no ageing rows

Not every empty state is `NotAvailable`. Some are true zero/none states:

- no receivables means "No one currently owes us."
- no closed trips means "No closed trips yet."
- no fuel pairs means `NotAvailable`, because the metric cannot be computed.
- no lost-day rows may mean no daily-lease days in the window, not necessarily no loss.

**Recommendation:** define empty/degraded copy per report. Avoid using `NotAvailable` as a generic empty state.

### F15. Chart Choice For Cash Position Needs Care

The design proposes a stacked bar of partner held segments plus deposits held. I agree with visual separation, but a single stacked bar can still imply all segments are the same category.

Better options:

- two adjacent bars: "Cash held" and "Liabilities held"
- partner held cards plus a separate liability band
- a waterfall-like presentation if banked/advances are added later

**Recommendation:** avoid stacking deposits inside the same bar as partner-held cash unless the styling makes liability unmistakable.

### F16. Reports Should Not Depend On Raw Enum Display

The design already says party type should not render as raw enum text. Extend that rule to:

- `adjustmentType`
- `lostReason`
- ageing bucket labels
- document types
- vehicle arrangement labels

**Recommendation:** add small label maps in report UI, colocated with the feature or in shared lib if already established elsewhere.

### F17. Manager Visibility Is Still Unsafe Without GAP-1

The design acknowledges GAP-1. This should be elevated from an open question to a B4 acceptance constraint.

Because `viewReports` is business-wide today, a manager sees all reports, not just shared vehicles. The UI cannot fix this with card hiding because the endpoints themselves are unscoped.

**Recommendation:** B4's done criteria should say:

> Until GAP-1 lands, B4 must not claim per-vehicle manager scoping anywhere. Production use with real managers remains guarded by the existing operational warning.

### F18. Table View Should Be The Primitive, Not An Afterthought

Every chart needing a table view is correct, but the implementation should invert the dependency: build normalized report table data first, then chart from it.

Recommended shared primitive:

```ts
interface ReportTableColumn<Row> {
  key: string;
  header: string;
  align?: "start" | "end";
  render: (row: Row) => React.ReactNode;
}
```

Then each report defines:

- raw response to view model
- table columns
- chart marks

This makes table fallback cheap and keeps chart components from owning business formatting.

### F19. Money Axis Conversion Needs Domain-Specific Tests

The design says one money-to-axis function. Add tests for:

- positive money
- zero
- negative profit
- large values that exceed safe integer range
- mixed sign chart domains

If values can exceed `Number.MAX_SAFE_INTEGER`, the function should either scale first as bigint or throw with a controlled error. Silent `Number(bigint)` conversion is exactly the failure this boundary is supposed to contain.

### F20. Date And Time Semantics Need A Small Rule

The app already uses business dates, not device clock timestamps. B4 should avoid `new Date()` for report defaults except through existing business-date helpers.

Rules:

- `today` comes from `businessToday()` or route-provided `today`.
- report query params are `YYYY-MM-DD`.
- display formatting uses fixed business-date parsing, not timezone-sensitive bare `new Date(date)`.

This is especially important for UC-78 ageing and first-period delta.

## Report-By-Report Assessment

| Report | Buildability | My view |
|---|---|---|
| UC-70 vehicle-month | Mostly buildable, blocked by overheads for Review home | Core B4. Build first. |
| UC-71 trips | Buildable | Good catalogue report, not owner-home critical. |
| UC-72 fuel efficiency | Buildable with sparse/degraded states | Useful but should be quiet when data is insufficient. |
| UC-74 receivables | Buildable | Core B4. Table-first. |
| UC-75 cash position | Partial | Needs gap or narrower UI label. |
| UC-76 lost days | Partial | Needs reason breakdown for full use case. |
| UC-77 goodwill | Partial | Needs grouped breakdown before full screen. |
| UC-78 ageing | Buildable, but phase mismatch | Include only if owning docs bring it forward. |
| UC-79 utilisation | Partial and phase mismatch | Do not imply revenue comparison. |

## Recommended B4 Scope

### B4a: Review Core

Build:

- Review shell routing for `owner`.
- Operate `/more` entries for Reports and My share where applicable.
- `This month` tab using `vehicle-month`.
- overheads block after GAP-41.
- read-only vehicle performance list.
- `My money` from partner summary.
- receivables summary.
- honest cash/lost-day summaries based on available contracts.

Do not build:

- owner-visible write paths
- full analytical desktop dashboard
- phase-2 reports unless docs are updated

### B4b: Reports Catalogue

Build:

- `/reports` catalogue.
- shared report wrapper.
- URL-backed parameter state.
- chart/table toggle primitive.
- UC-71, UC-72, UC-74.
- UC-70 detail view if the period picker is ready.

Defer or ship partial only with explicit labels:

- UC-75 until cash completeness is decided.
- UC-76 until reason breakdown exists.
- UC-77 until breakdown exists.
- UC-78 until phase decision.
- UC-79 until phase/revenue decision.

## Proposed Gap List

### GAP-B4-1: Overheads Report Endpoint

Existing GAP-41. Prefer a dedicated `/api/reports/overheads` endpoint.

### GAP-B4-2: Goodwill Breakdown

Extend goodwill report beyond `{ totalMinor }`, probably grouped by `adjustmentType` first.

### GAP-B4-3: Cash Position Completeness

Expose account-level cash and driver advances separately, or rename the B4 screen to match the current narrower contract.

### GAP-B4-4: Lost-Day Reason Breakdown

Expose lost-day reason aggregation for UC-76.

### GAP-B4-5: Report Phase Alignment

Resolve whether UC-77/78/79 are phase First for UI purposes or remain phase Second.

### GAP-B4-6: Partner Settlement Formula

Define the exact meaning of "What I'm owed" before wiring it.

## Test Recommendations

Add frontend tests for:

- an owner reaches Review instead of `NotBuiltYetScreen`
- a driver cannot reach `/reports`
- a manager cannot see owner-only report cards
- parameterized report routes validate missing/invalid params
- chosen params survive URL refresh
- each chart screen has a table view
- `NotAvailable` appears for missing metrics, not for true zero states
- nullable party/driver/partner names render one consistent fallback
- first accounting period renders no delta rather than `0%`
- negative profit renders correctly in bars and tables
- cash-position UI does not visually merge deposits with owned cash

Add backend tests if the gaps are closed:

- overheads excludes vehicle expenses and non-`us` expenses
- goodwill breakdown groups only waiver/auto-waiver/goodwill
- lost-day reasons exclude `paused_for_trip` and off-pattern days
- cash-position exposes driver advances separately from partner-held cash

## Final Recommendation

Keep the original design, but amend it before implementation:

1. Fix the factual corrections around parameter count and ageing implementation.
2. Add the UC-75 and UC-76 gaps.
3. Resolve phase ownership for UC-77/78/79.
4. Define `My money` and "What I'm owed" using partner summary semantics.
5. Make report detail parameters URL-backed.

My preferred product cut is still: ship the passive owner's 60-second Review experience first, then grow the analytical catalogue as the remaining report contracts become complete. That gives the newly reachable `owner` role real value without letting attractive charts overstate what the backend can currently prove.
