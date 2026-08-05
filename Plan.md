# Implementation plan — the remaining build, in two parallel tracks

**Not a specification, and not a record.** `docs/` says what to build and why; [TRACKER.md](TRACKER.md) says what is done and carries every open gap by id; this says what remains, in what order, and who can build it at the same time as whom. Where the three disagree: `docs/` first, then `TRACKER.md`, then this.

**Written 4 August 2026**, from `b2cf367` — backend complete through P13, frontend complete through Web-P8b. Validated route-def by route-def against `api/src/route-defs/` and screen by screen against `web/src/`.

**What changed from the previous edition.** It was a single serial queue of nine phases, each opening with its own backend increment and then building screens against it — so the frontend idled through every read increment and the backend idled through every screen. This splits the same work into **Track A (Worker + shared schemas)** and **Track B (React client)**, which is legal because of one rule the project already runs on, restated below. The old `Web-P8c…P12` numbering is retired; every item here carries a gap id from [TRACKER.md](TRACKER.md) §4 instead.

**Updated 5 August 2026**, `e7efa71` — the CI gap under "One thing that is not code" (below) is resolved; see [TRACKER.md](TRACKER.md) for the full account. Nothing on either track was ever blocked by it, but every PR into `main` is now actually tested for the first time.

**Updated 5 August 2026**, `2822193` — validated A2/A3/B2/B3 against the code rather than against this file, ahead of building them. Three things were wrong and are fixed below: **`/more` does not exist**, so B2 and B3 had no entry point (now **B0**, GAP-37) · **`GET /api/payment` does not exist**, so F-8.2 was unbuildable from any screen (now in A3, GAP-38) · **GAP-13 stopped being expensive when P13 shipped** and is now built in A3 rather than deferred a fifth time. A2's one open decision — F-7.6's host — is also **made**, and it closes GAP-4 by deriving rather than writing.

**Updated 5 August 2026 — A2 done.** Six endpoints, 25 new tests, full suite 31/353. B2's dependency is now only B0. One new gap recorded, **GAP-39** — W-53's management fee has never actually reduced vehicle profit; TRACKER.md §4 has the detail. A2's own write-up is below, under Track A.

---

## The rule that makes two tracks legal

> **The schema is the synchronisation point, and the main lever for parallelism.** Once a resource's Zod schema lands in `packages/shared`, the two tracks separate: the Worker builds against a real Neon branch, the client against mocks derived from *the same schema object*. Hand-mirrored types drift silently and what drifts is a money field (IG §2). So the schema is always a phase's first task, never its last.
>
> — TRACKER.md §1, rule 2

**The contract between the tracks, stated once:**

1. **Track A lands the Zod schema first**, in `packages/shared/src/schemas/`, in its own commit, before the query or handler exists. That commit is the handoff.
2. **Track B imports that schema object and mocks against it.** Never a hand-written interface mirroring it. The one exception already in the tree is `MeResponse` in `FirstRunGate.tsx`, and it is documented as one.
3. **Neither track edits the other's files.** `packages/shared` is Track A's to write and Track B's to read. If Track B needs a schema change, it asks; it does not add a field.
4. **Money is `string` on the wire in every schema either track writes.** Non-negotiable, and the reason clause 2 exists at all.

**Where the tracks actually contend:** `packages/shared/src/schemas/` (A writes, B reads — serialise via clause 1) and `web/src/app/router.tsx` (B only, but every B item touches it — expect merge conflicts there and nowhere else).

---

## Start here

**A2 is done** (below) — the A2 → B2 handoff is live: every schema B2 needs is in `packages/shared`. **Four Track B items need no backend work at all.** All nine report endpoints, `GET /api/driver-view`, and every offline prerequisite already exist, capability-gated and tested. That is what lets Track B start at full speed regardless of Track A's own pace:

| Track A next | Track B starts |
|---|---|
| **A3** — period, write-off and payment reads | **B4** — the Review shell and nine reports (the largest screen increment, zero backend dependency) |

**Before B2 or B3, `/more` must exist (B0).** It is half a day, needs no backend, and without it every screen those two items build is reachable only by typing a URL.

B2 can now start in parallel with A3 — it no longer waits on anything from Track A.

---

## Track A — the Worker and shared schemas

