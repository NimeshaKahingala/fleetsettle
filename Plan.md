# Implementation plan — the remaining web build-out

**Not a specification, and not a record.** `docs/` says what to build and why; [TRACKER.md](TRACKER.md) says what is done; this says what remains, in what order, and what each phase actually has to touch. Where the three disagree, `docs/` is right, then `TRACKER.md`, then this.

**Written 4 August 2026**, from commit `df1df87` — Web-P6 complete in full, backend complete through P13.

**Updated 4 August 2026** — Web-P7 (row 1) is done; see [TRACKER.md](TRACKER.md)'s own entry for the full account. One thing that entry surfaces and this plan didn't anticipate: **F-5.2/F-5.3 (a trip's own costs/advances and customer money) were never wired into any domain code** — no obligation is ever raised for a trip's `agreedAmountMinor`, so there is nothing an ordinary payment could allocate against. This has no scheduled home in phases 2–9 below; it is backend design work (deciding *when* the receivable posts, matching W-41's closing-date precedent) plus a small frontend piece, roughly the size of Web-P8a. Not scheduled here — flag it to the owner before deciding where it slots in.

**Updated 4 August 2026 (later same day)** — Web-P8b (row 3) is done; see TRACKER.md's own entry. One correction this pass made to the plan itself: **there is no `ExpenseListScreen`** — UI §3.3's route map has no business-wide costs route, so it was not built; the new `GET /api/expense` still shipped (real value regardless of caller) but its screen was F-3.1/F-3.3's sheets, reached from `＋` and from a vehicle's own menu, not a list screen. Session stopped here by owner instruction — Web-P8c has **not** been started.

**Scope: web only.** R2 presigned uploads are deliberately out (see "Skipped by decision"). Per-vehicle capability scoping is backend hardening and is also out, with its cost recorded below.

---

## The finding that shapes every phase below

**This backend is write-complete and read-thin, and the gap is much larger than it looks.** Checked route-def by route-def, not assumed:

| Resource | What exists | What a screen needs |
|---|---|---|
| `incident` | `POST`, `GET /{id}`, 6 write paths | **no list** |
| `ownership_share`, `capital_contribution`, `management_fee_agreement`, `banking_event`, `partner_payout` | `POST` only, all five | **no reads at all** |
| `advance`, `deposit`, `write-off`, `payment`, `adjustment`, `offset`, `post-closure-charge` | `POST` only | **no reads at all** |
| `expense` | `POST`, `POST /{id}/void` | only the vehicle-scoped `GET /api/vehicle/{id}/expense` |
| `trip` | `GET /`, `GET /{id}`, book, close, cancel | ✅ complete |
| `reports` | nine `GET`s | ✅ complete |
| `driver-view` | `GET /` | ✅ complete |

This is the identical pattern Web-P2 and Web-P5 each hit and closed with a backend increment before the screen existed, and Web-P6a hit again. **Assume every Web-P8 phase opens with a read increment**, sized in each section below. Web-P7, Web-P9 and Web-P10 are the three that don't need one — which is most of why Web-P7 goes first.

---

## Order, and why

1. **Read increments are the real cost**, so phases with none go first — a phase that is pure assembly finishes in a session; one that opens with five new endpoints does not.
2. **Cross-cutting last.** Offline wraps every screen; building it early means rebuilding it per screen.
3. **Blockers least priority**, per instruction — Asgardeo (Web-P12) stays at the bottom regardless of readiness.

| # | Phase | Read increment | Notes |
|---|---|---|---|
| 1 | ✅ **Web-P7** — Trips | none, plus one small increment found along the way | Done — see TRACKER.md |
| 2 | ✅ **Web-P8a** — Incidents | 2 endpoints, not the 1 planned | Done — see TRACKER.md |
| 3 | ✅ **Web-P8b** — Costs and quick-add | 1 endpoint (`GET /api/advance` skipped — no caller this phase) | Done — see TRACKER.md |
| 4 | **Web-P8c** — Partners, banking, cash | **~4 endpoints** | Largest — **next** |
| 5 | **Web-P8d** — Close the month, corrections | 1–2 endpoints | |
| 6 | **Web-P9** — Review shell and reports | none | |
| 7 | **Web-P10** — Mine shell | none | |
| 8 | **Web-P11** — Offline and the PWA | n/a | |
| 9 | **Web-P12** — Real Asgardeo | n/a | 🔴 Blocked |

---

# 1 · Web-P7 — Trips (F-5.x) ✅ Done

See [TRACKER.md](TRACKER.md)'s own Web-P7 entry for the full account — what was built (`BookTripScreen`, `TripDetailScreen`, `CloseTripSheet`/`CancelTripSheet`, the calendar tap-through's B/C half, Home's trips-in-progress rows made tappable), the one small backend increment (`GET /api/trip/{id}/expense`), the `tripResponseSchema` fix (closing date/cancel reason/disposition were fetched but never projected onto the wire), and the `CreateDriverForm` fix that made the driver-trip-fee prefill real. The one open item it surfaced — F-5.2/F-5.3 never wired — is called out above and is not yet scheduled.

---

# 2 · Web-P8a — Incidents (F-3.4) ✅ Done

See [TRACKER.md](TRACKER.md)'s own Web-P8a entry for the full account. Two divergences from what this plan assumed, both deliberate:

- **No `IncidentListScreen`, and no flat `GET /api/incident` list.** UI §3.3's own route map has no list route for incidents at all — only `/incidents/:id`, the container — mirroring how `/trips/:id` has no list route either (Web-P7 hit the identical shape). Incidents are reached the way trips are: from the owning vehicle's own overview. The read increment became **vehicle-scoped** (`GET /api/vehicle/{id}/incident`, mirroring Web-P5's other vehicle-scoped reads) rather than the business-wide list first assumed here.
- **A second, unplanned endpoint** — `GET /api/incident/{id}/expense` — because the container's own "Repairs" step needed the itemised list behind `sumIncidentCostMinor`'s total, the identical gap Web-P7 closed for trips with `GET /api/trip/{id}/expense`.

Every other trap this section named held: the container stayed a container (nothing here is a step), the off-road treatment is a real three-way choice, `status` is never advanced automatically, the bottom line is a live snapshot recomputed per read, and damage photos are not built (no R2, per the plan's own scope decision).

---

# 3 · Web-P8b — Costs and quick-add (F-3.1, F-3.2, F-3.3, M-4) ✅ Done

See [TRACKER.md](TRACKER.md)'s own Web-P8b entry for the full account. Two divergences from what this plan assumed, both deliberate:

- **No `ExpenseListScreen`.** UI §3.3's own route map has no business-wide costs route — `/vehicles/:id` already owns "costs" (Web-P5, per-vehicle), and §3.1 puts F-3.1/F-3.3 under the `＋` tab, never a list. The plan's own guess was wrong; `docs/` won. `GET /api/expense` still shipped — it's real, independent value — but its callers are `RecordExpenseSheet`/`FuelFillSheet`, not a list screen.
- **Quick-add ships 3 of M-4's 5 actions** (Fuel, Expense, New trip). Payment received/Payment made are real, separately-sized features with no business-wide party picker to open against yet — left off the rendered list rather than wired to a dead tap; `ActionSheet` never filters what it's given, so growing the list later is additive, not a rework.

Every other trap this section named held: `BorneByPaidBy` composes two independent pickers (never collapsed), the `borne_by` matrix is never recomputed client-side (the server default is simply left unsent unless overridden to "Us"), a blank vehicle is a valid overhead cost, and a voided expense stays visible and struck through. Fuel-fill's odometer/trip-link fields are not built (no domain wiring for `expense.odometer_reading_id` exists anywhere yet) — recorded in TRACKER.md rather than half-built.

---

# 4 · Web-P8c — Partners, banking and cash (F-1.3, F-1.4, F-7.x)

**The largest phase, and entirely because of its read increment.** All five partner resources are POST-only; this phase has to build the reads before it can render anything at all.

**Backend increment** — roughly four endpoints: **`GET /api/ownership-share`** (current shares, effective-dated), **`GET /api/capital-contribution`**, **`GET /api/management-fee-agreement`**, **`GET /api/banking-event`**. `GET /api/reports/cash-position` already covers F-7.5 and should not be duplicated. F-7.6's partner current account has no read and no obvious host — decide deliberately whether it belongs here or in Web-P9 as a tenth report.

**Screens** — `web/src/features/partners/`: `PartnerListScreen`, `PartnerDetailScreen`, `OwnershipSharesForm`, `CapitalContributionSheet`, `ShareVehicleForm` (F-1.4), `BankingEventForm`, `CashPositionScreen`.

**Traps:**
- **Shares are a deferred constraint.** All rows in one call, sharing one `effectiveFrom` — a 60/40 split is one legal multi-row write; the trigger fires once at commit. The form submits the whole set at once, never row by row, and surfaces `OWNERSHIP_SHARES_INVALID` as a 400 rather than pre-checking the sum client-side.
- **Capital is not ownership** (W-52). What a partner paid and what he owns are two facts; never render one as the other, and never show a derived "gap" figure this backend does not compute.
- **An overlapping management agreement is a 409** from an `EXCLUDE` constraint. Revoke sets `effective_to`; it never deletes, and a revoked manager's records stay attributed to them.
- **The banking discrepancy's bearer is required exactly when recorded ≠ counted**, and the form must only ever offer `absorbed` / `unattributed` — the third enum value means the shortfall was traced to a receipt and corrected there instead (F-8.2), so it can never arrive through this form.
- **Never net two balances** (W-2), here as anywhere.
- **The capability is a flat stand-in.** `managePartnerCapital` is business-wide; an `owner_manager` shared one vehicle currently reaches every vehicle's capital. Recorded in [policy.ts](api/src/auth/policy.ts) since P7 and still open — **do not build UI that implies per-vehicle scoping exists.**

**Done means** — a 60/40 split saves in one write and is readable back; a shared vehicle with a monthly fee grants and revokes; `npm run check` clean.

---

# 5 · Web-P8d — Close the month and corrections (F-9.1, F-8.x)

**Backend increment** — small. `GET /api/accounting-period/checklist` and `GET /api/audit-log/{table}/{id}` both already exist. Needs a **`GET /api/write-off`** list, and possibly a period list (to show which months are closed).

**Screens** — `web/src/features/period/`: `CloseMonthScreen`, `CorrectPaymentSheet`, `WriteOffSheet`, `PostClosureChargeSheet`, plus `Timeline` finally wired to real `audit_log` data.

**Traps:**
- **The checklist warns and lists; it never blocks** (U-7). Open trips, unreconciled advances, pending obligations and open incidents are all information — the close button stays enabled.
- **Closing opens the successor period** in the same transaction. The screen must make clear that this is what happened, since every later write depends on it.
- **A correction's `bearer` is the whole decision** — `back_to_arrears` puts the party back in arrears (INV-22), `absorbed_loss` leaves their due settled and the business eats it. Two different outcomes from one form; the copy must say which is which without using the word "allocation".
- **A waiver and a write-off never share a bucket** (W-28). Separate entry points, separate reporting, never one combined "reduce this due" control.
- **Void-and-replace exists for `expense` only.** Do not offer it on the other twelve tables; the mechanism is proven, not each instance of it.
- **`PERIOD_CLOSED` comes from the trigger**, never a client pre-check. Catch it and explain it.

**Done means** — a month closes end to end with its successor open; a correction moves a party back into arrears and the audit trail shows who did it; `npm run check` clean.

---

# 6 · Web-P9 — The Review shell and reports (UC-70…79)

**Nine tested endpoints and no interface. The partner whose entire use of this product is reading reports has nothing until this ships.**

**Backend increment** — none. All nine exist, capability-gated and proven linked-driver-safe.

**Screens** — `web/src/features/reports/`: the Review shell's own tab set (`AppShell` already accepts `shell="review"` and renders it), a report catalogue, and one screen per report. Replaces the `NotBuiltYetScreen` placeholder.

**The one hard problem, and it needs deciding before any chart is drawn:** **money is `bigint` in the client and must never become a `number`, "not even for a chart axis"** ([web/CLAUDE.md](web/CLAUDE.md)). Recharts wants numbers. Resolve this deliberately — scale to a display unit at the very edge, in one place, with the conversion isolated and tested, exactly as the money codec is. Do not let a `Number(minor)` leak into a component.

**Traps:**
- **Two capability gates.** `viewReports` (STAFF) covers seven; `viewOwnerOnlyReports` (OWNERS) covers UC-77 and UC-79. The catalogue must not render a card the role cannot fetch — a 403 the user could have been spared is a bug.
- **Degrade to "not available", never zero** (W-56). `profitPerKm` and `kmPerLitre` come back `null` by design; `NotAvailable` and `Rs 0` must look different on screen.
- **The lost-day denominator is `ran + lost`** — display it as the backend computed it; do not recompute a percentage client-side.
- **No accounting vocabulary reaches the interface** (U-6) — no "accrual", "receivable", "allocation", anywhere in a report title or axis label.

**Done means** — all nine reports render from real data, correctly gated per role, both themes, 360×640; `npm run check` clean.

---

# 7 · Web-P10 — The Mine shell (F-6.8)

**Backend increment** — none. `GET /api/driver-view` has been ready since P12.

**Screens** — `web/src/features/mine/`: `MineScreen` — `TwoBalances`, his days including excused ones, closed trips and fees, advances, offsets, the held deposit, a Statement link. `AppShell` already accepts `shell="mine"` and renders no tabs for it.

**Traps:**
- **There is no `driverId` anywhere in this route, by construction** (INV-25). The client must never introduce one — not as a prop, not as a query param, not "for testing".
- **`TwoBalances` never nets** (W-2), and this is the screen where a driver would most want it to.
- **Excused days are included** (§7.9) — they are the thing he would otherwise argue about. Do not filter them out to tidy the list.

**Done means** — a linked driver's token renders exactly his own data and no request shape exists that could return anyone else's; `npm run check` clean.

---

# 8 · Web-P11 — Offline and the PWA

Cross-cutting, and last among unblocked work for that reason.

**Backend increment** — none.

**What lands** — TanStack Query persistence; the paused-mutation queue (M-12) replaying with a **fresh token per attempt**; a 401 on replay pausing and re-authenticating rather than discarding the mutation; the eviction warning while the queue is non-empty; the iOS "Add to Home Screen" hint; runtime caching (stale-while-revalidate reads), deferred from P0's shell-precache-only PWA.

**Traps:**
- **A discarded mutation is a lost money record.** Pause and re-authenticate; never drop.
- **`HomeScreen`'s skeleton branch becomes reachable for the first time** — Web-P3 built it correctly and recorded that its one trigger condition (a warm cache) could not occur before this phase. Verify it now, rather than assuming.
- **Side-by-side condition comparison** is listed here but needs photos, which need R2. Skipped with the rest.

**Done means** — four days confirmed on a Sunday with no signal replay silently on Monday, and the money lands once.

---

# 9 · Web-P12 — Real Asgardeo 🔴

**Blocked**, least priority, and unblocking it costs about ten minutes of console work: token type → JWT, binding → None, redirect URL cleanup. Nothing above waits on it — `web/src/lib/auth-stub.ts` exists precisely so phases 1–8 don't. Fire the console change early anyway; it has no cost and it is the last gate before anyone outside this repository can log in.

---

## Skipped by decision

**R2 presigned uploads** — deliberately out of scope. The cost, so it is a decision and not an oversight: condition photos at lease start (F-2.1 step 6) and at lease close (F-2.6 step 5) keep rendering `NotAvailable`; incident damage photos and expense receipts join them; `PhotoCapture` stays a component with no upload behind it; Web-P11's side-by-side condition comparison cannot be built. All five are the same one endpoint — `attachment` (DM §12) is already generic and polymorphic — so this stays a single, small, self-contained piece of work whenever it is wanted.

**Per-vehicle capability scoping** — backend hardening, out of web scope. Until it lands, an `owner_manager` shared one vehicle reaches every vehicle's capital, payouts and reports. It does not block any screen and closing it later forces no screen rework, since the endpoints do not change shape — but Web-P8c must not imply the scoping exists.

**Also out, and already recorded in [TRACKER.md](TRACKER.md):** UC-73 (yearly) and UC-99 (export), both product-phase Second · UC-79's `revenuePerAvailableDayMinor` · F-8.4's deposit-apply · void-and-replace for the other twelve W-50 tables · everything under "Not in this tracker".

---

## The bar every phase clears

The same one every phase since P2 has cleared, restated so no session has to go looking:

- **360 × 640, one thumb, no horizontal scroll**, and it still reflows at 320px.
- **Every create form saves with level-1 fields only** (U-2) — an automated test, not an intention.
- **44 × 44 minimum**, ≥ 8px apart, ≥ 16px when one is destructive.
- **Money is `string` on the wire, `bigint` in the client, never `number`.**
- **`Rs 0` and `NotAvailable` are visibly different things.**
- **No raw hex** — `--color-*` tokens only, and colour never carries meaning alone.
- **Reserved vocabulary, never abbreviated**, and no accounting words at all.
- `npm run check` clean across all three workspaces; new screens tested; `TRACKER.md` updated with the phase's own entry — what was built, what was found, what was deliberately not built and why, and a "Done means" carrying real test counts.

---

## When a phase here is finished

Write it up in [TRACKER.md](TRACKER.md), not here — same shape as every entry there. This file is a plan and goes stale; that one is the record. Tick the row off and move on.
