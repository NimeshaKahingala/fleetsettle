# Live browser findings — QA, 10 August 2026

Fresh browser QA pass via Chrome DevTools MCP (real Chromium, both real desktop and emulated touch/coarse-pointer contexts), continuing from `LIVE-TEST-PLAN.md`'s queue and specifically targeting the unfixed `MOBILE-SHEET-AND-DATE-PICKER-FINDINGS-2026-08-09.md` report (no code changes had been made against it as of this session). No source/code changes were made during this pass — investigation and documentation only.

QA commit at start of session: `origin/develop@2c0499e` (10 Aug 2026 merge of PR #17).

Convention: each finding gets a status (CONFIRMED / NOT REPRODUCED / INCONCLUSIVE / REGRESSION-CLEAN), the evidence, and — where confirmed — a root-cause note. Nothing here has been fixed; this is a record for triage into `TRACKER.md`.

## Summary, ranked by severity

| id | What | Status | Severity |
|---|---|---|---|
| **F-0** | Opening balances (`customer_due`, `deposit_held`, and by the same code path all six `kind`s) never write to `obligation`/`deposit`/`advance` — "Confirm and go live" only flips a status flag nothing else reads | 🔴 CONFIRMED | **P0** — silent, permanent loss of a business's starting financial position |
| **F-1** | MP-02: Quick Add's Fuel/Expense/New trip silently do nothing on touch | 🔴 CONFIRMED | P1 — primary mobile entry points non-functional |
| **F-2** | MP-04: nested Amount sheet closes its parent sheet too, silently discarding the whole entry | 🔴 CONFIRMED | P1 — mid-form data loss on touch |
| **F-3** | GAP-83: DateField's hidden native input is a real Tab stop with zero visible focus indicator | 🔴 CONFIRMED | P1 accessibility — every DateField, every money-entry flow |
| **F-6** | "Where is our cash" mislabels a driver deposit as "Held for customers" (3 call sites), and the unit test locks the wrong wording in | 🟠 CONFIRMED | P2 accuracy/copy |
| **F-4** | MP-06: DateField's `showPicker()` fallback is genuinely missing in source; live behaviour inconclusive (tooling limitation) | 🟡 INCONCLUSIVE | P2, real-device check needed |
| **F-5a** | MP-08: can't be tested — no UI path attaches an advance to a trip at all (separate real gap) | 🟡 BLOCKED | P3 watch item, root cause identified |
| **F-5** | MP-01: DateField's three-control layout, doubled on range screens | 🟠 CONFIRMED | P2 UX |
| **F-7** | GAP-84 vehicle-arrangement gate holds under direct URL navigation | 🟢 REGRESSION-CLEAN | — |
| **LT-7** | GAP-3 day-card confirm loop, visit two | 🟢 CONFIRMED FIXED | — |
| — | GAP-85 (MoneyField blank vs. zero) | 🟢 REGRESSION-CLEAN | spot-checked in passing |

**Three P1s and one P0 share a root cause pattern worth naming:** F-0, F-1, and F-2 are all the same class of failure — a write or a navigation that *looks* complete to the user (a "Confirmed" message, a tap that visually does something, a save button that closes cleanly) while the actual state change either never happened (F-0) or got silently discarded (F-1, F-2). None of the three produced a console error. This is precisely the failure mode `CLAUDE.md` names as the whole reason this document format exists: "a confident wrong number is worse than an admitted gap" — except here it's not even a wrong number, it's an absent one presented as a success.

---

## Carried over from the previous session (8 August)

- **LT-7 (day-card confirm loop, GAP-3)** — ✅ **CONFIRMED FIXED**, live. Cron ran overnight, produced the real placeholder for NC-1234 / 10 Aug, day card offered its three real buttons (not a broken "Confirmed" label). Tapped "Paid in full" → `POST /api/day-record/confirm` → 201 → `{"state":"ran_paid_full","earnedMinor":"300000","expectedMinor":"300000","receivedMinor":"300000"}`. Day card now reads "Confirmed", no longer tappable. This closes out the last open item from the 8 Aug session's queue.

---

## New pass — findings in progress

### F-0 · Confirmed opening balances never become real money records anywhere — the "Confirm and go live" step is not connected to the ledger — 🔴 CONFIRMED (P0 — the most severe finding this session)

**How this was found:** checking the new "Who owes us" report (B4 Wave 2, `/reports/receivables`) against known test data. The previous session (8 Aug) created and *confirmed-live* an opening balance batch for this business with two entries: a `customer_due` of Rs 2,000 against "QA2 Customer" and a `deposit_held` of Rs 5,000 against "QA2 Driver." The Opening Balances screen itself still shows both entries, with `status: "committed"`, exactly as left.

**"Who owes us" shows only Rs 1,450 (QA Customer, an ordinary trip due) — the Rs 2,000 QA2 Customer opening-balance due does not appear at all**, anywhere in the report.

**Cross-checked a second, independent way:** "Where is our cash" (`/reports/cash-position`) reports `depositsHeldMinor: "100000"` — Rs 1,000 exactly. That figure is fully accounted for by the *real* driver deposit recorded via `POST /api/deposit` in the previous session (Sunil Perera, Rs 1,000). **The Rs 5,000 `deposit_held` opening-balance entry against QA2 Driver contributes nothing to this total** — if it had, the figure would read Rs 6,000.

**Root cause, confirmed directly against source — not inferred:**
- `api/src/domain/opening-balance.ts` — `saveOpeningBalance` (lines 68-121) and `commitOpeningBalance` (lines 130-150) are the **entire** write surface for this feature. `saveOpeningBalance` writes only to `opening_balance_batch` and `opening_balance_entry` (via `insertBatch`/`insertEntries`, `api/src/queries/opening-balance.ts`). `commitOpeningBalance` does exactly one thing beyond that: flips `opening_balance_batch.status` from `draft` to `committed` (`markBatchCommitted`). **Neither function writes, in any form, to `obligation`, `deposit`, `advance`, or any other money table.**
- Confirmed by search: `openingBalanceEntry`/`opening_balance_entry` appears in exactly four files in the entire API — `db/schema.ts`, `queries/opening-balance.ts`, `handlers/opening-balance.ts`, `domain/opening-balance.ts`. **No report query, no balance query, no payment-allocation code, nothing outside the opening-balance feature's own four files, ever reads an opening-balance entry.** `listReceivables` (`api/src/queries/reports.ts:277-308`) reads only from `obligation`; `sumDepositsHeld` (same file, line 465) reads only from `deposit`. Neither has any awareness that `opening_balance_entry` exists.
- In other words: **"Confirm and go live" only changes a status flag on a row nothing else in the system looks at.** The six entry `kind`s (`customer_due`, `driver_arrears`, `owed_to_driver`, `deposit_held`, `advance_outstanding`, `cash_held`) are captured, stored, and echoed back by the Opening Balances screen itself — and nowhere else. They never become the `obligation` rows that drive receivables/ageing/payment-allocation, never become `deposit`/`advance` rows that drive the cash-position and driver-balance reports, and would never surface on a customer's or driver's own balance under any current or future screen that reads those real tables.

**Why this is the most severe finding of the session, stated against this project's own rules:** `CLAUDE.md` opens with "Its whole promise is being believed about money" and F-0.2 itself is described in `user-flows.md` as "the highest-friction moment in the product" — the one-time act of telling FleetSettle what was already true before it started keeping the books. The screen's own confirmation copy — *"Confirmed — you can still add or correct figures here until the first month closes"* — actively tells the user their starting position is now locked in and load-bearing. **It is not.** A business that enters real opening arrears, dues, and deposits, confirms them, and starts operating will silently and permanently lose that starting position from every report, every balance, and every reconciliation the product will ever show them — with no error, no warning, and a screen that keeps telling them everything is fine every time they revisit `/opening-balances`. This is exactly the failure mode `CLAUDE.md`'s "Numbers that go wrong quietly" section exists to prevent, at the most severe possible point: not a wrong number, but a whole category of real money that the ledger has already told the user it accepted.

**Scope:** confirmed for `customer_due` (receivables) and `deposit_held` (cash position) specifically, via live data. By the same code-path evidence, `driver_arrears`, `owed_to_driver`, `advance_outstanding`, and `cash_held` are equally unconnected — none of the six `kind`s has any path into a real money table.

**Not previously tracked:** `TRACKER.md`'s only opening-balance entry (`GAP-61`, 8 Aug) records when the *screen* shipped (B12), with no note about materialization into `obligation`/`deposit`/`advance`. `LIVE-TEST-PLAN.md`'s own LT-5 item expected this to be checkable "once B4 exists" and flagged it as blocked purely on the *reports UI* not existing yet — not on the underlying data model never having been wired up. This session is the first to have both a committed opening balance and a working reports screen to check it against, which is what surfaced this.

### F-7 · GAP-84 regression-clean: vehicle-arrangement gate holds even via direct URL — ✅ CONFIRMED, no regression

Navigated directly to `/vehicles/{QA-52656 id}/daily-lease/new` (arrangement C, "Trips / charter") — the client correctly refuses to render the form at all: *"This vehicle is set up for arrangement C, not a daily lease."* No `POST` was even attempted (confirmed via network log — only `GET /api/vehicle/{id}` fired). GAP-84's client-side gate holds under direct navigation, not just normal in-app clicks. Server-side mirroring (GAP-87, `VEHICLE_ARRANGEMENT_MISMATCH`) was not independently re-verified this session (would require bypassing the client entirely) but is already covered by integration tests per `TRACKER.md`.

### Other spot-checks, no findings

- **GAP-85** (`MoneyField`'s blank trigger reads `Enter {label}` rather than `Rs 0`) — confirmed live on the trip-booking form's Agreed Amount field, in passing during the MP-04 investigation. Regression-clean.
- **Dark mode** — Home, Vehicles list, Driver detail, vehicle Costs/Incidents list, Reports (cash position, lost days, receivables) all screenshotted in dark mode. Legible throughout, good contrast, colour-coded arrangement badges carry text labels alongside colour (not colour-only), the voided-expense treatment (red badge + border + struck-through text) is a clear improvement over the plain grey strikethrough seen in the 8 Aug session. No dark-mode-specific defects found.
- **Lease-out vehicle type** (QC-0808160814-A, arrangement A) — Vehicle actions correctly limited to View calendar / Record expense / Report incident (no daily-lease or trip actions offered), consistent with arrangement gating elsewhere. Not deeply explored beyond this.

---

## What this pass did not cover

- **MP-07** (test-coverage gaps for the touch-only modal failure class) — a source/test-suite concern, not something a browser session can check.
- **Real iOS Safari / Android Chrome** — every touch finding here (F-1, F-2, MP-01, F-3/GAP-83, F-4/MP-06) was produced via Chrome DevTools Protocol viewport+touch emulation on desktop Chromium, which faithfully reproduces `matchMedia("(pointer: coarse)")` and touch event dispatch, but is not a substitute for the actual device class the original bug report was filed against (iPhone Chrome). F-4 in particular is flagged inconclusive specifically because this environment's Chromium build supports `showPicker()` and Safari's support has historically differed.
- **LT-1** (Review/Mine shells, needs a second Asgardeo identity) and the **manager-role** half of LT-6a (void an expense) — both still blocked on a second real identity, same as the 8 Aug session; not re-attempted this session since the user chose to skip LT-1 rather than provide/redeem a second invite.
- **The remaining `MOBILE-SHEET-AND-DATE-PICKER-FINDINGS-2026-08-09.md` call sites** (`IncidentScreen`, `LeaseHubScreen`, `PeopleListScreen`'s add-driver/add-customer) were not individually reproduced — three independent call sites (Quick Add ×3, DriverDetail, VehicleOverview) already share byte-identical failure behaviour and the same root cause in the shared `ActionSheet` primitive, which is reasonable but not certain grounds to extrapolate to the rest.
- **No code was changed.** This file is investigation and documentation only, per instruction.

### F-1 · MP-02 confirmed live: Quick Add's Fuel/Expense/New trip silently do nothing on touch — ✅ CONFIRMED (P1)

**Setup:** Chrome DevTools MCP viewport emulation `390x844x3, mobile, touch` (iPhone-class). Verified `window.matchMedia('(pointer: coarse)').matches === true` before testing — this is the exact condition `useMobileHistoryDismiss` branches on, so the emulation is faithful to the real-device bug class described in `MOBILE-SHEET-AND-DATE-PICKER-FINDINGS-2026-08-09.md`.

**Steps and result, all three, repeated independently:**
1. Tap bottom-nav "Add" → `QuickAddSheet` opens (`Fuel` / `Expense` / `New trip`).
2. Tap "Fuel" → sheet closes, **no fuel-fill sheet ever appears**, lands back on plain Home.
3. Repeat from step 1, tap "Expense" → identical silent failure.
4. Repeat from step 1, tap "New trip" → identical silent failure.

**No console errors or warnings at any point** — the failure is completely silent, matching the source doc's prediction ("Tapping an action appears to do nothing"). `history.state.__TSR_index` reads `0` after the failed tap, consistent with the router being popped back past both sheets' history entries.

**Root cause (from source, confirmed by this reproduction — not a new diagnosis, corroborating the existing doc):** `ActionSheet.tsx` closes itself (`onOpenChange(false)`) and synchronously invokes the selected action's `onSelect()` in the same click handler, which opens the target sheet (e.g. `setFuelOpen(true)`) immediately. Every `Sheet` — including the one just opened — mounts `useMobileHistoryDismiss`, which on coarse-pointer devices pushes a history entry on open and calls `history.back()` on its own close. The closing `ActionSheet`'s cleanup fires `history.back()` after the new sheet has already pushed its own entry, so the back navigation lands on / pops the new sheet's entry instead of the action sheet's, and the new sheet's own popstate listener treats that as its cue to close. Net effect: the new sheet never stays open.

**Impact:** This is not a cosmetic bug. On any real touch device (the target device class for this entire product per M-1 — "phase-1 flow completes on 360×640, one thumb"), **the primary Quick Add entry point for logging fuel, recording an expense, or starting a trip is completely non-functional.** A manager on a phone cannot do any of these three things via the `+` tab. This is the single most severe finding of this session.

**Status:** Already fully documented with proposed fix in `MOBILE-SHEET-AND-DATE-PICKER-FINDINGS-2026-08-09.md` (MP-02), committed 9 Aug, explicitly "no source code changes were made." This live pass converts it from a source-audit claim into a directly reproduced, confirmed defect. No code change made by this session either, per instruction.

**Additional call sites independently confirmed with the same failure, same emulation:**
- `DriverDetailScreen` → "Driver money" → "Pay the driver" (MP-03's list) — sheet never opens, silent drop back to driver detail.
- `VehicleOverviewScreen` → "Vehicle actions" → "Record expense" (MP-03's list) — identical silent failure.

Given three structurally distinct call sites all fail identically with zero console output, this corroborates the doc's own diagnosis: the defect lives in the shared `ActionSheet` primitive, not in any individual screen. Every other MP-03-listed call site (IncidentScreen, LeaseHubScreen, PeopleListScreen's add-driver/add-customer) shares the exact same `ActionSheet.tsx` code path and can be treated as equally affected without needing to individually reproduce each one — but that inference should be validated once a fix lands, not assumed permanently.

### F-2 · MP-04 confirmed live: a nested picker Sheet can close its *parent* Sheet and silently discard the whole entry — ✅ CONFIRMED (P1), and worse than documented

**Setup:** Same touch/coarse-pointer emulation. Used the Opening Balances screen specifically because its "Add a starting figure" sheet opens directly from the route (not gated behind the broken `ActionSheet`), making it possible to reach a genuine Sheet-within-Sheet nesting despite F-1 blocking most other entry points.

**Steps:**
1. `/opening-balances` → tap "Add a starting figure" → parent sheet opens correctly (kind selector, "Cash a partner is already holding" selected, Partner picker, Amount field).
2. Tap "Enter amount" → nested "Amount" sheet opens correctly on top.
3. Enter a value (`Rs 2`), tap "Save" on the nested amount sheet.
4. **Result: both the nested Amount sheet and the parent "Add a starting figure" sheet close simultaneously**, landing back on the plain `/opening-balances` route. The entry list still shows only the original 2 entries — the partner selection and amount just entered are gone, with no error, warning, or confirmation of any kind.

**Why this is worse than MP-02:** MP-02 fails before any data entry happens — annoying but nothing is lost. This is mid-form data loss: a manager could fill in a real figure (e.g. one of F-0.2's "highest-friction moment in the product" opening-balance entries, entered once and never revisited), tap Save on the amount sub-sheet believing they're saving *that field*, and the entire entry silently vanishes with no indication anything went wrong.

**Root cause:** Matches the doc's MP-04 diagnosis exactly. `AddOpeningBalanceEntrySheet` and its internal `MoneyField`'s `AmountPad` sheet both independently mount `useMobileHistoryDismiss`. The parent pushes a history entry on open; the nested Amount sheet pushes a second one on top. When the amount sheet closes via Save, its cleanup calls `history.back()`, which lands on the parent's history entry — but the parent's own `popstate` listener (still mounted, still listening) treats that back-navigation as *its own* close signal and tears itself down too, discarding its in-progress form state in the process.

**Confirms the doc's listed high-risk area:** `web/src/features/opening-balance/AddOpeningBalanceEntrySheet.tsx` was explicitly named in MP-04's "High-risk usage areas" list — this reproduction validates that listing directly, not just by source inspection.

**Practical note on reachability:** Because F-1 (MP-02/03) blocks the `ActionSheet`-gated entry points first, most of MP-04's other listed high-risk sheets (`FuelFillSheet`, `RecordExpenseSheet`, `PayDriverSheet`, `AdvanceSheet`, `DepositSheet`, etc.) are currently *unreachable* via touch at all — a user can't even get far enough to trigger MP-04 there, because MP-02 stops them first. Fixing MP-02/03 without also fixing MP-04 in the same pass (as the source doc's own "Proposed Fix Order" already recommends) would immediately expose MP-04 as the next blocker on every one of those screens.

### F-3 · GAP-83 confirmed and precisely mapped: DateField's hidden native input is a real, unmarked keyboard-Tab stop with zero visual focus indicator — ✅ CONFIRMED

**This is a keyboard/desktop accessibility defect, independent of touch emulation** — verified with real `Tab` keypresses and DOM inspection on the trip-booking form (`/vehicles/{id}/trip/new`), which has two `DateField` instances (Start date, End date).

**Source** (`web/src/components/DateField.tsx:78-87`): every `DateField` renders `Today` / `Yesterday` chip buttons, one visible custom button showing the weekday (`onClick` calls `inputRef.current.showPicker()`), and a native `<input type="date" className="sr-only" .../>` with **no `tabIndex={-1}`** — so it stays in the natural tab sequence. The component's own doc-comment says the intent was only for the input to be "reachable via `showPicker()`", i.e. reachable *from* the visible button, not as its own independent stop — but nothing prevents Tab from reaching it directly.

**Live DOM tab-order trace** (`Back → Today → Yesterday → "Mon 10 Aug" → [sr-only date input] → Today → Yesterday → "Mon 10 Aug" → [sr-only date input] → Choose customer → ...`): confirmed programmatically via a full focusable-element walk, matching real `Tab` keypress behaviour observed live.

**Computed style of the focused input:** `width: 1px, height: 1px, clip-path: inset(50%), overflow: clip, class: sr-only` — the standard Tailwind visually-hidden pattern. The browser does compute a default focus outline for the element, but the `clip-path: inset(50%)` clips a 1×1 box to nothing, so **no focus indicator renders anywhere on screen** — confirmed by screenshot: after `.focus()`-ing the element, the rendered page shows no visible focus ring, box-shadow, or outline anywhere.

**Impact:** A sighted keyboard-only user (motor-impaired user using Tab/Space instead of a mouse, or anyone navigating via keyboard on desktop) tabbing through *any* form containing a `DateField` — expense date, incident date, payment date, lease start date, opening-balance go-live date, trip start/end date, report date-range, etc. (this component is reused across essentially every money-entry flow per the source doc's own list) — hits one focus stop per field where the page shows no indication of where focus is. This is a WCAG 2.4.7 (Focus Visible) failure, live and reproducible on every DateField instance in the product.

**Root cause, precisely:** missing `tabIndex={-1}` on the `sr-only` native date input at `DateField.tsx:78`. Screen-reader users are already served correctly (the input has a real accessible name — `aria-label="{label} (calendar picker)"` — and Chrome exposes native date-input sub-widgets, e.g. month/day/year spinbuttons, to assistive tech regardless of visual clipping), so removing it from the *tab* order specifically (while keeping it in the *accessibility tree*, e.g. via `tabIndex={-1}` rather than `aria-hidden`) would fix this without regressing screen-reader access.

### F-4 · MP-06 (missing `showPicker()` fallback): source-confirmed, live reproduction inconclusive — ⚠️ INCONCLUSIVE (tooling limitation, not a clean bill of health)

**Source** (`DateField.tsx:67-73`): the visible weekday button's `onClick` is `if (typeof inputRef.current?.showPicker === "function") inputRef.current.showPicker();` — no `else` branch. If `showPicker()` is unavailable, undefined, or throws (Safari's support and behaviour for `showPicker()` has historically lagged Chromium's), **the button does nothing at all**, and there is no fallback (e.g. `.focus()` + synthetic click, or a visible native `<input>` fallback).

**Live check:** this session's Chromium build (151) does implement `showPicker()`, so the "missing" branch could not be triggered here. Clicking the visible date button produced no visible native picker overlay in the automated/CDP-driven browser and no console error — but CDP-automated Chrome is known to not always render OS-level native picker overlays the way a real user session does, so this result is **inconclusive rather than a pass**: it neither confirms the picker opened correctly nor confirms MP-06's failure branch.

**Status:** Real-device verification (actual iPhone Safari, actual Android Chrome) is required to resolve this one way or the other — this is exactly the class of finding `LIVE-TEST-PLAN.md`'s own precedent (LT-3, the 360px trip-form layout claim) already flags as unresolvable without a real device.

### F-5a · MP-08 could not be tested live — blocked by a separate, real gap: no UI path attaches an advance to a trip — 🚧 BLOCKED (root cause identified, not fixed)

**Goal:** Reproduce MP-08's watch item — a `Dialog` (for the `TRIP_ADVANCE_UNSETTLED` block, INV-17) rendered inside `CloseTripSheet`'s `Sheet`, checking for a z-index/stacking or focus-return problem when both are open.

**Blocker:** `CloseTripSheet.tsx`'s `isAdvanceBlock` only becomes true after the close-trip API call fails with `TRIP_ADVANCE_UNSETTLED` — which requires a trip that already has an unsettled `advance` row against it. Reading `web/src/features/people/AdvanceSheet.tsx`'s own doc comment: *"No trip picker — `tripId` is optional on the [advance model] and the missing half [is not built]."* The only client UI for recording an advance (`DriverDetailScreen` → "Driver money" → "Record an advance") never sets `tripId` — it's driver-scoped only. There is no other screen that lets a user attach an advance to a specific trip.

**Consequence, stated plainly:** `TRIP_ADVANCE_UNSETTLED` cannot currently be triggered through the product by any user, on any device, in any role — the whole INV-17 close-blocking mechanism (and by extension `CloseTripSheet`'s advance-block `Dialog`, and MP-08's stacking concern) is **live but practically unreachable dead code** on the client today. This isn't itself new — the source doc already notes "the wireframe's own 'offers the reconciliation inline' is not built" — but this session confirms the precondition is unreachable by any means short of a direct API call, which this session correctly declined to make (no service credentials, extracting the signed-in user's session token was already blocked by the environment's own safety classifier earlier in this engagement).

**What this means for MP-08 itself:** genuinely inconclusive, not cleared. The stacking/focus risk described in the source doc may or may not be real — nobody can find out through the browser until either (a) a trip-scoped advance-entry path is built, or (b) someone with API/DB access seeds the precondition directly (e.g. an integration test, which is exactly how the equivalent LT-6a testing gap was handled in the 8 August session).

### F-6 · "Where is our cash" report mislabels a driver deposit as "Held for customers" — ✅ CONFIRMED (accuracy)

**Context:** B4 Wave 2 (`GAP-70`/`GAP-71`) landed since the previous session and shipped a full `/reports` catalogue, including "Where is our cash" (UC-75). This is a welcome, genuinely useful new screen — it correctly surfaces the Rs 500 driver advance recorded against Sunil Perera in the *previous* session under "With drivers, as advances" (a clean regression-confirmation that GAP-70/71 works, and that the driver-money actions from the 8 Aug session persisted and roll up correctly).

**The bug:** the same screen also shows a line "Held for customers — Rs 1,000 held for customers, a liability, not partner cash." The only Rs 1,000 deposit that exists anywhere in this business's data is the **driver** deposit recorded against Sunil Perera in the 8 Aug session (`POST /api/deposit`, driver-scoped, confirmed at the time). There is no customer deposit anywhere in the test data.

**Verified via API response** (`GET /api/reports/cash-position`): `{"depositsHeldMinor":"100000", ...}` — the server returns a single, **party-type-agnostic** total (`depositsHeldMinor`), with no breakdown by customer vs. driver anywhere in the payload. The client is the one that renders the hardcoded label "Held for customers" regardless of whose deposit it actually is.

**Why this matters, per this project's own stated rules:** `CLAUDE.md` names reserved vocabulary and precise labelling as load-bearing specifically because a wrong-but-plausible label is worse than an admitted gap — a manager reading "Rs 1,000 held for customers" has no way to know that money is actually a driver's deposit, which matters directly if that driver later disputes what's owed to them, or if the business tries to reconcile "money we hold for X" against X's own records.

**Root cause — confirmed against source, both sides:**
- **Server is correct by design.** `api/src/queries/reports.ts:465-475` (`sumDepositsHeld`) queries the `deposit` table filtered only by `businessId` and `status IN ('held','hold_window')` — no party-type filter or grouping at all, and the function's own doc comment explains this is intentional: "the liability shown *beside* the cash position (§6.13), never netted into `listPartnerCashPositions`'s own figure." One combined liability total is the correct API shape.
- **Client hardcodes the wrong label in three places**, all in `web/src/features/reports/CashPositionReportScreen.tsx`:
  - line 66 — the stacked-bar chart segment's label: `formatter={() => "Held for customers"}`
  - line 132 — the caption under the chart: `` Rs {format(deposits)} held for customers — a liability, not partner cash. ``
  - line 140 — the table-view caption: `` Held for customers (deposits): <Money value={deposits} /> ``
- **The existing unit test locks the bug in as "correct."** `CashPositionReportScreen.test.tsx:23` — `expect(screen.getByText(/50,000 held for customers/)).toBeInTheDocument();` — asserts the wrong wording as the expected behavior, so this will not be caught by CI as currently written; the test would need its assertion changed, not just the component.
- This is the same failure shape TRACKER.md already names once before (GAP-75): "the fix... Both tests that had pinned the bug... inverted to assert the real figure" — a test that encodes a wrong assumption as a passing expectation, rather than one that would fail loudly if the assumption were ever corrected.

### F-5 · MP-01 confirmed live: DateField's three-control layout, doubled on range screens — ✅ CONFIRMED (P2 UX, visual)

Screenshot of the trip-booking form at 390×844 (see F-3's investigation) shows exactly what the source doc describes: `Today` chip, `Yesterday` chip, and a separate "Mon 10 Aug" button — three controls for one value — rendered twice in immediate succession for Start date and End date. Visually confirms MP-01 without further investigation needed; the fix (make shortcuts opt-in via a `quickPresets` prop, single default picker) is already scoped in the source doc.