| id | Item | Gaps | Endpoints | Blocks |
|---|---|---|---|---|
| **A1** | ✅ Web-P8b's `GET /api/expense` | GAP-33 | 1 | — |
| **A2** | ✅ Partner, banking and cash reads | GAP-9, GAP-4, GAP-31 | 6 | B2 |
| **A3** | Period, write-off and payment reads | GAP-13, GAP-38 | 4 | B3 |
| **A4** | Customer-scoped reads | GAP-22 | 2 | B6 |
| **A5** | Driver history reads | GAP-24, GAP-29 | 1–3 | B5 (partly) |
| **A6** | The trip receivable — design resolved and settled | GAP-23 | 1 + a migration | — |
| **A7** | R2 presigned upload — unblocks five gaps | GAP-16 | 1 | B-photos |
| **A8** | Expense odometer wiring and borne-by override | GAP-30, GAP-32 | 0–1 | — |
| **A9** | **Soft delete, everywhere** — starts with a live defect | GAP-12, GAP-35, GAP-36 | ~15 + 2 migrations | — |

### A1 · Done

`GET /api/expense` shipped in `b2cf367` — every filter optional, newest first, voided rows included, `dailyOperations`. `expense.test.ts` at 20/20.

**It has no caller** (GAP-33), and that is deliberate: §3.3's route map has no business-wide costs route, so the plan's `ExpenseListScreen` was withdrawn rather than built. The endpoint keeps real value — report-adjacent, and every other list endpoint here has shipped ahead of its screen at some point. **Do not add a screen for it without a spec change.**

### A2 · Done

