# B4 · Review shell + reports — design

**Status:** design only, nothing implemented or changed by this document. Not a `docs/` edit — it doesn't carry a version bump or absorb into the seven owning documents; if the design below is accepted, the actual behaviour still needs to land there first (`CLAUDE.md`: "the owning document decides"). This file exists so B4 can start from a screen-by-screen plan instead of being scoped while being built.

**Written:** 7 Aug 2026, against `main`/`build/p0-foundation` as it stands today (Worker complete through P13, `docs/` at the versions in `docs/README.md`'s status table).

**Revised:** 7 Aug 2026 — second edition. Absorbs `B4-REPORTS-DESIGN-REVIEW.md` and a verification pass that read every report's query, schema, route-def and owning-document row rather than trusting either document. The pass **corrected four factual claims in the first edition, found seven things neither document had, and declined three of the review's recommendations** because they contradict an owning document or duplicate a rule the Worker already implements. §12 records the declines; §13 the revision log. The headline changed from "nine reports" to "reports" for the reason in §9.1.

**Eleven decisions taken 7 Aug 2026** — three of scope, eight closing this edition's open questions. **Nothing in §11 is blocking any more.** The sections below reflect all eleven:

| # | Decision | Where |
|---|---|---|
| 1 | **B4 builds the phase-1 six only** — UC-70, 71, 72, 74, 75, 76 | §9.1 |
| 2 | **"What I'm owed" keeps its label and is UC-67's all-time balance** — needs GAP-74 | §5.4 |
| 3 | **UC-75 ships as "Cash partners are holding"** in Wave 1, reverts in Wave 2 | §5.3 |
| 4 | **The goodwill defect is two defects, not one** — a wrong comparison (GAP-72) and a wrong date basis (GAP-73), fixed separately | §8.3 |
| 5 | **`Vehicles` tab is one vehicle × all periods**, not a second fleet list | §5.5 |
| 6 | **Driver-licence warnings do not appear on the Review shell** | §5.4 |
| 7 | **The ageing JS/SQL deviation is recorded in DM §15, not rewritten** | §11 |
| 8 | **Nullable names fall back to the party type** — "Unnamed driver" | §6 |
| 9 | **The first period's delta line is omitted**, not `NotAvailable` | §5.4 |
| 10 | **The owner-manager's More → My share ships in Wave 1** | §9.2 |
| 11 | **Desktop is out** — responsive where free, nothing from §14 | §14 |

Decisions 4 and 10 **add** work; the rest shrink it or cost nothing.

---

## 1. What GAP-41 → B4 actually is

Two different things, chained:

**B4** (`Plan.md` item 12, Track B) is "Review shell + nine reports" — the entire interface for the passive owner partner, who is `CLAUDE.md`'s second partner and reads rather than enters. Backend-complete (nine tested endpoints under `/api/reports/*`, shipped through P11), zero screens. `FirstRunGate` sends the `owner` role straight to `NotBuiltYetScreen` today (`web/src/features/setup/FirstRunGate.tsx:115`). It is the largest item left on either track.

**GAP-41** is one piece of B4 that is *not* backend-complete: §7.8's wireframe has an "Overheads (no vehicle)" block, and no endpoint can produce that number. `GET /api/reports/vehicle-month` is per-vehicle only; `GET /api/expense`'s `vehicleId` filter is optional-means-unfiltered (`filters.vehicleId !== undefined ? eq(...) : undefined`, confirmed still true at `api/src/queries/expense.ts:223`). Omitting the filter returns *every* expense, vehicle-attributed ones included, so there is no way today to ask "expenses with no vehicle at all." W-32 (an overhead is never spread across vehicles) makes that block load-bearing, not optional — so it can't be quietly dropped from the screen either.

**It is no longer the only one.** The verification pass found that GAP-41 is one of **five** places where a report's contract cannot produce the screen its own owning document specifies, and that **two of those five are phase-1 reports** — UC-75 and UC-76 — not phase-2 extras. §7 and §8 carry them. That is the single biggest change between this edition and the first.

**Sequencing today:** A11 (member/driver access) shipped 7 Aug and is what makes B4 matter now — an `owner` can get a real account and has nowhere to land. B4 additionally needs **B0b** (three shells + the capability gate — `RootLayout` currently hardcodes `shell="operate"` and `FirstRunGate` has only one render branch) and the Track A increments in §7. This document assumes B0b lands first, per `Plan.md`'s stated order (A12 → B0b → B3 → B4/B5 → A10 → A13).

---

## 2. What's already true and doesn't need designing

- All nine report endpoints exist, are capability-gated, and are integration-tested (`api/tests/integration/reports.test.ts`): happy path, empty/degraded cases, 401/403, and cross-business 404 for the two that take a `vehicleId`.
- Two capability tiers already exist and are enforced server-side: `viewReports` (STAFF: owner, owner_manager, manager) covers seven reports; `viewOwnerOnlyReports` (OWNERS: owner, owner_manager) covers UC-77 (goodwill) and UC-79 (utilisation). `api/src/auth/policy.ts:49-50`.
- `AppShell` already renders `shell="review"` with `REVIEW_TABS` (`month`, `vehicles`, `money`, `reports` — `web/src/design/primitives/AppShell.tsx:22-27`) and `shell="mine"` with no tab bar. Both are tested. Nothing routes to either yet.
- Routes are shared across shells by design (UI §3.3: "the shell decides which are reachable, the server decides which are permitted"). `/reports` and `/reports/:key` are not Review-only — `owner_manager`/`manager` reach the *same* routes from Operate's `/more` hub, which is why `MoreScreen.tsx`'s doc comment already says "Reports appears when B4 lands".
- Money codec (`packages/shared/src/money.ts`), `Money` component, `NotAvailable` component, `EntityPicker`, and the `cn.ts` tailwind-merge extension pattern are all built and reusable as-is.
- **`GET /api/home/paperwork-warnings` already exists and already does what §7.8's warning strip needs.** See §5.4 — this replaces the first edition's proposal and the review's F11, both of which would have rebuilt a rule the Worker already owns.
- **`GET /api/partner/{userId}` (A2) is a complete, composed partner summary** — `putIn`, `takenOut`, `earned` (scoped to the named open period), `holdingMinor`. It is the `My money` tab's data source, not an inference. See §5.6.

## 3. What doesn't exist and B4 has to build

- Any route past `/more` — `/reports`, `/reports/:key`, and whatever `month`/`vehicles`/`money` resolve to.
- The chart palette as tokens (§11.2 is eight raw hex pairs today, and raw hex is forbidden everywhere else in this codebase).
- Any chart library in the client at all (`package.json` has no `recharts`; §11 promises it's "lazy, Reports chunk only").
- A money → chart-axis conversion, isolated and tested the way the money codec itself is (`web/CLAUDE.md`: "never a `number`, not even for a chart axis").
- A normalised report view-model + table primitive, built *before* the charts rather than after (§6).
- `lib/capabilities.ts` / `<Can>` (B0b's job, but B4 is one of its two first callers, so this document treats it as a hard dependency, not a nice-to-have).

---

## 4. Information architecture

```
/reports                        catalogue — six cards
/reports/vehicle-month?periodId=…                  UC-70
/reports/trips                                     UC-71
/reports/fuel-efficiency?vehicleId=…&from=…&to=…   UC-72
/reports/receivables                               UC-74
/reports/cash-position                             UC-75
/reports/lost-days?from=…&to=…                     UC-76

                                — not in B4, phase 2 (§9.1) —
/reports/goodwill?from=…&to=…                      UC-77  owner-only
/reports/ageing?asOfDate=…                         UC-78
/reports/utilisation?vehicleId=…&from=…&to=…       UC-79  owner-only
```

The three phase-2 routes are listed only so the `:key` scheme is visibly complete; **B4 registers no route for them.** A route that exists but has no card is a URL someone eventually finds.

`:key` is the report's own short name (`vehicle-month`, `trips`, …) — matching the endpoint path 1:1 keeps the mapping obvious and avoids a second naming scheme.

**Parameters live in the URL, not only in component state** (adopted from review F13). A report someone is looking at should survive a refresh and be sendable to the other partner — two partners arguing about a number is the exact situation this product exists for, and "look at this month's ageing" should be a link. Concretely:

- `/reports` renders the catalogue.
- A parameterised card expands in place to collect its fields (§5.2).
- "View" **navigates** to `/reports/:key?…` rather than rendering in the catalogue.
- `/reports/:key` validates its search params and renders the same parameter form when they're missing or invalid, so the route is never dead and a hand-edited URL fails visibly rather than silently fetching something else.
- `from > to` is caught at search-param parsing and rendered as an inline parameter error, before any fetch.

**Two independent entry points reach the same routes:**

| Entry point | Who | What it renders |
|---|---|---|
| Review shell's own **Reports** tab | `owner` | The catalogue, `/reports` |
| Operate's `/more` → **Reports** row | `owner_manager`, `manager` | The same catalogue, same route |

The catalogue itself doesn't need to know which shell it's rendered under — `<Can>` already decides per-card visibility from the role, which is shell-independent.

**Review shell's other three tabs are a separate concern from the catalogue.** Only `month` has a wireframe (§7.8); `vehicles` and `money` are named in the tab list (`This month · Vehicles · My money · Reports`) with no further spec. §5.4–5.6 design all three, flagged where it's inference rather than citation.

---

## 5. Screen designs

### 5.1 `/reports` — the catalogue

A list of cards, one per report, each showing the title (UC's own name, not its number) and a one-line description. A card that needs no parameters navigates straight to `/reports/:key`; a card that needs parameters expands first.

```
┌────────────────────────────────────┐
│ Reports                             │
├────────────────────────────────────┤
│ How was this month              ›  │
│ Which trips made money          ›  │
│ Is the bus drinking fuel        ›  │
│ Who owes us                     ›  │
│ Cash partners are holding        ›  │
│ Lost days                        ›  │
└────────────────────────────────────┘
```

**Six cards, no owner-only section.** That is the phase-1 set (§9.1), and the absence of a divider is a consequence worth stating rather than discovering: UC-77 and UC-79 are the only two owner-only reports and *both* are phase 2, so **every card in B4's catalogue is gated by `viewReports` alone.** See §9.3 for what that does to the capability plumbing.

**Every card is still wrapped in `<Can cap="viewReports">`.** `<Can>` renders `null`, not a disabled card — matching its contract from UI §12.4 ("never renders a disabled child") and avoiding a 403 the user could have been spared. The wrapper stays even though all six share one capability, because the moment UC-77 or UC-79 arrives the pattern must already be the one in use, not retrofitted around a card that was special-cased in.

UC-73 ("the year") is **not a card.** It's GAP-18, phase Second, and has no endpoint. Its own row in §11.1's table exists in the spec but FL §9.2 already tags it phase 2 — this is the one case where the omission was already agreed before this pass.

### 5.2 Parameter collection

**Three of B4's six** need something the catalogue link alone can't supply:

| Report | Needs | Source | Default |
|---|---|---|---|
| UC-70 vehicle-month | `periodId` (+ optional `vehicleId`) | `GET /api/accounting-period`, newest first | the open period |
| UC-72 fuel-efficiency | `vehicleId`, `from`, `to` | `EntityPicker` (vehicles) + date range | last 90 days ending today |
| UC-76 lost-days | `from`, `to` | date range | the open period |

UC-71, UC-74 and UC-75 are parameterless and navigate straight through.

**The first edition's count was wrong and `Plan.md`'s still is**, recorded because the fix outlives the phase decision. Both say "four of the nine cannot be fetched from a bare catalogue link"; both then list **six** — UC-70, 72, 76, 77, 78, 79. Whenever the phase-2 three land, six is the number, and `Plan.md` needs the one-word fix regardless of B4's scope.

`periodId`'s picker defaults to the currently-open period (the row with `status: "open"` from `GET /api/accounting-period`), so UC-70 is zero-parameter in practice. The same query feeds §7.8's `July 2026 ▾` picker — one fetch for both.

**When UC-77 lands, its window is a year, and that is not a judgement call.** Recorded here rather than lost with the card. The first edition and review F12 both treated it as an open product question leaning toward "current accounting period". UC-77's own first line is "**Per year**: every waiver and adjustment you chose to give", and §6.11's stated reason is that small waivers are "invisible individually and material in aggregate" — a one-month goodwill total defeats the report's entire purpose. The owning document already decided. (Which makes §8.3's date-window bug worse, not better: a year-long window is a year of `created_at` comparisons.)

**Every default resolves through the business-date helper, never `new Date()`** (adopted from review F20). `today` is `Asia/Colombo`'s today, query params are `YYYY-MM-DD`, and display formatting parses a business date explicitly rather than handing a bare string to `new Date()`. This is CLAUDE.md's Time section applied to a feature that is almost entirely date-windowed, and §7's goodwill bug is what it looks like when it slips.

### 5.3 The report screens

All share one shell: title, the parameters used (shown as a small subtitle — "1 Jun – 30 Jun 2026"), the primary visual (§11.1's form), and a table-view toggle. Below is what each needs from its endpoint and what its degradation looks like.

**UC-70 · How was this month** — `vehicle-month`
KPI row (earned / spent / profit, combined across returned vehicles) + one horizontal bar per vehicle (`profitMinor`, direct-labelled — vehicle registrations don't fit a vertical column at 360px, §11.3). Each vehicle row expands to its `ownerShares` breakdown. Never degrades (UC-70's own text: "always computable"). **Note the catalogue screen and the `This month` tab are not the same screen** — §11.1's UC-70 form has no overheads block; §7.8's Review tab does. GAP-41 blocks the tab, not this card.

**UC-71 · Which trips made money** — `trips`
Horizontal bar, ranked by `profitMinor`, direct-labelled with `registration`. `profitPerKm` renders beside each bar as a secondary figure, `NotAvailable` (reason: "no closing odometer") for any trip where `distanceKm` is `null` — and that trip is **excluded from any per-km ranking**, though it still appears in the profit-ranked list. Two rankings live in one screen; the profit bar order never changes based on which trips have km data.

**UC-72 · Is the bus drinking fuel** — `fuel-efficiency`
Line, single series, `kmPerLitre` over `spentOn`. Points with `kmPerLitre: null` (the first fill in the window, or any fill with no paired reading) render as gaps in the line, not zero-height — §11.4's "never a zero-height bar for missing data" applied to a line's point. A window with zero complete fill-to-fill pairs shows `NotAvailable` for the whole chart rather than an empty axis (UC-72: "a month with no complete fill-to-fill pair shows nothing at all").

**UC-74 · Who owes us** — `receivables`
**Table**, not a chart — §11.1 is explicit this is a work list the reader acts on. Columns: party (name, via the shared `<PartyName>` fallback — §6), type (customer/driver/partner as a label from a map, never raw enum text), outstanding amount, oldest due date. Sorted largest-outstanding first. An empty response is **"No one owes us anything"**, not `NotAvailable` — see §6's empty-vs-unknown rule.

**UC-75 · Cash partners are holding** — `cash-position`
Stat tiles per partner (`heldMinor`), plus a stacked bar of held-vs-ours below, with `depositsHeldMinor` as a visually distinct segment captioned as a liability — never netted into the partner figures (§6.13, W-2's sibling rule for cash rather than driver balances). **This is UI §11.1's specified form, kept deliberately** — review F15 proposed replacing the stacked bar with two adjacent bars, which §12 declines and explains.

**Decided: the screen ships in Wave 1 under the narrower title, and is completed in Wave 2.** It cannot be called "Where is our cash" as the contract stands — §8.1 shows banked cash leaving the partner figure and appearing in no field of the response, so what the endpoint answers is "what is in each partner's pocket". The narrow title is true; the specified one would not be, and an unqualified "where is our cash" over a figure that omits every banked rupee is exactly the confident-wrong-number failure W-56 exists to prevent. It reverts to UC-75's own title in the same change that lands the `banked` and `driverAdvances` arrays — **the title is the thing that must not ship ahead of the data**, which is why it is called out here rather than left to copy review.

**UC-76 · Lost days** — `lost-days`
Column per month (aggregating `LostDaysRow` rows, which arrive per driver per weekday — the client sums across weekdays for the monthly column and keeps the weekday breakdown as a second, smaller chart per §11.1). The denominator shown alongside is `leaseEligible` (`ran + lost`), never recomputed — the endpoint returns it as its own field specifically so the client doesn't reinvent §1.2's exclusion logic. `lostValueMinor` shows as a secondary figure per driver, never summed into one business-wide number (a lost day's value is driver-specific).

**The reason breakdown UC-76 requires cannot be built** — see §8.2. Until it lands, this screen ships count + value + weekday only, and is not the full UC-76.

---

**The three below are not in B4** (§9.1). Their designs are kept because the analysis behind them is what the phase decision was made *on*, and because whichever item picks them up should not re-derive it.

**UC-77 · Goodwill given** — `goodwill` *(not in B4 — phase 2)*
Single number (`totalMinor`) as a hero figure, captioned with the window. **The "table by reason" §11.1 asks for cannot be built from the current endpoint, and the total it does return is wrong at the window edges** — see §8.3. That bug is a live defect in shipped code and stays on Track A regardless of when this screen lands; it is the one §8 finding that does not wait for its screen.

**UC-78 · Who is overdue, and by how long** — `ageing` *(not in B4 — phase 2)*
Horizontal stacked bar of the five buckets (`current`, `1-30`, `31-60`, `61-90`, `over-90`), each segment sized by summed `outstandingMinor`, using the categorical palette in bucket order. Table beneath with the same rows `receivables` shows plus the `bucket` column. As-of date defaults to today; **changing it re-fetches rather than re-bucketing in the browser.**

The first edition justified that re-fetch by saying bucketing "happens in SQL against the real `effective_due_on`, never client-side". **That is wrong about the implementation.** DM §15 does specify a SQL `CASE` expression, but `listAgeingBuckets` (`api/src/queries/reports.ts`) selects raw obligation rows and buckets them in a JavaScript loop with `Date.parse`. The conclusion survives — bucketing is server-side, and the client must never do it — but the reason is not the one given, and the DM-versus-implementation divergence is recorded in DM §15 rather than rewritten (§11 item 3). The JS arithmetic is correct today (both operands are bare date strings, so both parse to UTC midnight and the day difference is exact), which is precisely why it will not announce itself if someone later passes a timestamp.

**UC-79 · How hard is each vehicle working** — `utilisation` *(not in B4 — phase 2)*
Stacked bar, three segments (`earningDays`, `idleDays`, `offRoadDays`) out of `totalDays`.

**The endpoint returns one vehicle per call.** `utilisationResponseSchema` is `{ vehicleId, from, to, …dayCounts }` and `vehicleWindowQuery` requires `vehicleId`. The first edition's §5.3 said "one bar per vehicle in scope", contradicting its own §5.2 row (which correctly routes this through `EntityPicker`). So the screen is either single-vehicle, matching the endpoint and the picker, or the client fans out one call per vehicle. UI §11.1 says "Stacked bar of earning / idle / off-road **per vehicle**", and comparison across vehicles is what the report is for — which argues for the fan-out (three calls at this fleet size is nothing) rather than a picker that shows one vehicle at a time. Deferred with the screen (§11 item 5).

The comparison UC-79's text says this report *exists to enable* — "revenue per available day," the honest way to compare a daily-lease vehicle against a charter vehicle — **is not returned.** `utilisationResponseSchema`'s own comment says so: `revenuePerAvailableDayMinor` "is not built this pass… recorded in TRACKER.md" (GAP-19). Render the day-count breakdown only; do not draw an axis, a stat tile, or a caption implying the revenue comparison exists. Per review F6, if this ships at all the title should stay close to the data — **"Days earning, idle and off the road"** rather than a title implying the comparison.

### 5.4 Review shell · `This month` tab

The only tab with a citable wireframe (§7.8). Composition, mapped to real endpoints:

- **Hero** ("My share this month," `▲ 12% vs June`): two `vehicle-month` fetches — current `periodId` and the previous period's id — summed across `ownerShares` for the signed-in user, then a percentage delta. The delta is a `number` derived from two `bigint`s, computed in exactly one place with the same explicit-lint-disable treatment `profitPerKm`/`kmPerLitre` get server-side — the first *client-side* instance of that pattern.

  **On a business's first accounting period the delta line is omitted entirely, not rendered as `NotAvailable`.** Decided 7 Aug 2026, and it follows §6's own empty-versus-unknown rule applied to itself: a first period has no predecessor as a matter of *fact*, not of data quality. Nothing is missing, so `NotAvailable` would imply something failed to compute. Same category as "No closed trips yet" — the hero figure stands alone and the comparison simply isn't there yet.

- **Per-vehicle cards**: one `vehicle-month` row each, showing `earnedMinor`, `costsMinor` (as "Spent"), and the signed-in user's own `profitShareMinor`. Tapping navigates to a **read-only Review vehicle screen, not `VehicleOverviewScreen`** (adopted from review F10). §7.8's own rule is "no entry affordance anywhere," and the Operate screen is built the other way round — actions menu, cost entry, incident reporting, document upsert, navigation into write flows. Gating each of those individually is a list you can forget an item from; a separate container that composes the display sections is a boundary you cannot. Reuse the data hooks and the presentational sections; do not reuse the screen.

- **Warning strip** (`⚠ Insurance expires in 21 days`): **`GET /api/home/paperwork-warnings`, one business-wide call.** The first edition proposed N+1 per-vehicle `GET /api/vehicle/{id}/document` fetches; review F11 proposed a client-side `selectVehicleWarnings(vehicle, documents, today)` with the threshold, doc types and sort defined in the client. **Both are wrong** — the endpoint already exists, already applies F-10.1's 30-day window, already keeps warning past expiry (`isExpired` is a returned field, not a client derivation), and already computes `today` from the business timezone via `businessToday(requireBusinessTimezone(c))`. A client-side selector would be a second implementation of one rule, which CLAUDE.md forbids for exactly the reason it gives: two implementations diverge. The response is `{ subjectType, subjectId, subjectLabel, docType, expiryDate, isExpired }[]`.

  The handler gates on `dailyOperations` (STAFF), which **includes `owner`**, so the passive owner can call it — semantically odd for a capability named for daily operations, but correct today and not B4's to change.

  **The strip filters to `subjectType === "vehicle"`. Driver-licence warnings do not appear anywhere in the Review shell.** Decided 7 Aug 2026, on §7.8's own rule that a warning is "surfaced as a strip on the vehicle it concerns" — a driver's licence concerns no vehicle, so there is no card it belongs on, and a business-level warning feed is the "separate feed" that same sentence rules out. The passive owner also cannot act on it: F-10.1's actor is the manager, and Operate's home screen already surfaces licences for exactly that reason. Match `subjectId` to the vehicle card; drop the rest.

- **"What I'm owed"** — the label is correct and stays. It is **UC-67's partner current-account balance, all-time**: `putIn.contributions + putIn.outOfPocket + earned.profitShare + earned.managementFee − takenOut.payouts − takenOut.settlements`. `holdingMinor` is **not** in it (see below). Confirmed as a running total by the owner, 8 Aug 2026.

  **This is not a guess any more, and it is not one of the nine reports.** UC-67 is titled *"What each partner has put in and what he is owed"*, and its closing line names this exact row: *"the passive owner's real question is not 'what did the cars make' but **'what am I owed, and by whom'**. §4.5 gives him sixty seconds a month, and this is the line he actually reads."* §4.5 is the passive owner's sixty seconds, which is §7.8. **F-7.6 says the same thing from the flows side** — *"This is the line the passive owner actually reads in his 60 seconds"* — and its own title is "What each partner put in **and is owed**."

  **Three corrections to this document's own second edition, all in the same direction — it invented caution the owning documents had already resolved:**

  | Second edition said | Wrong because |
  |---|---|
  | Rename it; "What I'm owed" implies an obligation the schema doesn't model | **U-6 names "what you're owed" as the *approved* wording**, in the same breath as banning "current account". The phrase is the sanctioned one; the accounting term is what must not appear |
  | Scope it to the open period | UC-67 is a standing balance. The owner confirmed: a running total |
  | *"It must not net against `putIn`"* | **Backwards.** W-52: *"paying in more than your share buys you a **claim**, not a bigger slice… he is owed the extra twenty back."* Paying in **creates** what he is owed. `putIn` is a positive term, not an excluded one |

  The third was the worst of the three — it cited W-2 (never net the driver's two balances) for a case W-2 does not govern, and would have shipped a figure understated by every rupee a partner ever put in.

  **`holdingMinor` stays out, and that one *is* W-2's shape.** Business cash in his pocket is money he owes the business; netting it against what the business owes him is exactly the collapse W-2 forbids. UC-67 lists it as its own of four lines, and it stays its own line on `My money`.

  **The blocker is real and bigger than a filter: all-time `earned` does not exist.** `profitShareMinor` is *derived*, not stored — `getPartnerSummary` computes it by running `getVehicleMonthReport` for the open period and summing the user's `ownerShares` (`api/src/domain/partner.ts:316`). Profit share is not an `obligation` kind and period close snapshots nothing, so there is no row anywhere to sum. `partnerSummaryResponseSchema`'s own comment declines the work: *"a rerun across every closed period there has ever been is a different, larger feature this endpoint does not attempt."*

  **That comment is right that it is larger and wrong that it is optional** — the endpoint declined to build the one figure its own use case calls the line the owner actually reads. **GAP-74**, and §9.2 pulls it into **Wave 1**: omitting it would ship §7.8 without its most important row, and the naive implementation is a bounded loop over closed periods calling a function that already exists. A snapshot at period close is the better eventual shape — cheaper, and it makes a closed period's share a settled fact that recomputation cannot move, which is INV-16's own instinct — but it needs a migration and a backfill and must not gate the row.

  The row navigates (`›`) to `My money` (§5.6) — same data, four lines. No new screen.

- **Overheads block**: **blocked on GAP-41**, see §7.

### 5.5 Review shell · `Vehicles` tab

Not wireframed anywhere. **Decided 7 Aug 2026: the two tabs cut orthogonally, not by list length.**

| Tab | Answers | Shape |
|---|---|---|
| `This month` | one period × **all** vehicles | the §7.8 wireframe — hero, per-vehicle cards, overheads |
| `Vehicles` | one vehicle × **all** periods | a list (`GET /api/vehicle`), tapping into the read-only Review vehicle screen with its own period picker |

The first edition proposed `Vehicles` as "the full list, unbounded, for scrolling through a larger fleet", and flagged the overlap as an open question. The overlap is real and fatal at this fleet size: **with a bus and two cars, `This month` already shows every vehicle**, so a `Vehicles` tab that is the same list again has no job at all. Cutting by period-versus-vehicle instead gives it one that doesn't evaporate — "how has the bus done since March" is a question `This month` structurally cannot answer, and it is the question a partner reading rather than entering actually asks.

Both tabs render the same `VehiclePerformanceCard` (earned / spent / my share) with different framing — one component, two callers, which is what the first edition suspected and could not justify without a reason for the tabs to differ. The read-only vehicle screen is where the period picker lives, so "across periods" costs one `vehicle-month` fetch at a time rather than N up front.

### 5.6 Review shell · `My money` tab

**Defined, not inferred** (adopted from review F8, which is right that the first edition undersold the available contract). `GET /api/partner/{userId}` (A2) returns exactly the passive owner's personal position: `putIn` (contributions, out-of-pocket), `takenOut` (payouts, settlements), `earned` (profit share, management fee), `holdingMinor`, and the `period` that `earned` is scoped to. The tab is that summary rendered read-only, for the signed-in user's own `userId` from `GET /api/me`.

Two caveats to carry onto the screen rather than into a surprise:

- **`putIn` and `takenOut` are all-time; `earned` is one period — until GAP-74.** The schema says so in its own doc comment and names the period alongside. Once GAP-74 widens `earned`, all four of UC-67's lines are all-time and the tab shows the balance §7.8 links to. **Until then the screen must caption the scopes differently** — an all-time figure and a one-month figure in the same column with no distinction is the quiet wrongness this product exists to avoid.
- **The route is gated by `managePartnerCapital` (OWNERS).** That works for `owner` and `owner_manager`, which is who has this tab. A `manager` has no `My money` tab and could not fetch it if he did. Worth noting it also means an owner can read *any* partner's summary, not only his own — fine for a two-partner business, and part of GAP-1's scoping question rather than a new one.

---

## 6. Cross-cutting infrastructure B4 has to build once

**Chart palette as tokens.** `--color-chart-1` through `--color-chart-8` in `tokens.css`, light and dark from §11.2's validated table, done *before* the first chart component. Each token must also reach `cn.ts`'s tailwind-merge extension or classes built from it are silently dropped — the same trap that already bit this codebase once. Whether the colour scale needs its own `cn.ts` entry (distinct from `text`/`spacing`) or whether Tailwind v4's `@theme` `--color-*` namespace already registers with tailwind-merge's built-in colour group needs a five-minute check against a real build before assuming either way.

**Money → axis scaling module.** One function, one file, unit-tested like `money.ts` itself: `bigint` minor units in, `number` out, and nowhere else in the feature does `Number(minor)` appear. Per review F19, the tests are not just "a positive amount" — they are positive, **zero, negative profit** (a loss-making vehicle is an ordinary case here, not an edge), **mixed-sign domains**, and a value past `Number.MAX_SAFE_INTEGER`. On that last one the function either scales as `bigint` before converting or throws a controlled error; a silent `Number(bigint)` losing precision is the exact failure this boundary exists to contain.

**Report view-model and table primitive, built before the charts** (adopted from review F18, which is right about the dependency direction). Each report defines: response → view model, table columns, chart marks — in that order. Then the table view is nearly free and chart components never own business formatting. Something like:

```ts
interface ReportTableColumn<Row> {
  key: string;
  header: string;
  align?: "start" | "end";
  render: (row: Row) => React.ReactNode;
}
```

This is what makes "every chart has a table view, one tap away" (§11.3) a shared wrapper rather than nine bespoke tables — and §11.2 states the table view as the accessibility relief for the three low-contrast light slots, so it is a requirement, not polish.

**Empty is not the same as unknown, and this codebase has already ruled on it** (adopted from review F14, which is right, with a precedent the review didn't cite). W-56 governs a figure that *cannot be computed*, not one that is genuinely nil — and `api/src/queries/reports.ts` already says so in its own lint exemption: `-- allow: no expense row for this trip is a real zero cost, not a missing figure (W-56 governs an unknown, not an absent one)`, with `listPartnerCashPositions` repeating it for the same reason. So:

| Report | Empty response means | Renders |
|---|---|---|
| UC-74 receivables | nobody owes anything | "No one owes us anything" |
| UC-71 trips | no closed trips yet | "No closed trips yet" |
| UC-72 fuel | no complete fill-to-fill pair | **`NotAvailable`** — the metric cannot be computed |
| UC-76 lost days | no daily-lease days in the window | "No daily-lease days in this window" — *not* "no days lost" |
| UC-78 ageing | nothing outstanding | "Nothing overdue" |

`Plan.md`'s checklist line — "a test per report against an **empty** and a **partial** fixture asserting `NotAvailable`, not `0`" — is too broad as written and would make four of these five wrong. It needs the same correction.

**Enum values never render raw** (adopted from review F16). A label map per enum, colocated with the feature: `partyType`, `adjustmentType`, `lostReason`, ageing bucket, `docType`, vehicle arrangement. U-6 already forbids accounting vocabulary in the interface, and `over-90` or `auto_waiver` on screen is that rule broken in a different direction.

**Nullable name convention — decided: fall back to the party type.** `partyName`, `displayName`, `driverName` are `.nullable()` across every schema in `packages/shared/src/schemas/reports.ts`. One shared `<PartyName value={row.partyName} type={row.partyType} />`, not nine inline `?? "…"` fallbacks, rendering **"Unnamed driver" / "Unnamed customer" / "Unnamed partner"** in muted ink from the same label map the type column uses (§6's enum rule).

The row always renders — a receivable with no name is still money owed, and a report that silently drops it because a join found no name is worse than one showing a blank. The reason the fallback is type-derived rather than a bare `—`: **this component is also a chart direct-label**, where there is no adjacent type column to carry the meaning, and §11.2 makes direct labels mandatory on three of the eight palette slots. A dash in a bar label says nothing; "Unnamed customer" says what kind of thing owes the money.

---

## 7. The Track A increments

Five, ranked by whether a report is wrong without them. **None is B4's own work** — all five are Track A — but B4 is the first thing that surfaces most of them, and the first three gate Wave 2.

| # | What | Blocks | In B4? | Severity |
|---|---|---|---|---|
| 1 | Overheads with no vehicle (GAP-41) | §7.8's overheads block | **Wave 2** | phase-1 screen incomplete |
| 2 | Cash position: accounts + advances (§8.1) | UC-75 | **Wave 2** | **phase-1 report under-reports** |
| 3 | Lost-day reason breakdown (§8.2) | UC-76 | **Wave 2** | phase-1 report incomplete |
| 4 | **All-time `earned` for UC-67's balance (GAP-74)** (§5.4) | §7.8's "What I'm owed" | **Wave 1** | the line UC-67 says the owner actually reads |
| 5 | Goodwill window comparison, §8.3 **(a)** | nothing in B4 | **no — but urgent anyway** | **live wrong number in deployed code** |
| 6 | Goodwill date *basis*, §8.3 **(b)** | nothing in B4 | no | schema decision, same class as GAP-56 |
| 7 | Goodwill breakdown (§8.3) · `revenuePerAvailableDayMinor` (GAP-19) | UC-77, UC-79 | no | phase-2, deferred with their screens |

**Row 5 is the one that does not follow its screen.** UC-77 left B4 with the phase decision, but the window comparison is wrong in code that is deployed and callable today — an owner calling `/api/reports/goodwill` right now gets a total missing the window's last day. Deferring the *screen* is a scope choice; deferring the *bug* would be sitting on a known-wrong money figure because nothing renders it yet, which is the opposite of what this system's rules are for. Row 6 is a real schema decision and must not hold row 5 up.

**Row 4 is the only Track A work inside Wave 1.** It is a bounded loop over closed periods calling `getVehicleMonthReport`, which already exists — larger than a filter, smaller than it sounds, and §5.4 explains why it cannot be deferred to Wave 2 like the rest.

### 7.1 GAP-41 — the shape to build

`TRACKER.md` rules out one option ("**not** a client-side sum over a full expense list, which would be aggregation outside SQL on a money figure") and names two without picking:

**Option A — tri-state `vehicleId` on `ExpenseFilters`.** `string | null | undefined`, where `undefined` stays unfiltered and `null` means "no vehicle": `filters.vehicleId === null ? isNull(expense.vehicleId) : …`. Smallest change, but it widens a public filter's type for every caller including the `zod` request layer, where `null` and omission are different things on the wire.

**Option B — a dedicated report endpoint.** `GET /api/reports/overheads?periodId=` returning the same single-figure shape `goodwill` already uses.

**Both this document and review F2 land on Option B**, and for the same reason: "overheads for a period" is report-shaped, not list-shaped. It needs `posted_period_id`, `borne_by = 'us'`, `voided_at IS NULL`, `vehicle_id IS NULL` — the exact filter set `sumVehicleCostsForPeriod` already applies per-vehicle, with one predicate flipped. Putting it on `vehicle-month` would bolt a business-level number onto a per-vehicle response shape; putting it on the expense list makes a browsing filter carry a money figure.

```ts
GET /api/reports/overheads?periodId=…
{ period: { id, periodStart, periodEnd }, overheadsMinor: string }
```

Two things the review's version left implicit and the tests should assert: it excludes every expense with a `vehicle_id`, and it excludes `borne_by <> 'us'` (INV-5 — a driver-borne overhead is not the business's cost).

---

## 8. Three contract gaps neither document had in full

### 8.1 UC-75 loses the money once it's banked — and DM §15 is why

**This is the most serious finding in this pass**, and both prior documents understate it. Review F3 frames it as "arithmetically partly there, but narratively incomplete." It is arithmetically fine and *reportorially* broken:

`listPartnerCashPositions` computes `heldMinor = received − banked − advanced`. Every subtraction is correct — banked cash is genuinely not in the partner's pocket, and DM §15 explains at length why unsettled advances come out too. But **the response has nowhere for either subtrahend to reappear.** `cashPositionResponseSchema` is `{ partners: [{ userId, displayName, heldMinor }], depositsHeldMinor }`. Bank 100,000 and it leaves the partner figure and appears in no field of the response. The report titled "where is our cash" cannot say where the cash went.

The trail, because it matters for how this gets fixed:

- **UC-75** (product): "What each partner is holding, **what is in each account**, and what is out with drivers as advances."
- **FL §9.2**: "Held by partner **and account**, **plus driver advances only**" — phase **1**.
- **DM §15**: the query's own heading is "UC-75 where is our cash — **held per partner**". The account block and the advances line were never carried down from UC-75 into DM.
- The implementation follows DM §15 faithfully and verbatim, including its three explanatory bullets.

So this is not a coding oversight — it is `CLAUDE.md`'s "documents travel together" broken one level up, and the fix is a `doc-change` on DM §15 *before* the endpoint changes. The material exists: `banking_event.destination` is `text NOT NULL`, and `advance` already carries `issued_by_user_id` and a non-settled status filter.

```ts
{
  partners:       [{ userId, displayName, heldMinor }],
  banked:         [{ destination, heldMinor }],
  driverAdvances: [{ driverId, driverName, outstandingMinor }],
  depositsHeldMinor: string
}
```

**Until it lands, the screen is titled "Cash partners are holding."** Shipping the current contract under "Where is our cash" is precisely the confident-wrong-number failure W-56 exists to prevent — worse than `NotAvailable`, because nothing on screen admits anything is missing.

### 8.2 UC-76's reason breakdown is phase 1, and UI §11.1 dropped it

Review F4 found the query gap. The verification pass adds that **the design document lost it too**, so fixing only the query would still leave the screen unspecified:

- **UC-76**: "*Shows:* the count, the money it represents, **the reason breakdown**, and the **weekday distribution**."
- **FL §9.2**: "`lost` out of `ran + lost`, valued at the rate in force each day, **with reasons and weekday distribution**" — phase **1**.
- **UI §11.1**: "Column per month + weekday distribution as a second small chart." **No reasons.**

And the data is not merely available, it is *guaranteed*: `day_record.lost_reason` is `CHECK (lost_reason IN ('breakdown','driver_day_off','driver_ill','public_holiday','no_passengers','other'))` with `CHECK (state <> 'did_not_run' OR lost_reason IS NOT NULL)` — every lost day has a reason, by constraint. `listLostDays` groups by `driverId` and weekday and never reads the column.

This is the whole point of the report. UC-06 calls it "your only protection", and UC-33's own resolution note spells out the distinction reasons carry: "the difference between a bus that breaks down often and a driver who takes Fridays off." Weekday distribution catches the second; only reasons catch the first.

Recommended contract — a separate array rather than a denser cube, per review F4, so the client isn't rebuilding views from a three-dimensional grouping:

```ts
{
  rows: LostDaysRow[],
  reasons: [{ driverId, reason: LostReason, lost: number, lostValueMinor: string }]
}
```

That is a breaking change to `lostDaysResponseSchema` (today a bare array), which is worth doing now while the only consumer is a test. **UI §11.1 needs its UC-76 row updated in the same change** — documents travel together.

### 8.3 UC-77 returns a wrong total, not just an incomplete one

The first edition found the missing "table by reason". The verification pass found a live defect underneath it that neither document has:

```ts
gte(adjustment.createdAt, from),
lte(adjustment.createdAt, to),
```

`adjustment.created_at` is `timestamptz`. `from`/`to` are `businessDateSchema` — bare `YYYY-MM-DD`. So `lte(createdAt, to)` compares against `to` at midnight, and **every adjustment recorded on the final day of the window is silently excluded.** A June goodwill report omits all of 30 June.

It is also timezone-wrong in the way CLAUDE.md's Time section names explicitly. `created_at` is UTC; the business is `Asia/Colombo`, UTC+5:30. A waiver recorded at 09:00 Colombo on 1 June is 03:30 UTC on 1 June and lands inside a June window; one recorded at 04:00 Colombo on 1 June is 22:30 UTC on 31 May and lands outside it. Two waivers the owner gave on the same morning fall in different years of a year-scoped report.

**No test can catch it as written** — the only goodwill test uses `from=2020-01-01&to=2099-12-31`, a window so wide that both bugs are invisible.

**This is two defects stacked, and they must be fixed separately** (decided 7 Aug 2026 — the second edition's first pass treated them as one and recommended only the larger fix, which would have left the smaller one live while the larger was debated):

**(a) The comparison is wrong for the date it already uses.** Both the dropped last day and the UTC skew are one predicate:

```sql
created_at >= $from::date AT TIME ZONE 'Asia/Colombo'
AND created_at <  ($to::date + 1) AT TIME ZONE 'Asia/Colombo'
```

That is a *complete* fix for what it covers, not a stopgap — it converts the window's business-date boundaries into the instants that actually bound the day in Colombo, and the exclusive upper bound is what stops the last day vanishing. **Ship it on its own.** The timezone comes from the business, not a literal, the same way `businessToday(requireBusinessTimezone(c))` already resolves it elsewhere.

**(b) It is using the wrong date entirely.** `created_at` is when the row was *inserted*, not when the waiver was *given*. U-8 is explicit that "any record can be entered for a past date… no screen ever assumes it is being used on the day the thing happened" — so a waiver given on 15 June and entered on 2 July lands in July's goodwill, and in the wrong *year* if it straddles one. **This is the same class as GAP-56**, the borne-by date bug this repository already treated as a genuine money defect rather than a tidiness issue.

Fixing (b) needs a business-date column on `adjustment` — a forward-only migration, plus a decision about what existing rows get backfilled with (`created_at` in Colombo is the only honest answer available, and it is a guess for exactly the rows that motivated the column). Windowing on `posted_period_id` instead is the other candidate: consistent with every other money report and with W-40, but UC-77 asks for a *year*, which becomes a set of period ids rather than a range.

**(a) is small, complete and urgent; (b) is a schema decision that should not hold it up.** They get separate gap ids for that reason (§11).

Recommendation: the second. An adjustment is a money fact the owner made on a day, and the day it happened is not a property of when the row was inserted.

Separately, and smaller: `sumGoodwillGiven` sums `amount_minor` across `waiver`/`auto_waiver`/`goodwill` and **ignores `adjustment.sign`**. Nothing in the DDL ties sign to type — `sign smallint CHECK (sign IN (-1,1))` is independent of `adjustment_type`. If any of those three can be written with `sign = +1`, the total is wrong in the direction that under-reports goodwill. Probably all three are always `-1`; nothing enforces it and no test asserts it.

The breakdown itself, once the window is fixed, is review F5's shape and this document agrees — group by `adjustment_type`, not the free-text `reason` column, which will be sparse and unnormalised:

```ts
{ totalMinor: string, byType: [{ adjustmentType, totalMinor: string }] }
```

---

## 9. Scope

### 9.1 The phase decision has an answer, and it's six

The first edition raised the phase mismatch as an open question. The verification pass makes it answerable from the documents rather than by judgement, because **FL §9.2's report catalogue table carries an explicit per-row Phase column**:

| Report | FL §9.2 phase | Contract complete? |
|---|---|---|
| UC-70 this month | **1** | ✅ (tab needs GAP-41) |
| UC-71 trips | **1** | ✅ |
| UC-72 fuel efficiency | **1** | ✅ |
| UC-73 the year | 2 | ✗ no endpoint (GAP-18) |
| UC-74 who owes us | **1** | ✅ |
| UC-75 where is our cash | **1** | ✗ §8.1 |
| UC-76 lost days | **1** | ✗ §8.2 |
| UC-77 goodwill | 2 | ✗ §8.3 |
| UC-78 ageing | 2 | ✅ |
| UC-79 utilisation | 2 | ✗ GAP-19 |

`docs/product/use-cases.md`'s §9.1 table agrees ("Second: … receivables ageing (UC-78), utilisation and per-km reporting (UC-79)"), and UI §15 echoes it. **The phase-1 report set is exactly six: UC-70, 71, 72, 74, 75, 76.**

So "nine reports" was never the phase-1 scope — the backend simply built ahead of the phase gate in P11, and `Plan.md`'s B4 title inherited the endpoint count as if it were a scope. **Decided 7 Aug 2026: review F7's option 2 is adopted. B4 is "Review shell + phase-1 reports" — the six above.** UC-77/78/79 leave B4 entirely and belong to whatever item brings phase 2 forward, deliberately, in the owning documents first.

Two things that decision is *not*. It is not a judgement that those three reports are unimportant — UC-78's contract is complete and it would have been the easiest of the nine to build. And it is not a deferral on the strength of the phase tag alone: **two of the three cannot satisfy their own use case today regardless of phase**, so bringing them forward would have meant committing to §8.3 and GAP-19 in the same breath. Backend existence is not phase ownership, and a shipped endpoint is not a finished report.

### 9.2 Sequencing

Review F1 proposes splitting into `B4a Review core` then `B4b Reports catalogue`. **The instinct is right, the cut isn't** — Review core's `This month` tab is the part blocked on GAP-41, while the catalogue's UC-71 and UC-74 are unblocked today. Cutting by surface puts the blocked work first. Cutting by **contract completeness** doesn't:

**Wave 1 — nothing blocking beyond B0b.**
Shell routing for `owner`; `/more` → Reports row; all four tabs; the catalogue; and the shared infrastructure in §6 (palette tokens, axis codec, table primitive, `<PartyName>`, label maps). Then **all six reports**, four of them complete (UC-70, 71, 72, 74) and two shipping honestly short:

- **UC-75** as "Cash partners are holding" — narrower title, true figure (§5.3).
- **UC-76** as count + value + weekday, without the reason chart (§8.2). Unlike UC-75, nothing here needs a defensive title: every figure shown is correct and complete, and the missing piece is a second chart rather than a qualifier on the first.

Also Wave 1: `My money` (`GET /api/partner/{userId}`, complete once GAP-74 widens `earned`), the read-only Review vehicle screen, the `This month` tab minus its overheads block, and — **decided 7 Aug 2026** — **the owner-manager's `More → My share` entry point**.

**That entry point is Wave 1, not a deferral.** UI line 148 specifies it as "the same components rendered read-only," and Wave 1 builds those components regardless, so the marginal cost is one `MoreScreen` row and one route. The reason not to defer is who it serves: the `owner_manager` is the partner who *both* enters the data and wants to see his share, which makes him plausibly the more active user of the two, and deferring leaves him with no route to the review screens at all while the passive `owner` has four tabs of them. `MoreScreen`'s established "rows for what exists only" pattern means the row appears exactly when the components do — the same way Reports, Cash and Close the month each arrive with their own item.

**Wave 2 — after the Track A increments in §7.**
GAP-41 → the overheads block, completing `This month`. §8.1 → UC-75's `banked`/`driverAdvances` arrays, and the title reverts to "Where is our cash". §8.2 → UC-76's reason chart, with UI §11.1 updated in the same change.

**Not in B4 at all:** UC-77, UC-78, UC-79 (§9.1). **§8.3's goodwill window bug is the exception that does not travel with its screen** — it is a wrong number in code that is deployed and callable now, so it stays on Track A on its own schedule.

Wave 1 is a genuinely useful product: the owner lands somewhere real, sees his share and each vehicle, reads his own money position, and has six reports where every number on screen is one the backend can prove.

### 9.3 A consequence of the phase decision: `viewOwnerOnlyReports` has no caller

UC-77 and UC-79 are the only two owner-only reports, and both are phase 2. So **every card in B4's catalogue is gated by `viewReports` alone**, and `viewOwnerOnlyReports` — while still built in B0b, still enforced by the Worker, still part of the W-49 matrix — has nothing in B4 that exercises it.

Three practical consequences, recorded because a dormant capability is easy to mistake for a missing one:

- **`Plan.md`'s stated B4 trap partly lapses.** "Two capability gates… the catalogue must not render a card the role cannot fetch" is still the right rule and still how the catalogue is built (§5.1), but in B4 no role can reach a card it cannot fetch, because there is only one tier. The trap is dormant, not wrong — and it re-arms the moment either report lands.
- **The planned test "a `manager` never sees the owner-only cards" has nothing to assert in B4.** Replace it with the one that does have teeth: **a `driver` cannot reach `/reports` at all.** That is route-level, it is a W-49 security boundary rather than a convenience, and `<Can>` around a card does nothing for it.
- **`lib/capabilities.ts` still carries the row**, with its unit test, exactly as B0b specifies. Dropping it because B4 has no caller would mean re-deriving it later from `api/src/auth/policy.ts` — and the client copy existing in full is what makes it a mirror of the matrix rather than a subset someone has to check.

---

## 10. Test plan

- **One test per report against an empty and a partial fixture** — asserting the *right* thing per §6's table, `NotAvailable` where the metric can't be computed and a true-zero message where it can.
- **A `driver` cannot reach `/reports` at all** — route-level, since `<Can>` around a card does nothing if the route itself renders for a role holding only `viewOwnData`. Per §9.3 this replaces the planned "a `manager` never sees the owner-only cards", which has nothing to assert while both owner-only reports are out of scope.
- **An `owner` reaches the Review shell rather than `NotBuiltYetScreen`** — the one assertion that proves B0b + B4 actually connected.
- **The catalogue renders six cards and no phase-2 route resolves** — the assertion that keeps §9.1's scope decision from eroding one convenient card at a time.
- **UC-75's screen title is the narrow one** while the response has no `banked` field. Cheap, and it is the single thing in Wave 1 that would be a lie if it drifted (§5.3).
- **A lint-visible check that `Number()` never touches a `Minor` value** anywhere under `features/reports/` and `features/review/`, past the one axis-codec boundary.
- **Money→axis unit tests** per §6: positive, zero, negative, mixed-sign, and past `MAX_SAFE_INTEGER`.
- **`cn.test.ts` case per new `--color-chart-*` token**, following that file's existing per-token convention.
- **Every chart has a reachable table-view control** — one shared assertion helper, cheap if the table wrapper is one component and expensive if it's nine.
- **Parameters survive a refresh**: navigate to `/reports/ageing?asOfDate=…`, reload, same report. And an invalid or missing param renders the parameter form rather than fetching.
- **First accounting period renders no delta line at all** — not `0%`, and not `NotAvailable` (§5.4).
- **Negative profit renders correctly** in both a bar and a table — a loss-making vehicle is an ordinary case.
- **`cash-position` never visually merges deposits with owned cash**, per §6.13.
- **Golden-fixture assertion**: against the G-1 fixture, the `This month` tab's **per-vehicle card** must read profit **134,000** (`180,000 − 46,000`, DM §15's own worked figure). The first edition suggested asserting the *hero* at 134,000 — the hero is "My share", a `profitShareMinor`, not the vehicle's profit. Assert the vehicle figure against 134,000 and the hero against the share it works out to.

**Backend tests, if the §7/§8 increments land:** overheads excludes vehicle-attributed and non-`us` expenses; goodwill includes an adjustment recorded on the window's **last day** (the assertion that would have caught §8.3) and groups only waiver/auto-waiver/goodwill; lost-day reasons exclude `paused_for_trip` and off-pattern days; cash-position exposes banked and advanced separately from partner-held.

---

## 11. Decisions taken, and the one thing still open

**Nothing is open.** Four questions were answered by the verification pass, eleven decided on 7 Aug, and the last — what "What I'm owed" means — answered by the owner on 8 Aug: **a running total**, which turned out to be UC-67's balance and is now §5.4. What follows is registration and two things carried deliberately.

**The mockup figure was the clue, and reading it properly would have saved a round trip.** §7.8 shows `124,000` against a hero of `86,500`, and the hero reconciles exactly (`30,900 + 35,000` for the two visible cars, plus the bus scrolled off at `20,600`). A row exceeding one period's share was already evidence it was cumulative — this document noticed the arithmetic and still proposed the period reading, because it weighted "what the endpoint can do today" above "what the wireframe plainly shows." **The contract's convenience is not evidence about the requirement.**

### Registration, not decision

1. **Four gap ids need TRACKER entries.** Next free is **GAP-70** — GAP-61…69 were taken by the 8 Aug flow-inventory audit, which is unrelated (nine flows with no caller; these four are report contracts):

   | Id | What | Priority |
   |---|---|---|
   | **GAP-70** | Cash-position completeness — banked by destination, driver advances (§8.1) | phase-1 report under-reports; blocks Wave 2 |
   | **GAP-71** | Lost-day reason breakdown (§8.2) | phase-1 report incomplete; blocks Wave 2 |
   | **GAP-72** | Goodwill window comparison, §8.3 **(a)** | **live wrong number in deployed code** — highest, and independent of every other item here |
   | **GAP-73** | Goodwill date basis + breakdown, §8.3 **(b)** | schema decision, same class as GAP-56; deferred with UC-77 |
   | **GAP-74** | All-time `earned` for UC-67's balance (§5.4) | **Wave 1** — UC-67 calls it the line the passive owner actually reads |

   GAP-72 is deliberately separated from GAP-73 so a one-predicate correctness fix is not held behind a migration decision.

2. **Two `doc-change` passes precede their queries.** DM §15 needs UC-75's account block (§8.1) before the endpoint grows one; UI §11.1 needs UC-76's reason breakdown (§8.2) before the query does. That ordering is what "documents travel together" means here, and neither is this document's to make unilaterally. DM §15 also takes the ageing note below.

### Carried, not resolved

3. **The ageing JS/SQL deviation is recorded, not rewritten** (decided 7 Aug 2026). `listAgeingBuckets` buckets in application code where DM §15 specifies a SQL `CASE`. The JavaScript is correct and tested, UC-78 is out of B4 so nothing forces the change, and **rewriting working money code to match a document is the riskier direction of the two.** What is not acceptable is leaving an owning document describing a query the code does not run — so DM §15 gains a note that its SQL specifies the bucketing *rule* and the implementation lives in the Worker, plus the scale caveat (it reads every open obligation into memory, which is nothing at a few hundred rows and would not be at a hundred thousand).

4. **GAP-1 is an acceptance constraint** (review F17, on its own recommendation). `viewReports` is a flat business-wide check — `api/src/auth/policy.ts` says so directly: "every report in P11 reads across the whole business regardless of role." UC-70/71/72 say a manager sees only shared vehicles. The UI cannot fix this by hiding cards, because the endpoints themselves are unscoped. B4's done-means carries: *until GAP-1 lands, nothing in B4 claims or implies per-vehicle manager scoping, and the existing operational guard stands — do not invite a `manager` to a real business.*

5. **Deferred with UC-79, recorded so it is not re-derived:** the utilisation endpoint returns one vehicle per call while UI §11.1 and the use case both describe a cross-vehicle comparison (§5.3). Fan out N calls, add a multi-vehicle mode, or accept a picker — whoever builds UC-79 inherits the question.

---

## 12. What was declined from the review, and why

Per this repository's convention that a document absorbing a review records what it did not take.

**F11 — a client-side `selectVehicleWarnings(vehicle, documents, today)` selector.** Declined. `GET /api/home/paperwork-warnings` already applies F-10.1's 30-day threshold, already keeps warning past expiry, already returns `isExpired` as a field, and already computes `today` from the business timezone. Every question F11 asks the design to answer — which doc types count, what the threshold is, what happens when a document is already expired — is answered in the Worker. Building the selector would be two implementations of one rule, which CLAUDE.md forbids on the grounds that they diverge. The *placement* question F11 raises was real and is now decided — the strip filters to `subjectType === "vehicle"` and driver licences do not appear in the Review shell at all (§5.4). The computation stays in the Worker.

**F15 — replace UC-75's stacked bar with two adjacent bars.** Declined as written. UI §11.1 specifies "Stat tiles + **a stacked bar of held vs ours**" with the why-column "The liability split is the point," and CLAUDE.md is explicit that the owning document decides. The concern behind F15 — that a stacked bar can read as one pool — is legitimate and §5.3 keeps the strong visual separation and the liability caption. If the stacked bar is genuinely the wrong form, UI §11.1 changes first, deliberately, with the reason recorded. It does not change here as a side effect.

**F12's goodwill default window.** Declined in favour of the owning document. F12 calls it a product decision leaning toward the accounting period "for consistency with B4". UC-77's own first line is "Per year", and §6.11's stated reasoning only works over twelve months. Consistency with the other reports is the wrong tiebreak when a use case has already ruled — and this is one of the places CLAUDE.md names where consistency is itself the bug.

**F1's B4a/B4b split.** Adopted in spirit, changed in substance. See §9.2 — the cut is by contract completeness, not by shell-versus-catalogue, because the shell's headline tab is the blocked part and two catalogue reports are not.

**F9 — rename "What I'm owed", because it implies a legal receivable the schema doesn't model.** Adopted in the second edition; **reversed 8 Aug**. Both halves of the premise are wrong. The schema *does* model it — W-52: *"paying in more than your share buys you a **claim**, not a bigger slice… he is owed the extra twenty back"* — and **U-6 names "what you're owed" as the approved interface wording**, in the same sentence that bans "current account". F9 read a money term as accounting vocabulary when the owning documents had already sorted the two. This document then compounded it by inventing a rule ("must not net against `putIn`") that inverts W-52. Recorded at length in §5.4 because a review being right about a problem and wrong about the remedy is the failure mode this section exists for — and here the review was wrong about the problem too.

Everything else in the review is adopted: F2 (dedicated overheads endpoint), F3/F4/F5 (the three contract gaps, sharpened in §8), F6 (don't imply UC-79's revenue comparison), F7 (phase-1 only, now with a precise membership), F8 (`My money` defined), F10 (read-only Review vehicle screen), F13 (URL-backed parameters), F14 (empty ≠ unknown), F16 (label maps), F17 (GAP-1 as an acceptance constraint), F18 (table primitive first), F19 (axis codec tests), F20 (business-date rules).

---

## 13. Revision log — what the verification pass changed

**Corrected in the first edition:**

1. **"Four of the nine need parameters"** → six (§5.2). The table beneath it already listed six. `Plan.md` carries the same error and needs the same fix.
2. **"Bucketing happens in SQL … never client-side"** (UC-78) → `listAgeingBuckets` buckets in JavaScript with `Date.parse`; DM §15 specifies SQL. The conclusion survives, the reason didn't (§5.3).
3. **UC-79 "one bar per vehicle in scope"** → the endpoint returns one vehicle per call, contradicting the document's own §5.2 row (§5.3).
4. **The golden-fixture assertion at 134,000** → that is a vehicle-month *profit*, not an owner's *share*; the hero is the share (§10).
5. **The warning strip's source** → `GET /api/home/paperwork-warnings`, not N+1 per-vehicle document fetches (§5.4).

**Found, in neither document:**

6. **UC-75 loses banked cash from the report entirely**, and DM §15 is the reason it was never built — a documents-travel-together break, on a **phase-1** report (§8.1).
7. **UC-76's reason breakdown is phase 1 in both product documents and absent from UI §11.1**, so fixing only the query would leave the screen unspecified (§8.2).
8. **The goodwill report silently drops the last day of every window** and windows on a UTC timestamp for a business-date question — a live wrong number, untestable by the existing test's 2020–2099 window (§8.3).
9. **`sumGoodwillGiven` ignores `adjustment.sign`**, which nothing in the DDL ties to `adjustment_type` (§8.3).
10. **FL §9.2 carries an explicit per-row phase column**, which turns the phase mismatch from a judgement call into a lookup: the phase-1 set is six (§9.1).
11. **The empty-versus-unknown distinction is already ruled on in this codebase**, in `queries/reports.ts`'s own lint exemptions — which both backs review F14 and makes `Plan.md`'s "assert `NotAvailable`, not `0`" checklist line wrong for four of five reports (§6).
12. **`GET /api/partner/{userId}` is complete enough to define `My money` outright**, and `GET /api/home/paperwork-warnings` the warning strip — two of the first edition's open questions closed by reading what already shipped (§5.4, §5.6).

**Decided, on the strength of the above** — the eleven in the table at the head of this document. Three set scope:

13. **B4 builds the phase-1 six** (§9.1). Not because the phase tag says so on its own, but because the tag and the contracts agree: two of the three excluded reports cannot satisfy their use case today at any phase.
14. **"What I'm owed" keeps its label** and is UC-67's all-time partner balance (§5.4) — confirmed by the owner 8 Aug. Needs **GAP-74** (all-time `earned`), which lands in Wave 1 because UC-67 calls this the one line the passive owner reads.
15. **UC-75 ships under a narrower title in Wave 1** and reverts to its own when the contract is complete (§5.3). The title is the part that would otherwise ship as a lie.

Eight more close this edition's open questions (§11). Two are worth naming here because they changed a recommendation this document had already made:

16. **§8.3 is two defects, not one.** The second edition recommended only the larger fix — a business-date column on `adjustment` — which would have left a one-predicate correctness bug live in deployed code while a migration was debated. Split into **GAP-72** (ship now) and **GAP-73** (decide properly).
17. **The owner-manager's `More → My share` moves into Wave 1** rather than being recorded as a deferral. It is one row and one route over components Wave 1 builds anyway, and the `owner_manager` — the partner who enters *and* reads — is plausibly the more active of the two users.

**Downstream edits these imply:** `Plan.md`'s B4 title, its "four of the nine" prose (§5.2), its `NotAvailable`-over-`0` checklist line (§6), its owner-only-card trap (§9.3), and a `More → My share` row; TRACKER entries for GAP-70…73; and `doc-change` passes on DM §15 (UC-75's account block, plus the ageing deviation note) and UI §11.1 (UC-76's reason breakdown) before the §8.1/§8.2 queries move.

---

## 14. Explicitly out of scope for B4

- **UC-77 (goodwill), UC-78 (ageing), UC-79 (utilisation)** — phase 2 in FL §9.2's per-row column, decided out of B4 on 7 Aug 2026 (§9.1). Their screen designs survive in §5.3 for whoever picks them up. **§8.3's goodwill window bug does not go with them** — it is a live defect and stays on Track A.
- **UC-73 (the year)** — GAP-18, phase Second, no endpoint. Not a card.
- **The Mine shell (B5)** — separate item, separate audience, needs B0b's other render branch.
- **Export (UC-99, F-9.3)** — phase Second per FL §9.2.
- **Desktop, beyond what responsiveness gives for free.** Decided 7 Aug 2026: B4 is mobile-first per M-1, with max-widths and grid reflow where they cost nothing, and **nothing from §14** — no sortable columns, no small multiples, no side-by-side month comparison. §15 puts the analytical dashboard in phase **Third**; §14's baseline three changes being undated is not a licence to pull them into the largest item on the board. B4's done-means says reports are *usable* at `lg`, not optimised for it.
- **Fixing GAP-1** — B4 must not *imply* per-vehicle scoping (§11 item 4), but scoping the report queries is Track A.
- **Side-by-side condition-photo comparison, Sinhala localisation of report copy beyond the existing i18n pipeline** — both phase Second, unrelated to reports.
