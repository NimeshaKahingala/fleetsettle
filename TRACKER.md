# Build tracker

**Not a specification.** `docs/` says what to build and why; this says what is done. Where the two disagree, `docs/` is right. [Plan.md](Plan.md) says what remains and in what order; where *those* two disagree, this one is right, because it is the record and that one goes stale.

**Rewritten 4 August 2026**, from `b2cf367`. The previous edition was 760 lines of narrative in phase order; this is the same content reorganised so a finished phase is a row, every unfinished thing is one table with a track against it, and anything that costs a session to rediscover has its own section.

**Validated this pass** — route-def by route-def against `api/src/route-defs/`, screen by screen against `web/src/`, both against a real `npm run check`. Corrections in [§6](#6-what-validation-corrected).

**Updated 5 August 2026**, `e7efa71` — CI's integration workflow, blocked since P0 on missing repository secrets, is now configured and verified end to end: a real PR run applied all seven migrations from scratch, passed the DM §13 drift check, and ran all 328 integration tests, green, in 12m49s. One live bug found and fixed along the way, recorded in [§5](#5-the-traps).

**Updated 5 August 2026**, `2822193` — a second validation pass, this time scoped to the four items about to be built (A2, A3, B2, B3). Three more corrections and two settled decisions, in [§6](#6-what-validation-corrected); two new gaps, **GAP-37** and **GAP-38**, both blocking.

**Updated 5 August 2026 — A2 done.** Partner, banking and cash reads: `GET /api/business-member` (GAP-31), five list endpoints (`ownership-share`, `capital-contribution`, `management-fee-agreement`, `banking-event`, `partner-payout`), and the composed `GET /api/partner/{userId}` (F-7.6/F-7.3, closing GAP-9 and GAP-4 by derivation, never a write). 52 new integration tests, all green together and against the full suite. Two real defects found and fixed while writing them, both recorded in [§5](#5-the-traps): `listOwnershipShares`' first draft, and a nullable-generated-column default that the W-56 lint rule caught. A third finding, **GAP-39**, is a live gap the endpoint works around rather than fixes — no generator ever turns a `management_fee_agreement` into a period obligation, so `sumVehicleCostsForPeriod`'s own `management_fee` branch has been silently reading zero since P7.

**Updated 5 August 2026 — A3 done.** Period, write-off and payment reads: `GET /api/accounting-period` (list, open and closed alike) · `GET /api/write-off` (list, gated the same as recording one) · **`GET /api/payment`** (GAP-38 — `POST /api/payment/{id}/correct` has had a caller since P9 with nowhere to reach it from; this is F-8.2's "open the receipt" step, and carries the linked-driver 403 class since a payment names the driver it moved against) · the close checklist's **`unconfirmedDays`** row (GAP-13 — one `COUNT(*)` on `day_record.state = 'open'` scoped to the open period, cheap and exact since P13, UI §7.7's first row). No new table, no new write, no domain-layer function needed — every one of these is a straight filtered read, the same shape A2's list endpoints already established (list capability mirrors the corresponding write capability). 13 new integration tests across the three existing files; full suite 31 files / 366 tests, 366/366 green (one file's known Neon connection-flake under parallel load ruled out by re-running it alone — 16/16 clean, unrelated to this change).

---

## 1. Where things stand

**Backend is complete through P13.** **Frontend is complete through Web-P8b.** P14 and real Asgardeo are blocked on external work. CI's integration workflow is configured and verified — every PR into `main` now runs all seven migrations from scratch, the DM §13 drift check, and the full integration suite against a fresh Neon branch.

| Gate | Result |
|---|---|
| `npm run check` | clean across `api` / `web` / `packages/shared` |
| `web` | 74 files / 264 tests |
| `packages/shared` | 11 files / 78 tests |
| `api` unit | 3 files / 10 tests |
| **`api` integration** | 31 files / 353 tests — **not in `check`** locally ([§5](#5-the-traps)); runs on every PR via `integration.yml`, verified green 5 Aug 2026 |
| `npm run lint` | 0 errors, 15 warnings — all `react-refresh/only-export-components`, expected ([§5](#5-the-traps)) |

The client reaches **14 routes**. §3.3's map names 19 paths; the five with no screen are `/cash`, `/partners/:id`, `/reports`, `/reports/:key`, `/period/close`, plus `/settings/*` (level-3 config, unscoped) and `/me`. `/people/customers/:id` exists but renders a placeholder — **and so does `/more`, which is the only route the other five can be reached from** (GAP-37).

### The five rules that decided the order

Still binding on everything in [Plan.md](Plan.md):

1. **`packages/shared` is the root of the dependency graph.** A bug in it is structural, not local.
2. **The schema is the synchronisation point, and the main lever for parallelism.** Once a resource's Zod schema lands in `packages/shared`, the two tracks separate: the Worker builds against a real Neon branch, the client against mocks derived from *the same schema object*. Hand-mirrored types drift and what drifts is a money field. **This rule is what makes the plan's Track A / Track B split legal.**
3. **Auth blocks the client, not the Worker.** `tests/support/auth.ts` mints a user per W-49 role, so endpoints are tested before Asgardeo works.
4. **No cron is ever a prerequisite for a user action.**
5. **Reports come after the writes that feed them.**

### The golden fixtures

The regression suite. Any change that moves one is breaking and must fail loudly (FL §9.1).

| Fixture | Figure | Reproduces at | Status |
|---|---|---|---|
| **G-3** Mileage on an open-ended rental | **7,500** | P5 | ✅ end to end through real endpoints |
| **G-2** One accident | **15,000** | P8 | ✅ against the real period lifecycle |
| **G-1** One month of the bus | **134,000** | P9 | ✅ open July → write → close → open August |

---

## 2. Backend — P0 to P14

Each row is complete unless its Gaps column says otherwise. Gap ids resolve in [§4](#4-every-open-gap).

| Phase | Delivers | Proof | Gaps |
|---|---|---|---|
| **P0** Foundation | Money codec (`Minor = bigint`, largest-remainder split), business-date helper, error codes · Hono + Drizzle + Neon skeleton, per-request db middleware (`neon()` reads / `Pool` transactions) · migration runner (advisory lock + SHA-256 per filename) · `0001` (DM §16.0 DDL) and `0002` (`audit_log` trigger) · `/api/health`, `/api/ready`, `/api/docs` 404 in prod · Vite + React 19 + Tailwind v4 tokens, both dark selectors diffed declaration-by-declaration · PWA shell precache · CSP/HSTS via a native `public/_headers` | codec covers U+2212, M-16 cents, split-sums-to-whole | GAP-28 |
| **P1** Identity + access boundary | `jose` against a **local** JWKS through KV, refetch-once on unknown `kid`, one undifferentiated 401 otherwise · `sub → app_user → business_member` **or** `driver.linked_user_id` in one query · `auth/policy.ts` per W-49 row · **cross-tenant 404, missing capability 403** · the linked-driver test class · rate limiting on `CF-Connecting-IP` · `GET /api/me` | full matrix through the real middleware chain; a real ES256 keypair signs test tokens — only the IdP is mocked | GAP-1 |
| **P2** Entities + setup | CRUD for business/vehicle/driver/customer · three arrangements with the original start date preserved · opening balances (owners-only `manageOpeningBalances`) · paperwork expiry dates · **opens the first accounting period** as part of business creation | | GAP-17, GAP-31 |
| **P3** The daily loop | `domain/confirmDay.ts` — **four inserts, one transaction**; one endpoint serves all three F-4.2 buttons via a discriminated union; `paid_in_full` resolves the rate **in force on that date** server-side · idempotent on `(daily_lease_id, business_date)` · **`PERIOD_CLOSED` mapped from the trigger, no pre-check** · `earned`/`received` never collapsed | 13 integration | GAP-2, GAP-3, GAP-30 |
| **P4** Costs, adjustments, driver money | `POST /api/expense` with **`borne_by` and `paid_by` as two fields**; absent `vehicleId` is a valid overhead cost · UC §6.7's default-owner matrix resolved **server-side** from the vehicle's current arrangement · adjustments/waivers — a waiver raises `waived_minor` only, `amount_minor` stays the charge · `computeObligationStatus()` is the one place status is derived · advances + settlement · deposits as money held · `offset_record`, the only thing that moves both balances · `GET /api/driver/{id}/balances` — two `SUM`s, no subtraction anywhere | 30 integration + 13 shared unit; §6.4's walkthrough lands 0 / 4,000 | GAP-4, GAP-16 |
| **P5** Rent, billing periods, mileage · **G-3** | Billing periods idempotent on `(lease_id, seq)`, boundaries from the lease's own anchor via `addCalendarMonths`, never chained off the previous period · `POST /api/lease` writes lease + handover odometer + **first billing period** in one transaction · **rent fixed per period, mileage allowance per day × days** (W-25) · one-directional excess; multi-period assessments split by days and marked `isEstimated`; at-or-below-threshold auto-waives · F-2.5 renew · F-2.2 payment, oldest-`due_on`-first, surplus returned as `unallocatedMinor` | 22 integration + 18 shared unit; **G-3 = 7,500** split 152/148 | GAP-5 |
| **P5+** F-2.6 close the lease | Four endpoints on `active → closing → closed`: `close` (stop the clock, final period via `applyAdjustmentTx`, final mileage through the unmodified `assessMileage`), `closure-summary` (INV-18), `settle-deposit` (refund / retain / `hold_window`), `close-out` (frees future occupancy). The covering period's `period_end`/`allowance_km` shorten on early closure **regardless of `finalPeriodMode`**; `rent_amount_minor` is never touched | 17 integration, through the real chain start → close-out | GAP-6, GAP-16 |
| **P6** Trips and charters | Booking **pauses** existing `day_record` rows (bulk `UPDATE`, never a loop) · close in one transaction — **INV-17 blocks unconditionally** on an unsettled advance; closing odometer and driver-fee obligation both written **at close, never at booking** (W-41/INV-30); trip P&L degrades distance/litres/km-per-litre to `null` · cancel reconciles the advance via `advance_settlement`, resumes paused days, **deletes** allocation rows (that table has no `voided_at`) · vehicle calendar | 19 + 5 integration; UC §7.1 reproduces **26,000** | GAP-7, GAP-8 |
| **P7** Partners, banking, cash | Ownership shares as **one bulk insert sharing one `effectiveFrom`** — `assert_shares_total()` is a *deferred* trigger, so 60/40 lands as one legal multi-row write; violation → 400, never pre-checked · capital kept distinct from ownership (W-52) · management agreements, `EXCLUDE` overlap → 409, revoke sets `effective_to` · banking events; the request schema offers **only** `absorbed`/`unattributed` · partner payouts | 27 integration | GAP-9, GAP-16 |
| **P8** Incidents · **G-2** | The container: open · off-road with three treatments (`continue` / `credit_days` via `applyAdjustmentTx` / `extend` writing `lease_extension`) · repairs reuse `expense.incident_id` · customer contribution agreed then received · insurance claim and its paired recovery in one transaction · bottom line as a **live snapshot** · closed manually | 14 integration; **G-2 = 15,000** | GAP-10, GAP-11, GAP-16 |
| **P9** Period close, corrections, audit · **G-1** | **`audit_log.changed_by` actually populated** — `withActor` wraps `.transaction` once in `db/client.ts` · close opens its successor in the same transaction; the checklist **warns and lists, never blocks** (U-7) · payment correction where `bearer` decides everything: `back_to_arrears` unwinds allocations newest-first (INV-22), `absorbed_loss` touches no obligation · void-and-replace for `expense` · opening balance locked once the first period closes | 26 integration; **G-1 = 134,000** | GAP-12, GAP-13, GAP-14 |
| **P10** Write-offs, post-closure charges | `write_off` flips the obligation straight to `written_off`, never touching `settled_minor`/`waived_minor` — the bucket stays separate from a waiver (INV-14) · recovery recorded as an ordinary `payment` **deliberately never allocated**; the `write_off_recovery` row is what marks it · post-closure charge posts to the *currently open* period and never checks whether the source is closed — being closed is the point | 13 integration | GAP-15 |
| **P11** Reports | Nine `GET /api/reports/*`, all read-only. DM §15's six ported close to verbatim; UC-71/72/77/79 designed this phase. `profitPerKm`/`kmPerLitre` **degrade to `null`, never zero** · `listAgeingBuckets` takes `asOfDate`, never `CURRENT_DATE` · `viewReports` (STAFF) gates seven, `viewOwnerOnlyReports` (OWNERS) gates UC-77/79 · **a linked-driver token 403s all nine**, proven in one loop | 17 integration | GAP-18, GAP-19 |
| **P12** Driver-view (backend half) | `GET /api/driver-view` — both balances never netted, every day **including excused ones**, closed trips and fees, advances, offsets, held deposit. **INV-25 is structural**: `driverId` is never a request parameter anywhere in the route, so no request shape can ask for another driver · new `viewOwnData` capability, `driver` role alone | 4 integration; INV-25 proven with two drivers on two vehicles | frontend half → Track B |
| **P13** Scheduled work | `generate-day-cards` + the arrangement-A calendar extension — **this is what finally enforced INV-1 for lease and daily lease** · `generate-billing-periods` reusing P5's exact function, catching up in a bounded 24-period loop · both **unscoped by `business_id` deliberately** (a cron is not a request), each unit in its own try/catch · idempotency via `.onConflictDoNothing()` on a **separate insert path** from the one a real booking uses, where a conflict must stay a 409 · real Cron Trigger via `Object.assign(app, { scheduled })`, preserving `app.request()` · `GET /api/home/paperwork-warnings` + `/deposit-releases` — reads, not jobs | 15 tests | GAP-20, GAP-21 |
| **P14** Messaging | 🔴 **Blocked** — twelve Meta template approvals (6 messages × 2 languages), minutes to ~2 days each. `dispatch-messages`, the fifth Cron Trigger, waits with it | | |
| **A2** Partner, banking and cash reads | `GET /api/business-member` (GAP-31) · five list endpoints — `ownership-share` (current split only, `effective_to IS NULL`, safe because `assert_shares_total` structurally forbids two open sets per vehicle), `capital-contribution`, `management-fee-agreement` (**revoked agreements returned, not filtered**), `banking-event`, `partner-payout` · the composed `GET /api/partner/{userId}` (F-7.6/F-7.3) — `putIn`/`takenOut` all-time, `earned` scoped to the open period only and named as such, `holding` reused from P11's cash-position query. No new table, no new write | 25 new integration tests (business-member 4, partner +16, partner-summary 5) in 2 new files; full suite 31 files / 353 tests, 353/353 green (one unrelated file's known connection-flake ruled out by re-running alone) | GAP-4 ✅, GAP-9 ✅, GAP-31 ✅, GAP-39 |
| **A3** Period, write-off and payment reads | `GET /api/accounting-period` (list, newest first, `viewReports`) · `GET /api/write-off` (list, every filter optional, gated `writeOffOrWaiveAboveThreshold` to mirror recording one) · **`GET /api/payment`** (GAP-38 — `dailyOperations`, mirroring `recordPayment`; carries the W-49 linked-driver 403 class) · close checklist gains **`unconfirmedDays`** (GAP-13 — `day_record` rows still `state = 'open'`, scoped to the open period's `posted_period_id`, one `COUNT(*)`, honest under-report if the cron hasn't run yet). No new table, no new write, no domain layer — three straight filtered reads and one added count | 13 new integration tests across 3 existing files; full suite 31 files / 366 tests, 366/366 green (`day-record.test.ts`'s known connection-flake under parallel load ruled out by re-running alone, 16/16) | GAP-13 ✅, GAP-38 ✅ |

---

## 3. Frontend — Web-P1 to Web-P8b

| Phase | Delivers | Tests |
|---|---|---|
| **Web-P1** Router + first-run | Code-based TanStack Router from a factory (`createAppRouteTree(today, history?)`) so tests inject memory history — no `routeTree.gen.ts`, same reason migrations are hand-written · `FirstRunGate` with `retry: false`; 404 → `CreateBusinessForm`; role → shell · `auth-stub.ts` behind `VITE_AUTH_MODE=stub`, set on the **build**, because env vars inline at build time | 4 e2e |
| **Web-P2** Home reads (backend) | `GET /api/daily-lease`, `/api/day-record`, `/api/trip` — the three lists Home needed and no earlier phase's tests had asked for. `GET /api/trip` filters `status = 'booked'`, not a literal `'in_progress'` that would have returned nothing forever | full matrix each |
| **Web-P3** The Home tab | §3.2's ordered stack from six independent reads · new `AlertStrip` + `EmptyState` · `DayCard`/`ConfirmDayCard` gained `elevated?: boolean` | 50 / 154 |
| **Web-P4** Driver detail | `DriverDetailScreen` + a real working `OffsetSheet`. **W-2 by construction** — `TwoBalances` gets two independent totals and derives its own sentence; the screen never computes a net | 52 / 158 |
| **Web-P5** Vehicle overview + calendar | Backend: four vehicle-scoped reads (`/document`, `/expense`, `/lease`, `/daily-lease`) · frontend: Paperwork/Costs/History sections, a **voided expense stays visible struck through with its reason** · calendar with colour **plus glyph** per day; `findVehicleCalendar` extended with a `LEFT JOIN` onto `day_record` so "ran" and "lost" are distinguishable | 54 / 171; api 24/24 |
| **Web-P6a** Two gaps first | F-1.9 mileage packages, entirely unbuilt (the table existed since `0001` and nowhere else) — **archive, never delete** · `GET /api/lease/{id}/obligation`, a **three-way reassembly** because `obligation` has no `lease_id`: rent → `billing_period`, excess → `mileage_assessment`, post-closure → `lease` directly | api 46/46 |
| **Web-P6b** The lease hub | `/leases/:id` — Terms card + dues + `CollectPaymentSheet` (client-side `AllocationPreview`; the server still performs the real allocation and is the only authority), `AdjustObligationSheet`, `RenewLeaseSheet` · `Timeline` gained per-entry `onClick` | 57 / 185 |
| **Web-P6c** Start a lease | `/vehicles/:id/lease/new` — seven steps, six level-1 fields, **U-2 verified against the actual POST body** having no optional keys at all · mileage-package chips · calendar tap-through, arrangement A half | 58 / 194 |
| **Web-P6d** Odometer + closure | `GET /api/lease/{id}/deposit` (returns `null` when none was taken — that is not a W-56 gap) · `ReadOdometerSheet` · `CloseLeaseScreen`, an in-screen stepper on one route. **Back is removed once step 0 succeeds** — the lease is really `closing`, a posted fact, not a draft | 60 / 206; api 20/20 |
| **Web-P7** Trips | `tripResponseSchema` fixed — `closingDate`/`cancelReason`/`advanceDisposition` were fetched but never projected · `GET /api/trip/{id}/expense` · `BookTripScreen`, `TripDetailScreen`, `CloseTripSheet` (**INV-17 blocks with a `Dialog`**, its first real caller), `CancelTripSheet` (never blocks; a 409 reveals a Refund/Keep-as-fee chooser inline) · calendar tap-through, B/C half | 64 / 226; api 26/26 |
| **Web-P8a** Incidents | Three wire gaps closed: recoveries + claim now reach `GET /api/incident/{id}`; `GET /api/vehicle/{id}/incident`; `GET /api/incident/{id}/expense` · `IncidentScreen` as a **container, not a wizard** — every action stays available regardless of `status` · five single-purpose sheets · `VehicleOverviewScreen`'s one app-bar action became a menu | 71 / 254; api 18/18, 27/27 |
| **Web-P8b** Costs + quick-add | **`GET /api/expense`** — every filter optional, newest first, voided rows included; no 404 for a filter naming another business's row, since the `businessId` AND already excludes it · `RecordExpenseSheet` + `FuelFillSheet` — **`BorneByPaidBy`'s first real caller** · `QuickAddSheet` on `AppShell`'s `＋`, shipping 3 of M-4's 5 actions. **`borne_by` is never recomputed client-side** — omitted from the request unless explicitly overridden to "Us", so the server's §6.7 matrix always wins. **No `ExpenseListScreen`**, correcting the plan's own guess: §3.3's route map has no business-wide costs route, and `docs/` outranks the plan | 74 / 264; api 20/20 |

**Web-P8b's own open gaps** — GAP-29 (`GET /api/advance` skipped for want of a caller), GAP-30 (`expense.odometer_reading_id` never wired), GAP-31 (no business-member list, so paid-by has one option), GAP-32 (borne-by overrides only to "Us"), GAP-33 (`GET /api/expense` has no caller), GAP-34 (fuel fill's U-3 prefill degrades to the first vehicle).

---

## 4. Every open gap

One table, because scattering these is what let GAP-22 sit unowned through four phases. **Track** resolves in [Plan.md](Plan.md); `—` means nothing schedules it yet.

### Scheduled

| id | Gap | Track |
|---|---|---|
| **GAP-1** | Per-vehicle capability scoping. `managePartnerCapital`/`viewOwnerOnlyReports` are flat, business-wide stand-ins — an `owner_manager` shared one vehicle reaches every vehicle's capital, payouts and reports. Recorded in `auth/policy.ts` since P7. **Do not build UI implying the scoping exists** | out |
| ~~**GAP-4**~~ | ✅ **Closed 5 Aug 2026 (A2).** `paid_by_user_id` is recorded but raised no partner current-account entry — F-3.1's "no extra step" is unmet no longer: `GET /api/partner/{userId}` sums `expense.paid_by_user_id` at read time. A current-account *entry* would have been a new money table — a new `assert_period_open()` array entry, a new void path, a row that can disagree with the expense it came from. A `SUM` cannot drift from its own source | — |
| ~~**GAP-9**~~ | ✅ **Closed 5 Aug 2026 (A2), F-7.6/F-7.3 half.** F-7.1/F-7.5 already had endpoints (`GET /api/reports/vehicle-month`/`cash-position`, P11, not duplicated); F-7.6 and F-7.3 are now the composed `GET /api/partner/{userId}` — `putIn`, `takenOut`, `earned`, `holding`, one page per partner. B2 still owns rendering it | B2 |
| **GAP-12** | **Void-and-replace exists for `expense` only.** The other twelve W-50 tables carry the `voided_*` trio structurally, so the mechanism is proven — not each instance of it. A record created by mistake in any of the twelve cannot currently be reversed | **A9** |
| ~~**GAP-13**~~ | ✅ **Closed 5 Aug 2026 (A3).** The close checklist's `unconfirmedDays` is a `COUNT(*)` on `day_record` where `state = 'open'` and `posted_period_id = periodId` — the same scoping convention `pendingObligations` already used. Cheap and exact since P13 (a `day_record` only exists for a scheduled pattern day), UI §7.7's first row, under-reports honestly if the cron hasn't run for a date yet (U-7) | B3 |
| **GAP-15** | F-8.4's "deduct it from his fee" is `POST /api/offset` applied afterward, not a code path. A combined one-tap endpoint is UI-shaped work | B3 |
| **GAP-16** | **R2 presigned uploads.** Blocks condition photos at lease start (F-2.1 step 6) and close (F-2.6 step 5), incident damage photos, expense receipts, and the side-by-side comparison. `PhotoCapture` has **0 real callers**; `attachment` (DM §12) is already generic and polymorphic — one small endpoint unblocks all five | A7 |
| **GAP-22** | **`/people/customers/:id` renders `NotBuiltYetScreen`.** Web-P4 deferred it to "Web-P6's placeholder"; Web-P6a–d were all leases and shipped without it, and the plan never mentioned customers again. §3.3 specifies dues, payments, statement | **A4 / B6** |
| **GAP-23** | **F-5.2/F-5.3 never wired.** No obligation is raised for a trip's `agreedAmountMinor`, so no payment can allocate against it — the money floats as `unallocatedMinor`. `TripDetailScreen`'s "Received" row is `NotAvailable` naming this exact reason. **Design resolved and settled by the owner, 5 Aug 2026: post at booking (bookings are firm — no cancellation-fee concept exists and `hold` was never built), `kind: 'trip_fare'`, void on cancel.** W-41/INV-30 do *not* constrain this — income recognition is enforced by `trip.posted_period_id`, set only at close, entirely independently of any obligation | **A6** |
| **GAP-24** | `DriverDetailScreen` has no history sections — days, trips, advances, deposit. `driverBalancesResponseSchema` gives two totals and no breakdown | A5 / B5 |
| **GAP-29** | **`GET /api/advance` not built.** Deliberately skipped in Web-P8b — no caller in that phase, and building it without one is the half-built increment this codebase avoids. Belongs with whichever item builds the driver's advances section | A5 |
| **GAP-30** | **`expense.odometer_reading_id` has never been wired through any layer** — a DB column since P3, unlike `trip.opening_odometer_id` which P6 wired. Blocks fuel-fill's odometer and trip-link fields (both level 2). Wiring it means deciding whether a fuel fill creates its own `odometer_reading` row transactionally | A8 |
| ~~**GAP-31**~~ | ✅ **Closed 5 Aug 2026 (A2).** `GET /api/business-member` lists a business's own active owners/owner-managers/managers, gated `dailyOperations` (not `managePartnerCapital`) since its caller is a manager-facing form. `BorneByPaidBy`'s paid-by picker still needs wiring to it — that's B2's own item | B2 |
| **GAP-32** | Borne-by can only be overridden to **"Us"**. Overriding to a *specific* driver or customer other than the vehicle's current party needs either a live preview endpoint or a second "who currently holds this vehicle" lookup | A8 |
| **GAP-33** | **`GET /api/expense` has no caller.** Shipped deliberately ahead of any screen (report-adjacent, real value regardless), but §3.3's IA calls for none in phase 1. Revisit if a costs view is ever specified | — |
| **GAP-35** | **Voiding is not blocked in a closed period — a live defect, not a missing feature.** Migration `0006` makes `assert_period_open()` return early on any `UPDATE` leaving `posted_period_id` untouched, and a void sets only `voided_at`; `voidExpense` has no period check either. Voiding a July expense after July closes silently changes July's reported costs. **Fix in the trigger, not in thirteen domain functions** | **A9** |
| **GAP-36** | **`driver` and `customer` have no soft-delete column at all**, so a row created by mistake is permanent. `vehicle.lifecycle` has existed since `0001` but no endpoint ever moves it off `'active'`. `mileage_package`'s `archived_at` + archive endpoint is the reference pattern | **A9** |
| **GAP-37** | **`/more` renders `NotBuiltYetScreen`, and it is the only door to four routes.** §3.1 puts cash, reports, period close, settings, message log and business behind that tab; §3.3 gives `/cash`, `/partners/:id`, `/reports` and `/period/close` **no other entry point**, and the tab bar's five slots are fixed. Every screen B2 and B3 build is reachable only by typing a URL until this exists. No backend increment | **B0** |
| ~~**GAP-38**~~ | ✅ **Closed 5 Aug 2026 (A3).** `GET /api/payment` — every filter optional, newest first, gated `dailyOperations` to mirror `recordPayment`. `POST /api/payment/{id}/correct` (built since P9) finally has somewhere to reach a payment id from. Carries the W-49 linked-driver class: `dailyOperations` is a STAFF-only capability, so a linked-driver token 403s before it ever sees another driver's payment row — proven, not assumed | B3 |
| **GAP-39** | **W-53's "management fee reduces vehicle profit" has never actually fired.** `sumVehicleCostsForPeriod` (queries/reports.ts) reads `obligation WHERE kind = 'management_fee'` — the enum value exists, the query is ready — but nothing in this codebase ever inserts one; there is no generator turning a `management_fee_agreement` into a period obligation the way `generate-billing-periods` does for rent. Every vehicle with a managed agreement has been reporting a management fee cost of **0** since P7, silently. Found building A2's `GET /api/partner/{userId}`, which reads the fee from `management_fee_agreement.monthly_amount_minor` directly instead — correct for that one endpoint, but `sumVehicleCostsForPeriod`/UC-70's vehicle profit is still wrong wherever a management fee applies | — |

### Recorded, unowned, and correct to leave

Each is unreachable, unbacked by the schema, or genuinely out of scope. Listed so the absence stays a decision.

| id | Gap |
|---|---|
| **GAP-2** | F-4.3's effective-dated rate change and F-4.6's bulk week-confirm — real features the size of F-4.2 itself. Several screens' "current rate" simplifications are safe **only** while this stays unbuilt |
| **GAP-3** | `confirmDay`'s pre-generated-`open`-card branch is dead code today, documented as such |
| **GAP-5** | `recordPayment`'s surplus comes back as `unallocatedMinor` but is never applied forward against a future due |
| **GAP-6** | F-8.4's deposit-apply — reusing `allocateAgainstOldest` verbatim would wrongly create a `payment` row for money already held |
| **GAP-7** | Trip `hold` (ST-5) and `in_progress` are unreachable — `bookTrip` writes `booked` outright. `VehicleCalendarScreen`'s hold-outline cell and `T?` glyph render and are tested but cannot occur |
| **GAP-8** | A genuine concurrent double-close race is unguarded (status-based idempotency only), the same accepted gap billing-period's wrapper has |
| **GAP-10** | `incident.status`'s `repairs_recorded`/`recovery_pending` are never set automatically; `incident_recovery.obligation_id` stays `NULL` for a customer contribution |
| **GAP-11** | W-11's "hidden unless enabled" has no backing settings field anywhere in the schema — the claim action is always offered |
| **GAP-14** | Stacked partial corrections against one payment are allowed by schema and implementation; only the single-correction path has a test |
| **GAP-17** | The photo pipeline still runs on the main thread — no Worker + 3s-timeout wrapper |
| **GAP-18** | UC-73 (yearly) and UC-99 (export) — both product-phase Second |
| **GAP-19** | UC-79's `revenuePerAvailableDayMinor` — needs its own date-range-scoped earned calculation |
| **GAP-20** | `isPatternDay`'s "alternate" reference point is a judgment call (lease `effective_from` = day zero); F-1.7's skippable-individual-days has no column to hold an exception |
| **GAP-21** | One business timezone for every business — `scheduled.ts` calls `businessToday()` once |
| **GAP-25** | Nothing writes `effectiveTo` on a `daily_lease` — no closure flow for arrangement B the way F-2.6 exists for A |
| **GAP-26** | "Off the road" is not rendered on the calendar — no write path marks a vehicle-day unavailable outside an allocation |
| **GAP-27** | Arrangement C's orange reuses `--color-serious` — a colour match, not a semantic one. Worth a real token, not a raw hex |
| **GAP-28** | Error monitoring deliberately deferred. Tail Worker needs a real alert destination; Sentry needs an account and DSN. Workers Logs (`observability.enabled`) stays the only observability **until there is an on-call person and a channel to page** — revisit then, rather than build an alert that pages no one |
| **GAP-34** | Fuel fill's U-3 prefill ("the vehicle that has something pending") degrades to "first vehicle in the business's list" — nothing in this schema tracks which vehicle a manager last touched, the same simplification `HomeScreen`'s most-recently-used already made |

---

## 5. The traps

Things that cost a session each when rediscovered.

**Testing and environment**

- **`npm run check` does not run the api integration suite.** `api`'s `test` is `vitest run --project unit`; `test:integration` is separate and needs a live Neon branch. A green `check` says nothing about endpoint behaviour.
- **The Neon branch has a connection ceiling.** Every integration file opens its own `Pool` and holds it to `afterAll`, so file-level parallelism opens all of them at once — `vitest.config.ts` sets `fileParallelism: false` for exactly this. On one long-lived interactive branch it still surfaces as `Connection terminated unexpectedly` at a **different, random** test each run. **A failure that moves between runs, in files the change never touched, is the environment.** Re-run the touched file alone before believing a regression. Web-P6d, Web-P7, Web-P8a and Web-P8b each hit it; P8a's session saw 15 failures across 7 untouched files, P8b's saw 2 in `auth.test.ts` that passed 9/9 alone.
- **A dedicated Neon branch plus `TEST_PARALLEL=1` cuts a full local `test:integration` run from ~29 minutes to ~105 seconds** — a ~16x speedup, measured both ways on the *same* branch (`test-parallel`, `br-lingering-violet-afr5li7f`, forked from `main`) so nothing else differs. `api/.dev.vars`'s `TEST_DATABASE_URL` now points at it; the old shared `test` branch is unused, not deleted. The env var sets `fileParallelism: true` with `poolOptions.threads.maxThreads: 4` (`vitest.config.ts`) — bounded well under the ~14-file ceiling above, so it doesn't reintroduce that failure mode. Opt-in and off by default; CI and anyone who hasn't set up a personal branch are unaffected.
- **The connection flakiness above can also surface as a foreign-key violation mid-cleanup, not just a raw timeout.** Found running `TEST_PARALLEL=1` twice in a row: run one failed 6 tests in `mileage-assessment.test.ts` (`billing_period_lease_id_fkey`), run two failed 2 in `day-record.test.ts` (`day_record_daily_lease_id_fkey`) — different file, different constraint, different count, both files 25/25 re-run alone. Same "moves between runs" signature as above, not a cleanup-ordering bug — checked `trackCreatedLease`'s teardown before concluding that, and it's correctly written (re-queries and deletes child rows before the parent, one sequential closure, no bug found). A dropped connection mid-closure can still leave a delete half-done; the fix is the one already established above, not a change to test support.
- **`audit_log` no-ops every `DELETE`** (`DO INSTEAD NOTHING`, migration `0001`). An `app_user` is permanent from the moment anyone acts. Test cleanup must not try — it will compile, run, and silently do nothing. The fix lives in `tests/support/auth.ts`/`factories.ts`; production only ever revokes `business_member`.
- **15 ESLint warnings are expected**, all `react-refresh/only-export-components` in `router.tsx` (14, one per route component) and `ApiContext.tsx` (1). A direct consequence of the code-based-router decision. 0 errors is the bar; do not "fix" these by splitting the route tree.
- **`eslint-plugin-jsx-a11y` is deliberately absent** — its published peer range caps at ESLint 8/9 and this repo is on ESLint 10. **axe-core in Playwright is the a11y gate** until it catches up.
- **Neon's Free plan rejects an explicit `suspend_timeout` on branch creation outright** — a `412` with no error body surfaced by `create-branch-action`, even though the value passed (300s) matched the plan's own fixed default exactly. Confirmed against Neon's own plans doc: *"Can I disable scale-to-zero? Free: No, it's always enabled (5 min idle timeout)"* — the setting isn't configurable via the API on this plan at any value, matching or not. Cost three failed CI runs before the parameter itself was suspected (the first three failures were a separate, missing-secrets cause). Fixed by omitting it from `integration.yml` entirely; Free already suspends at 5 minutes regardless, so nothing is lost.
- **The free plan caps a project at 10 branches and starts failing branch creation around nine open PRs**, on *someone else's* PR, for a reason that looks unrelated (IG §9.2) — why `integration.yml` is one workflow, not two. Delete a hand-created scratch branch (a `migrate-check-*` from testing a migration manually) once its job is done rather than leaving it as permanent headroom loss.
- **`2822193` shipped with `npm run typecheck` broken** — `api/vitest.config.ts`'s `process.env.TEST_PARALLEL` trips `noPropertyAccessFromIndexSignature` (`tsconfig.base.json`), TS4111, since the index-signature access needs bracket notation (`process.env["TEST_PARALLEL"]`). `TEST_PARALLEL=1` had been run and verified, but plain `npm run check` apparently hadn't, on this one file. One-line fix; found and fixed at the start of A2 before `check` could pass at all.

**Writing code**

- **A bare single-statement write to an audited table records `changed_by` as `NULL`.** `withActor` wraps `.transaction`, so a write that never opens one is invisible to it. P9 fixed nine such functions by wrapping them even where atomicity was not otherwise needed. **Any new write to a `posted_period_id`-carrying table must open a transaction.**
- **`payment.amount_minor` has `CHECK (> 0)`** — a full reversal can never zero it. `status = 'reversed'` carries "nothing here counts"; the wire response reports the true remaining figure separately.
- **`tailwind-merge` does not know this project's scale.** Any new `--text-*` or spacing token must be added to `theme.text`/`theme.spacing` in `web/src/lib/cn.ts` or it is silently dropped next to a real colour class. Regression test in `cn.test.ts`.
- **`ownership_share` can never hold two open (`effective_to IS NULL`) sets for one vehicle — a second `POST /api/ownership-share` for a vehicle that already has a set always 400s.** `assert_shares_total` (migration 0001) sums every row whose date range contains the *new* row's own `effective_from`; a still-open first set's `[effective_from, ∞)` range contains any later date, so the total hits 200% and the trigger rejects it before a second set can ever exist. **This means `effective_to IS NULL` alone is a correct and sufficient "current split" filter** — not a coincidence, the deferred constraint's whole job — and a test that tries to `POST` a second set to prove otherwise needs a direct `db.insert` instead (found writing A2's `listOwnershipShares`, `partner.test.ts`'s own comment records the reasoning).
- **A `GENERATED ALWAYS` column reads back nullable through Drizzle even though Postgres never actually leaves it null.** `banking_event.discrepancy_minor` (`recorded − counted`, migration 0001) is one; a raw `SELECT` of it types as `bigint | null` in Drizzle regardless of the `NOT NULL` guarantee the two source columns give it. Defaulting the gap with `?? 0n` is exactly the W-56 pattern the lint rule exists to catch (and it caught it) — compute the figure from the two real columns instead, the same way `recordBankingEvent` (domain/partner.ts) already does on write, rather than trusting the generated column on read.

**Three form bug classes, fixed structurally — every new form inherits the fix**

Found in P2 and fixed once each, at the structural level rather than per-form. A new form that hand-rolls around any of them is reintroducing a solved bug:

1. **Wire/domain mismatch on any zod schema with `.transform()`** (`moneyWireSchema`, `businessDateSchema`) — its `z.infer` output type differs from its `z.input` wire type, but `MoneyField`/`DateField` produce and consume the *domain* type. The fix: a form-local schema built from `z.custom<Minor>`/`z.custom<BusinessDate>` with no transform, keeping form state in domain types throughout, converting to wire via `toWire()` **only inside `mutationFn`**.
2. **`""` vs `undefined` on optional text inputs** — a native `<input>` always yields `""` when untouched, but `z.string().min(1).optional()` only skips validation for `undefined`. Fixed once in `lib/optionalTextField.ts`'s `blankToUndefined`, spread into `register(name, …)`.
3. **A cross-field error hidden inside a collapsed `Disclosure`** — W-55's error attaches to a level-2 field, invisible on a failed submit. Fixed by `Disclosure`'s `forceOpen?: boolean`, driven by `errors.fieldName !== undefined`.

**Migrations** — forward-only and numbered. `0001` DDL · `0002` audit trigger · `0003` single active membership · `0004` `business_id` on seven audited child tables · `0005` odometer `(lease_id, read_on)` partial unique · `0006` **`assert_period_open()` only fires on `INSERT` or an `UPDATE` that actually changes `posted_period_id`** — settling a claim or obligation months later is legal and was being rejected · `0007` `expense.voided_by`. Run `npm run check:drift` against both databases after any of them.

---

## 6. What validation corrected

1. **Root `CLAUDE.md` is materially wrong.** It says *"Repository state: documentation only. No application code exists yet."* Three workspaces, seven applied migrations and 352 passing tests in the gate later, this is the first thing a new session reads and it is false. **Not fixed here — it is not this file's to change** (the `doc-change` skill owns it), but it should be the next one-line commit.
2. **Web-P8b's own entry reported 77 web test files; the gate reports 74.** Its test *count* (264) and its delta (3 new files, 10 new tests) are both right — 71 + 3 = 74. Corrected in §3.
3. **GAP-22 had drifted out of the plan entirely.** The Web-P4 entry deferred the customer screen to Web-P6; Web-P6 shipped in four parts without it and the plan never named customers again. Now tracked with a track against it.
4. **`GET /api/expense` shipped with no caller** (GAP-33), deliberately and for a documented reason — §3.3 has no business-wide costs route, and `docs/` outranks the plan. The plan's `ExpenseListScreen` was withdrawn rather than built.

### A second pass, 5 August 2026 — validating A2/A3/B2/B3 before building them

Read route-def by route-def and screen by screen again, this time only over the four items about to be built. Three more corrections, all of them things the plan asserted and the code contradicts:

5. **`/more` is a placeholder, and it is the only door to `/cash`, `/partners/:id`, `/reports` and `/period/close`.** Neither B2 nor B3 mentioned it, and both are unreachable without it. Now **GAP-37**, promoted to its own Track B item (**B0**) because two items depend on it and neither owns it.
6. **`GET /api/payment` does not exist.** `POST /api/payment/{id}/correct` has been built and tested since P9 and **no interface can reach it** — there is no list query and no route. F-8.2 is unbuildable as specified. Now **GAP-38**, added to A3, which had named only write-offs and a period list.
7. **GAP-13's standing reason expired at P13 and nobody re-checked it.** "Indistinguishable from a day the pattern never scheduled" was true before day cards were generated; it is one `COUNT(*)` now. It had been deferred through four phases on a reason that stopped being true in the middle of them. **A gap's reason is a fact with a date on it** — this is the second time re-reading one changed the answer (GAP-23 was the first), and it is worth doing deliberately rather than accidentally.

Also settled rather than corrected: **F-7.6's host** (A2's one open decision — a composed `GET /api/partner/{userId}`, not a tenth report) and, with it, **GAP-4** — closed by deriving from `expense.paid_by_user_id` at read time rather than writing a current-account entry, because the entry would be a new money table and a `SUM` cannot drift from its own source.

---

## Not in this tracker

UC §9.1 phase Third and UI §15 phase Third, listed so their absence is a decision: depreciation and disposal · driver retainers and spare-vehicle reassignment · loan and lease schedules · tax, if it applies · offline capture of photos · the desktop analytical dashboard beyond UI §14's three changes.

## Blocked

| Blocked | Waiting on |
|---|---|
| **Real Asgardeo** (Track B, last) | Console: token type → JWT, binding → None, redirect URL cleanup. ~10 minutes; blocks nothing else |
| **P14** — messaging | Twelve Meta template approvals |

## One open question, still unresolved

UC §9.1's phase lists name incidents nowhere — not First, Second or Third — yet **G-2, "one accident", is a golden fixture that must reproduce**. This tracker assumes incidents are phase one, since a fixture no scheduled phase can satisfy is a gap rather than a plan. If that is wrong, UC §9.1 is the document to change, deliberately, with the reason recorded.

## Adding an entry

A finished item becomes **one row** in §2 or §3 — what it delivers, its proof with real counts, its gap ids — not a section. Anything it did not build becomes a row in §4 **with a track**. Anything that will cost a future session an hour to rediscover goes in §5. The narrative belongs in the commit message; this file is the index.