Six endpoints, all shipped: `GET /api/business-member` (GAP-31, `dailyOperations`) · `GET /api/ownership-share`/`capital-contribution`/`management-fee-agreement`/`banking-event`/`partner-payout` (`managePartnerCapital`, except banking-event which shares the write's `dailyOperations` gate) · the composed `GET /api/partner/{userId}` (F-7.6/F-7.3), closing GAP-9 and GAP-4 by derivation, never a write. 25 new integration tests (business-member 4, partner +16, partner-summary 5) in two new files; full suite 31/353, all green. TRACKER.md §2 carries the row.

**One design correction worth carrying forward:** `listOwnershipShares` filters `effective_to IS NULL` alone, not a "latest set per vehicle" grouping — `assert_shares_total`'s deferred trigger structurally forbids two open sets ever coexisting for one vehicle, so the simple filter is provably sufficient. A first draft over-built this; TRACKER §5 has the reasoning.

**One new gap, recorded rather than fixed: GAP-39.** `sumVehicleCostsForPeriod` already reads `obligation WHERE kind = 'management_fee'`, but nothing has ever written one — W-53's "management fee reduces vehicle profit" has been silently a no-op since P7. `GET /api/partner/{userId}` works around it correctly (reading `management_fee_agreement` directly), but UC-70's vehicle-profit figure is still wrong wherever a management fee applies. Unowned; needs a generator, not a read-side fix.

### A3 · Period, write-off and payment reads

**Small.** `GET /api/accounting-period/checklist` and `GET /api/audit-log/{tableName}/{recordId}` already exist and are tested.

**Endpoints** — `GET /api/accounting-period` (list, so a screen can show which months are closed) · `GET /api/write-off` (list) · **`GET /api/payment`** (GAP-38) · plus the checklist's `unconfirmedDays` count (GAP-13), which changes an existing response shape rather than adding a route.

**`GET /api/payment` is the one this item cannot ship without.** `POST /api/payment/{id}/correct` has existed since P9 and **no screen can reach it** — `queries/payment.ts` has no list function and no route exposes one, so there is no path from any interface to a payment id. F-8.2's first step is *"Open the receipt"*. Without this, B3's `CorrectPaymentSheet` has nothing to open and the whole correction half of B3 is unbuildable. It carries **the linked-driver test class** — payments name drivers.

**GAP-13 is now cheap, and should be built here rather than deferred again.** TRACKER's standing reason for leaving it — an unconfirmed day is "indistinguishable from a day the pattern never scheduled without replaying it" — was true when it was written and is not true after **P13**. `generate-day-cards` only generates cards for pattern days, so a `day_record` row in `state = 'open'` *is* a scheduled-but-unconfirmed day: one `COUNT(*)` scoped to the open period. UI §7.7 lists unconfirmed days as the checklist's **first row**, so B3 cannot render its own spec faithfully while this is missing. It under-reports if the cron has not run — which is honest, warn-only, and exactly what U-7 permits.

**Trap** — the checklist **warns and lists; it never blocks** (U-7). Nothing in it is an invariant the schema does not already refuse structurally. Do not add a `canClose` boolean; there isn't one.

**Explicitly out of scope: GAP-12.** Void-and-replace stays `expense`-only. The other twelve W-50 tables carry the `voided_*` trio structurally, but a domain function and endpoint per table is real additional work, and the mechanism is proven rather than each instance of it.

### A4 · Customer-scoped reads — closes GAP-22

**The gap that fell through four phases.** `/people/customers/:id` renders a placeholder; §3.3 specifies dues, payments, statement.

**Endpoints** — `GET /api/customer/{id}/obligation` and `GET /api/customer/{id}/payment`.

**Read `findObligationsForLease` (Web-P6a) before writing either.** It is the same shape of problem solved once already — except `obligation` carries `party_type`/`party_customer_id`, so a customer's dues are reachable **directly by party**. That makes this simpler than the lease case, not harder; the lease query is the reference for the guarded-`OR` and never-`inArray`-on-empty conventions, not for its three-way reassembly.

**Trap** — `findOutstandingObligationsForParty` already exists and is what `recordPayment` allocates through. Reuse it rather than writing a second party-scoped obligation query, or the screen and the allocator will disagree about what is outstanding.

### A5 · Driver history reads — closes GAP-24 and GAP-29

`DriverDetailScreen` shows two balances and nothing else; `driverBalancesResponseSchema` has no breakdown, so `TwoBalances` is fed `"—"` for both detail lines. `GET /api/advance` was deliberately skipped in Web-P8b for want of a caller — this is the caller.

**The thing to notice before writing anything:** `GET /api/driver-view` (P12) already returns exactly this data — days including excused ones, closed trips and fees, advances, offsets, held deposit. **It cannot be reused.** It is gated by `viewOwnData`, restricted to the `driver` role alone, and **INV-25 is structural** — there is no slot in that route for a caller-supplied driver id, by construction. A manager-facing equivalent is a genuinely separate route with a genuinely different gate.

**Endpoints** — `GET /api/driver/{id}/advance`, `/deposit`, `/day` (or one composed read mirroring `driver-view`'s shape but keyed by an explicit, business-scoped `{id}`), gated `dailyOperations`.

**Trap — this is the W-49 test class's sharpest case.** A route that takes a `driverId` and returns a driver's money is exactly what INV-25 prevents on the driver's own route. It is legitimate here because the caller is staff and the id is business-scoped — but **a linked-driver token must 403 it outright**, and that test is not optional.

### A6 · The trip receivable — closes GAP-23

F-5.2/F-5.3 were never wired: `bookTrip` raises no obligation for a trip's `agreedAmountMinor`, so there is nothing an ordinary `POST /api/payment` could allocate a customer's trip payment against — the whole amount comes back as `unallocatedMinor` and floats, attached to nothing. `TripDetailScreen`'s "Received" row is `NotAvailable` naming this exact reason.

**The design is resolved. Read this before assuming the obvious precedent applies — it does not.**

An earlier edition of this plan said W-41/INV-30 set the precedent (the driver-fee obligation posts at close, so the customer side must match). **That reasoning does not transfer**, because the two facts live in different places, verified query by query:

- `sumVehicleEarnedForPeriod` reads trip income **straight off the trip row** — `trip.agreedAmountMinor WHERE trip.postedPeriodId = period AND trip.status = 'closed'` — and `closeTripRow` sets `posted_period_id` **only** at close (its own doc comment: "trip income and cost recognise on close, never on booking"). **INV-30 is enforced by the trip row and does not depend on an obligation existing at all.**
- That query's obligation branch filters `kind IN ('rent','daily_amount','mileage_excess')`, so a trip obligation **cannot** double-count income, whatever kind it takes.
- `listReceivables` is kind-agnostic, so a trip obligation appears correctly as a customer receivable the moment it exists.

So posting the receivable at booking violates neither W-41 nor INV-30, and F-5.3 pushes for it: *"advance at booking, balance at the end… partial payments accumulate as owed by the customer."* **Posting at close makes F-5.3's primary case unrepresentable** — money arrives before anything exists to receive it.

**Build it this way:**

- **Post the obligation at booking**, inside `bookTrip`'s existing transaction. Income still recognises at close, from the trip row; the obligation is a balance fact, not a P&L one.
- **`kind`: add `trip_fare`** via a forward-only migration (`DROP` then `ADD` the CHECK constraint). **Not `'other'`** — `ctx.createObligation()`'s own default is `kind: 'other'` (P11's entry records the report queries this already confused), so real trip fares would be indistinguishable from fixture noise in exactly the reports that filter on kind.
- **`source_type: 'trip'`, `source_id: tripId`** — no migration needed; the `0001` DDL comment already names `'trip'`.
- **`due_on`/`effective_due_on`: the trip's end date**, not the closing date, which is unknown at booking. This is what keeps UC-78's ageing from marking the due late before the trip has even run.
- **`posted_period_id`: the period open at booking.** Settling it after that period closes is already legal — migration `0006` fixed exactly this case.
- **On cancel: void the obligation.** `obligation` carries the `voided_*` trio and `listReceivables` already filters `isNull(voidedAt)`. This is the one piece of extra work posting at booking costs, and it is small.
- **The read: `GET /api/trip/{id}/obligation`** — simpler than its lease equivalent, since `source_id` is the trip id directly. One query, not Web-P6a's three-way reassembly.

**Settled by the owner, 5 August 2026: bookings are firm.** Posting at booking creates a receivable for a service not yet delivered, which is correct precisely because a booking here *is* a commitment the customer owes on — confirmed against the absence of any cancellation-fee concept in F-5.1, and consistent with GAP-7's record that the `hold` state (ST-5) was never built, so no booking in this system was ever provisional. Post at booking; no alternative branch remains to design for.

The consequence worth stating once: **a cancelled trip must void its obligation**, or a customer keeps owing for a charter that never ran. That is the one piece of work this choice adds, and it is in the build list above.

### A7 · R2 presigned upload — closes GAP-16

**One endpoint unblocks five recorded gaps**: condition photos at lease start and close, incident damage photos, expense receipts, and the side-by-side comparison. `attachment` (DM §12) is already generic and polymorphic; `PhotoCapture` and its tested `photo-pipeline.ts` are built and have **0 real callers**.

Skipped by decision in the previous edition and still skippable — but it is the highest ratio of unblocked surface to work on either track, and it is pure Track A. Worth re-deciding rather than inheriting.

### A8 · Expense odometer wiring and borne-by override

Two small gaps Web-P8b surfaced and recorded rather than guessed at. **Neither blocks a Track B item**; both make a shipped form more complete.

- **GAP-30** — `expense.odometer_reading_id` has been a DB column since P3 and has never been wired through any schema, query or domain layer (unlike `trip.opening_odometer_id`, which P6 wired). It blocks fuel fill's odometer and trip-link fields, both level 2. **The real decision: does a fuel fill create its own `odometer_reading` row transactionally?** That is what makes this design work rather than plumbing.
- **GAP-32** — borne-by can only be overridden to "Us". Overriding to a specific driver or customer other than the vehicle's current party needs either a live preview endpoint or a second "who currently holds this vehicle" lookup. **Do not solve it by copying §6.7's matrix into the client** — that is the one thing Web-P8b's trap list forbids outright.

### A9 · Soft delete, everywhere — closes GAP-12, GAP-35, GAP-36

**Nothing in this system is ever hard-deleted, and that must not change.** But a record created by mistake — a test expense, a duplicate driver, a vehicle typed twice — currently has no way out of most tables, and the one table that does have a way out has a hole in it. This item makes "undo" uniformly available without ever removing a row.

**The rule, stated once:** soft delete only. A money record is **voided** (`voided_at`/`voided_reason`/`voided_by`, with a reason always required — W-50). An entity is **archived** (hidden from pickers and lists, still resolvable by id so historical records that reference it keep rendering). `audit_log` stays undeletable by its own `DO INSTEAD NOTHING` rule, and `accounting_period` is not soft-deletable at all — closing is a structural transition, not a record.

**Where things actually stand, verified table by table:**

| Layer | Mechanism | State |
|---|---|---|
| 13 money tables | the `voided_*` trio | structural on all 13; only `expense` has a domain function and endpoint (GAP-12) |
| `trip`, `lease`, `incident` | `status` transitions | built (F-5.5, F-2.6, F-3.4) |
| `mileage_package` | `archived_at` + endpoint | built — the reference implementation for an entity |
| `business_member` | `revoked_at` | built |
| `vehicle` | `lifecycle` column exists | **no endpoint ever sets it** — hardcoded `"active"` at creation, read-only thereafter |
| `driver`, `customer` | — | **no column at all** (GAP-36); a test row is permanent |
| `audit_log` | `DO INSTEAD NOTHING` | correct as-is; never make this deletable |

**GAP-35 is a live defect, not a missing feature, and it should be fixed first.** Migration `0006` made `assert_period_open()` return early on any `UPDATE` that leaves `posted_period_id` untouched — correct for its own case (settling a claim months later), but a void sets only `voided_at`, so **voiding a record posted into a closed month is not blocked by anything.** `voidExpense` has no period check either. Today that means voiding a July expense after July closes silently changes July's reported costs — the exact "wrong, plausible, unnoticed for months" failure this project exists to prevent. Rolling void out to twelve more tables without fixing it first would multiply the hole by thirteen.

**Fix it in the trigger, not in thirteen domain functions.** CLAUDE.md is explicit that the period-open trigger is the truth and two implementations of one rule diverge. Extend `assert_period_open()` so it also enforces on an `UPDATE` that transitions `voided_at` from `NULL` to non-`NULL`; every table the trigger already covers is then guarded at once, and a void in a closed period surfaces as the same `PERIOD_CLOSED` every other blocked write already returns. A correction after close goes through the F-8.x post-closure path instead, which is what those flows are for.

**Then the rest, in order:**
1. **The migration above**, plus a test proving a void into a closed period is refused and one into the open period still succeeds.
2. **`archived_at` on `driver` and `customer`** (GAP-36), plus archive/unarchive endpoints. `mileage_package`'s "archive, never delete" is the pattern — copy it rather than inventing a second one.
3. **A `POST /api/vehicle/{id}/archive`** driving the `lifecycle` column that has existed since `0001` and never moved.
4. **Void endpoints for the remaining twelve money tables** (GAP-12), each mirroring `voidExpense`'s proven shape: find-scoped-to-business → 404, already-voided → its own error, then a `writer.transaction` (never a bare update, or `changed_by` records `NULL`).

**Traps:**
- **A void is a money write.** It must open a transaction even though nothing needs atomicity, or `withActor` cannot attribute it (TRACKER.md §5).
- **Voiding a parent does not void its children.** Voiding a `payment` leaves its `payment_allocation` rows, and the obligations they settled, exactly as they were — cascading is a second rule that will diverge from the first. Decide per table whether the domain function unwinds, and record the decision; `correctPayment` (P9) already solved this shape for payments and should be reused rather than duplicated.
- **A voided row stays visible, struck through, with its reason** (W-50) — `VehicleOverviewScreen`'s costs section and the vehicle/trip/incident expense lists already do exactly this. Reuse the treatment.
- **An archived entity must still resolve by id.** A voided expense that references an archived driver has to keep rendering his name; archiving hides him from pickers, it does not orphan history.
- **Never offer this as "Delete."** U-6's reserved vocabulary applies — the interface says "Void" for a money record and "Archive" for an entity, and says which one it means.

**Done means** — a test expense, driver, customer and vehicle each created by mistake can all be reversed out of every list they appear in, none of them leaves the database, a void into a closed period is refused by the trigger, and every one of those reversals names who did it in `audit_log`.

**Track B's half** is small and can follow whenever: a void/archive action on the existing detail screens, using the struck-through treatment that already exists. Not a separate B item — it belongs to whichever screen owns the record.

---

## Track B — the React client

| id | Item | Needs | Status |
|---|---|---|---|
| **B0** | **The `/more` hub** (GAP-37) | **nothing** | ▶ start now — **B2 and B3 are unreachable without it** |
| **B4** | Review shell + nine reports | **nothing** | ▶ start now |
| **B5** | Mine shell | **nothing** (A5 for the staff-side twin) | ▶ start now |
| **B7** | Offline and the PWA | **nothing** | ▶ startable, sequence last |
| **B2** | Partners, banking, cash | B0 (A2 ✅) | ▶ ready once B0 lands |
| **B3** | Close the month, corrections | A3, B0 | waits |
| **B6** | Customer detail | A4 | waits |
| **B8** | Real Asgardeo | — | 🔴 blocked externally |
| ~~B1~~ | ~~`ExpenseListScreen`~~ | — | **withdrawn** — see below |

### B0 · The `/more` hub — closes GAP-37, and both waiting B items need it

**Missed by the previous edition, and it gates two of them.** `/more` renders `NotBuiltYetScreen` (`router.tsx`), and §3.1 puts **Cash, reports, period close, settings, message log, business** behind that tab. §3.3 gives `/cash`, `/partners/:id`, `/reports` and `/period/close` **no other entry point** — the tab bar has five fixed slots and none of them is "Cash". So every screen B2 and B3 build is reachable only by typing a URL until this exists.

Small: one screen, a list of rows, no backend increment. **Rows for what exists only** — a row leading to `NotBuiltYetScreen` is worse than no row. Reports appears when B4 lands, Cash when B2 does, and so on.

**Trap** — the close-month row is **absent for a `manager`, not disabled** (M-22/W-49, the same rule §7.7 states for the close action itself).

### B1 · Withdrawn, and why

The previous edition named an `ExpenseListScreen` for Web-P8b. **It was not built, correctly.** UI §3.3's route map has no business-wide costs route at all: `/vehicles/:id` already covers costs per-vehicle (Web-P5, read-only), and §3.1 puts F-3.1/F-3.3 under the **`＋` Add** tab — "not a destination, no route change" — never under a list screen. `docs/` outranks the plan.

Recorded rather than quietly dropped, so the same screen is not proposed a third time. `GET /api/expense` keeps its own value and its own gap id (GAP-33).

### B4 · The Review shell and nine reports — start now

**Nine tested endpoints and no interface. The partner whose entire use of this product is reading reports has nothing until this ships** — `FirstRunGate` sends the `owner` role to `NotBuiltYetScreen` today.

**Backend increment: none.** All nine exist, capability-gated, proven linked-driver-safe in one loop.

**Screens** — `web/src/features/reports/`: the Review shell's own tab set (`AppShell` already accepts `shell="review"` and renders it), a report catalogue, one screen per report. New routes `/reports` and `/reports/:key`.

**The one hard problem, and it needs deciding before any chart is drawn:** money is `bigint` in the client and **must never become a `number`, "not even for a chart axis"** ([web/CLAUDE.md](web/CLAUDE.md)). Recharts wants numbers. Resolve it deliberately — scale to a display unit at the very edge, in one place, isolated and tested exactly as the money codec is. Do not let a `Number(minor)` leak into a component. The backend already solved this twice for *ratios* (`profitPerKm`, `kmPerLitre` each carry their own lint disable and a recorded reason); follow that precedent rather than inventing a third convention.

**Traps:**
- **Two capability gates.** `viewReports` (STAFF) covers seven; `viewOwnerOnlyReports` (OWNERS) covers UC-77 and UC-79. **The catalogue must not render a card the role cannot fetch** — a 403 the user could have been spared is a bug.
- **Degrade to "not available", never zero** (W-56). `profitPerKm` and `kmPerLitre` come back `null` **by design**; `NotAvailable` and `Rs 0` must look different on screen.
- **The lost-day denominator is `ran + lost`.** Display it as the backend computed it; never recompute a percentage client-side.
- **No accounting vocabulary reaches the interface** (U-6) — no "accrual", "receivable", "allocation" in any title or axis label.
- **GAP-19**: UC-79 ships without `revenuePerAvailableDayMinor`. Do not draw an axis for a figure the endpoint does not return.

**Done means** — all nine render from real data, correctly gated per role, both themes, 360×640.

### B5 · The Mine shell — start now

**Backend increment: none.** `GET /api/driver-view` has been ready since P12.

**Screens** — `web/src/features/mine/`: `MineScreen` on `/me` — `TwoBalances`, his days including excused ones, closed trips and fees, advances, offsets, the held deposit, a Statement link. `AppShell` already accepts `shell="mine"` and renders no tabs for it. Replaces `FirstRunGate`'s `driver` → `NotBuiltYetScreen` branch.

**Traps:**
- **There is no `driverId` anywhere in this route, by construction** (INV-25). The client must never introduce one — not as a prop, not as a query param, not "for testing". The endpoint has no slot for it; keep it that way on this side too.
- **`TwoBalances` never nets** (W-2), and this is the screen where a driver would most want it to.
- **Excused days are included** (§7.9) — they are the thing he would otherwise argue about. Do not filter them out to tidy the list.

**Note the overlap with A5.** This screen and a fuller `DriverDetailScreen` render nearly the same facts from two different endpoints under two different gates. Build `MineScreen` first — its endpoint exists — and factor the shared presentation only once A5 lands, not speculatively.

**Done means** — a linked driver's token renders exactly his own data, and no request shape exists that could return anyone else's.

### B2 · Partners, banking and cash — A2 done, waits only on B0

**Screens** — `web/src/features/partners/`: `PartnerDetailScreen`, `OwnershipSharesForm`, `CapitalContributionSheet`, `ShareVehicleForm` (F-1.4), `BankingEventForm`, `CashPositionScreen`. New routes `/cash` and `/partners/:id`.

**`PartnerListScreen` is a section on `/cash`, not a route.** §3.3 has `/partners/:id` and deliberately no `/partners` — and `GET /api/reports/cash-position` already returns every partner with a name and a held figure, which *is* the list. A separate list route would be a second way to reach the same rows, and the route map is the document that decides.

**Traps:**
- **The shares form submits the whole set at once, never row by row**, and surfaces `OWNERSHIP_SHARES_INVALID` as a 400 rather than pre-checking the sum client-side. The trigger is deferred and fires once at commit — a client-side sum check is a second implementation of it.
- **Capital is not ownership** (W-52). Never render one as the other; never show a derived gap.
- **An overlapping management agreement is a 409** from an `EXCLUDE` constraint. Catch it; do not pre-check.
- **The banking discrepancy's bearer is required exactly when recorded ≠ counted**, and the form must **only ever offer `absorbed` / `unattributed`**. The third enum value means the shortfall was traced to a receipt and corrected there instead (F-8.2) — it can never arrive through this form, and the request schema already refuses it.
- **GAP-1 again: do not build UI that implies per-vehicle scoping exists.**

**Done means** — a 60/40 split saves in one write and reads back; a shared vehicle with a monthly fee grants and revokes.

### B3 · Close the month and corrections — waits on A3

**Screens** — `web/src/features/period/`: `CloseMonthScreen` on `/period/close`, `CorrectPaymentSheet`, `WriteOffSheet`, `PostClosureChargeSheet`, plus **`Timeline` finally wired to real `audit_log` data** — it has one caller today and was built for exactly this.

**`CorrectPaymentSheet` needs a payment row to open from**, which is `GET /api/payment` (GAP-38, A3). Where that row lives is this item's own decision — the lease hub's dues section and the driver/customer detail screens are all candidates; §7.10 only says "open the receipt."

**Traps:**
- **The checklist warns and lists; it never blocks** (U-7). The close button stays enabled.
- **`unconfirmedDays` is the checklist's first row** (§7.7) and arrives with A3. Render all five rows or state plainly which is missing — do not silently show four.
- **Closing opens the successor period in the same transaction.** The screen must make clear that this happened, since every later write depends on it.
- **A correction's `bearer` is the whole decision.** `back_to_arrears` puts the party back in arrears (INV-22); `absorbed_loss` leaves their due settled and the business eats it. Two outcomes from one form, and the copy must say which is which **without using the word "allocation"** (U-6).
- **A waiver and a write-off never share a bucket** (W-28). Separate entry points, separate reporting, never one combined "reduce this due" control.
- **`PERIOD_CLOSED` comes from the trigger**, never a client pre-check. Catch it and explain it.
- **GAP-15**: "deduct it from his fee" is `POST /api/offset` applied afterward. Either wire it as two explicit steps or leave it out — do not imply a combined endpoint exists.

**Done means** — a month closes end to end with its successor open; a correction moves a party back into arrears and the audit trail shows who did it.

### B6 · Customer detail — waits on A4, closes GAP-22

`/people/customers/:id` replaces `PlaceholderDetailRoute`. §3.3: dues, payments, statement.

**Reuse `LeaseHubScreen`'s dues section wholesale** — same rows, same "tappable only while `pending`/`part_paid`" rule, same `ActionSheet` into `CollectPaymentSheet`/`AdjustObligationSheet`. This screen is the party-scoped twin of one that already exists; building it a second way would be the drift.

### B7 · Offline and the PWA — startable, sequence last

Cross-cutting: it wraps every screen, so building it before the screens exist means rebuilding it per screen. **Startable at any time, correct to finish last.**

**What lands** — TanStack Query persistence; the paused-mutation queue (M-12) replaying with a **fresh token per attempt**; a 401 on replay pausing and re-authenticating rather than discarding; the eviction warning while the queue is non-empty; the iOS "Add to Home Screen" hint; runtime caching (stale-while-revalidate reads), deferred from P0's shell-precache-only PWA.

**Traps:**
- **A discarded mutation is a lost money record.** Pause and re-authenticate; never drop.
- **`HomeScreen`'s skeleton branch becomes reachable for the first time.** Web-P3 built it correctly and recorded that its one trigger condition — a warm cache — could not occur before this item exists. **Verify it now rather than assuming it works.**
- **`Provisional` has 0 real callers** and is the one inventory component no item claims. If it belongs anywhere it is here; if it doesn't, say so and record it.
- Side-by-side condition comparison needs photos, which need A7.

**Done means** — four days confirmed on a Sunday with no signal replay silently on Monday, and the money lands once.

### B8 · Real Asgardeo 🔴

**Blocked**, least priority, and unblocking costs about ten minutes of console work: token type → JWT, binding → None, redirect URL cleanup. Nothing above waits on it — `web/src/lib/auth-stub.ts` exists precisely so nothing does. **Fire the console change early anyway**; it has no cost and it is the last gate before anyone outside this repository can log in.

---

## How the tracks run

```
        Track A (Worker + shared schemas)          Track B (React client)
        ─────────────────────────────────          ──────────────────────
done    A1  GET /api/expense ✅                     ~~B1 ExpenseListScreen~~ withdrawn
        A2  partner/banking/cash + members ✅ ──┐    B0  the /more hub ──────┬──┐
                                                │        (no backend dependency) │  │
now     A3  period/write-off/payment ─────────┐ │    B4  Review shell + 9 reports │  │
                                               │ │    B5  Mine shell              │  │
        A4  customer reads ──────────────────┐ │ └─►  B2  partners, banking, cash ◄┘  │
        A5  driver history + advances ─────┐ │ └───►  B3  close the month  ◄──────────┘
                                           │ └─────►  B6  customer detail
        A6  trip receivable (design settled — post at booking)
        A7  R2 upload (unblocks 5 gaps)
        A8  odometer wiring, borne-by override
                                           └──────►  B5+ driver detail history
last                                               B7  offline and the PWA
blocked                                            B8  real Asgardeo 🔴
```

**Track B never idles.** B4 alone is larger than A2 was, and B5 and B7 sit behind it with no backend dependency at all. **Track A never idles either** — A3 through A8 are independent of each other and of every B item; A2 is already done.

**The only real handoffs are A2 → B2, A3 → B3, A4 → B6.** Each is one schema commit, per the contract at the top.

---

## The bar every item clears

Unchanged, restated so no session goes looking:

- **360 × 640, one thumb, no horizontal scroll**, and it still reflows at 320px.
- **Every create form saves with level-1 fields only** (U-2) — an automated test, not an intention. Every existing form has one; match the wording ("saves with X alone") so they stay greppable.
- **44 × 44 minimum**, ≥ 8px apart, ≥ 16px when one is destructive.
- **Money is `string` on the wire, `bigint` in the client, never `number`.**
- **`Rs 0` and `NotAvailable` are visibly different things.**
- **No raw hex** — `--color-*` tokens only, and colour never carries meaning alone.
- **Reserved vocabulary, never abbreviated**, and no accounting words at all.
- **New token → add it to `theme.text`/`theme.spacing` in `cn.ts`**, or tailwind-merge silently drops it (TRACKER.md §5).
- **New form → inherit the three structural fixes** (TRACKER.md §5): domain-typed form state with `toWire()` only in `mutationFn`, `blankToUndefined` on optional text, `Disclosure forceOpen` on a level-2 error.
- **A new money table is not finished until it is in the `assert_period_open()` array** (Track A only).
- **A new write to a `posted_period_id`-carrying table must open a transaction**, or its audit row records `changed_by` as `NULL` (Track A only).
- `npm run check` clean across all three workspaces — **and, for Track A, the touched integration file re-run alone**, since `check` does not include it and the shared Neon branch drops connections at random. `TEST_PARALLEL=1` against a personal branch (TRACKER.md §5) cuts a full local suite run from ~29 minutes to ~105 seconds — worth setting up before a Track A session, not just for the touched-file re-run.
- **a11y is axe-core in Playwright**, not `eslint-plugin-jsx-a11y` — its peer range caps at ESLint 8/9 and this repo is on 10.
- [TRACKER.md](TRACKER.md) updated: the item becomes a **row**, its leftovers become **gap rows with a track**.

---

## Skipped by decision

**R2 presigned uploads** — carried as **A7** rather than dropped, because the previous edition skipped it and the cost has compounded: five recorded gaps, a built-and-tested `photo-pipeline.ts`, and a `PhotoCapture` component with 0 callers, all waiting on one endpoint against an already-polymorphic `attachment` table.

**Per-vehicle capability scoping (GAP-1)** — backend hardening, out of scope on both tracks. Until it lands, an `owner_manager` shared one vehicle reaches every vehicle's capital, payouts and reports. It blocks no screen and closing it later forces no rework, since endpoint shapes do not change — **but B2 must not imply the scoping exists.**

**Error monitoring (GAP-28)** — deferred deliberately, not forgotten. Workers Logs stays the only observability until there is an on-call person and a channel to page.

**Also out, and recorded in [TRACKER.md](TRACKER.md) §4:** UC-73 (yearly) and UC-99 (export), both product-phase Second · UC-79's `revenuePerAvailableDayMinor` (GAP-19) · F-8.4's deposit-apply (GAP-6) · void-and-replace for the other twelve W-50 tables (GAP-12) · everything under "Not in this tracker".

---

## One thing that is not code

External, cheap, and gates something real:

1. **Asgardeo's console change** — ten minutes, unblocks B8, blocks nothing else. Fire it early regardless of when B8 runs.

**Done, 5 August 2026: CI's integration workflow.** Was blocked on `secrets.NEON_API_KEY`/`vars.NEON_PROJECT_ID`, absent from the repo — no endpoint had ever been tested by CI at all. Configured via the Neon GitHub App and verified with a real PR run: all seven migrations applied from scratch, the DM §13 drift check, and all 328 integration tests, green, in 12m49s. One live bug surfaced and fixed along the way — Neon's Free plan rejects an explicit `suspend_timeout` on branch creation outright, even at the value it already defaults to — recorded in [TRACKER.md](TRACKER.md) §5 so it isn't rediscovered. Nothing on either track depended on this, but it was the single highest-value non-code fix available, and it's done.

---

## When an item here is finished

Write it up in [TRACKER.md](TRACKER.md) as **one row**, not a section — what it delivers, its proof with real test counts, and a gap id for anything it did not build. Tick the row off here and move on. This file is a plan and goes stale; that one is the record.
