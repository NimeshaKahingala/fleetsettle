# Build tracker

**Not a specification.** `docs/` says what to build and why; this says what is done. Where the two disagree, `docs/` is right. [Plan.md](Plan.md) says what remains and in what order; where *those* two disagree, this one is right, because it is the record and that one goes stale.

**Rewritten 4 August 2026**, from `b2cf367`. The previous edition was 760 lines of narrative in phase order; this is the same content reorganised so a finished phase is a row, every unfinished thing is one table with a track against it, and anything that costs a session to rediscover has its own section.

**Validated this pass** — route-def by route-def against `api/src/route-defs/`, screen by screen against `web/src/`, both against a real `npm run check`. Corrections in [§6](#6-what-validation-corrected).

---

## 1. Where things stand

**Backend is complete through P13.** **Frontend is complete through Web-P8b.** P14 and real Asgardeo are blocked on external work; CI's integration workflow is blocked on repository secrets.

| Gate | Result |
|---|---|
| `npm run check` | clean across `api` / `web` / `packages/shared` |
| `web` | 74 files / 264 tests |
| `packages/shared` | 11 files / 78 tests |
| `api` unit | 3 files / 10 tests |
| **`api` integration** | 29 files / 328 tests — **not in `check`**, needs the live Neon branch ([§5](#5-the-traps)) |
| `npm run lint` | 0 errors, 15 warnings — all `react-refresh/only-export-components`, expected ([§5](#5-the-traps)) |

The client reaches **14 routes**. §3.3's map names 19 paths; the five with no screen are `/cash`, `/partners/:id`, `/reports`, `/reports/:key`, `/period/close`, plus `/settings/*` (level-3 config, unscoped) and `/me`. `/people/customers/:id` exists but renders a placeholder.

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
| **GAP-4** | `paid_by_user_id` is recorded but raises no partner current-account entry — F-3.1's "no extra step" is unmet | A2 |
| **GAP-9** | F-7.1/7.3/7.5/7.6 are reads P7 deliberately left to a read phase | A2 / B2 |
| **GAP-12** | **Void-and-replace exists for `expense` only.** The other twelve W-50 tables carry the `voided_*` trio structurally, so the mechanism is proven — not each instance of it. A record created by mistake in any of the twelve cannot currently be reversed | **A9** |
| **GAP-13** | The close checklist does not count "unconfirmed days" — indistinguishable from a day the pattern never scheduled without replaying it | A3 |
| **GAP-15** | F-8.4's "deduct it from his fee" is `POST /api/offset` applied afterward, not a code path. A combined one-tap endpoint is UI-shaped work | B3 |
| **GAP-16** | **R2 presigned uploads.** Blocks condition photos at lease start (F-2.1 step 6) and close (F-2.6 step 5), incident damage photos, expense receipts, and the side-by-side comparison. `PhotoCapture` has **0 real callers**; `attachment` (DM §12) is already generic and polymorphic — one small endpoint unblocks all five | A7 |
| **GAP-22** | **`/people/customers/:id` renders `NotBuiltYetScreen`.** Web-P4 deferred it to "Web-P6's placeholder"; Web-P6a–d were all leases and shipped without it, and the plan never mentioned customers again. §3.3 specifies dues, payments, statement | **A4 / B6** |
| **GAP-23** | **F-5.2/F-5.3 never wired.** No obligation is raised for a trip's `agreedAmountMinor`, so no payment can allocate against it — the money floats as `unallocatedMinor`. `TripDetailScreen`'s "Received" row is `NotAvailable` naming this exact reason. **Design resolved and settled by the owner, 5 Aug 2026: post at booking (bookings are firm — no cancellation-fee concept exists and `hold` was never built), `kind: 'trip_fare'`, void on cancel.** W-41/INV-30 do *not* constrain this — income recognition is enforced by `trip.posted_period_id`, set only at close, entirely independently of any obligation | **A6** |
| **GAP-24** | `DriverDetailScreen` has no history sections — days, trips, advances, deposit. `driverBalancesResponseSchema` gives two totals and no breakdown | A5 / B5 |
| **GAP-29** | **`GET /api/advance` not built.** Deliberately skipped in Web-P8b — no caller in that phase, and building it without one is the half-built increment this codebase avoids. Belongs with whichever item builds the driver's advances section | A5 |
| **GAP-30** | **`expense.odometer_reading_id` has never been wired through any layer** — a DB column since P3, unlike `trip.opening_odometer_id` which P6 wired. Blocks fuel-fill's odometer and trip-link fields (both level 2). Wiring it means deciding whether a fuel fill creates its own `odometer_reading` row transactionally | A8 |
| **GAP-31** | **No endpoint lists a business's own members** (`app_user`/`business_member`), so `BorneByPaidBy`'s paid-by picker renders one honest option ("You"). W-48 is satisfied — two fields, never collapsed — but the second field cannot yet offer a real choice | A2 |
| **GAP-32** | Borne-by can only be overridden to **"Us"**. Overriding to a *specific* driver or customer other than the vehicle's current party needs either a live preview endpoint or a second "who currently holds this vehicle" lookup | A8 |
| **GAP-33** | **`GET /api/expense` has no caller.** Shipped deliberately ahead of any screen (report-adjacent, real value regardless), but §3.3's IA calls for none in phase 1. Revisit if a costs view is ever specified | — |
| **GAP-35** | **Voiding is not blocked in a closed period — a live defect, not a missing feature.** Migration `0006` makes `assert_period_open()` return early on any `UPDATE` leaving `posted_period_id` untouched, and a void sets only `voided_at`; `voidExpense` has no period check either. Voiding a July expense after July closes silently changes July's reported costs. **Fix in the trigger, not in thirteen domain functions** | **A9** |
| **GAP-36** | **`driver` and `customer` have no soft-delete column at all**, so a row created by mistake is permanent. `vehicle.lifecycle` has existed since `0001` but no endpoint ever moves it off `'active'`. `mileage_package`'s `archived_at` + archive endpoint is the reference pattern | **A9** |

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
- **`audit_log` no-ops every `DELETE`** (`DO INSTEAD NOTHING`, migration `0001`). An `app_user` is permanent from the moment anyone acts. Test cleanup must not try — it will compile, run, and silently do nothing. The fix lives in `tests/support/auth.ts`/`factories.ts`; production only ever revokes `business_member`.
- **15 ESLint warnings are expected**, all `react-refresh/only-export-components` in `router.tsx` (14, one per route component) and `ApiContext.tsx` (1). A direct consequence of the code-based-router decision. 0 errors is the bar; do not "fix" these by splitting the route tree.
- **`eslint-plugin-jsx-a11y` is deliberately absent** — its published peer range caps at ESLint 8/9 and this repo is on ESLint 10. **axe-core in Playwright is the a11y gate** until it catches up.

**Writing code**

- **A bare single-statement write to an audited table records `changed_by` as `NULL`.** `withActor` wraps `.transaction`, so a write that never opens one is invisible to it. P9 fixed nine such functions by wrapping them even where atomicity was not otherwise needed. **Any new write to a `posted_period_id`-carrying table must open a transaction.**
- **`payment.amount_minor` has `CHECK (> 0)`** — a full reversal can never zero it. `status = 'reversed'` carries "nothing here counts"; the wire response reports the true remaining figure separately.
- **`tailwind-merge` does not know this project's scale.** Any new `--text-*` or spacing token must be added to `theme.text`/`theme.spacing` in `web/src/lib/cn.ts` or it is silently dropped next to a real colour class. Regression test in `cn.test.ts`.

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

---

## Not in this tracker

UC §9.1 phase Third and UI §15 phase Third, listed so their absence is a decision: depreciation and disposal · driver retainers and spare-vehicle reassignment · loan and lease schedules · tax, if it applies · offline capture of photos · the desktop analytical dashboard beyond UI §14's three changes.

## Blocked

| Blocked | Waiting on |
|---|---|
| **CI's integration workflow** | `secrets.NEON_API_KEY` / `vars.NEON_PROJECT_ID`, which do not exist in the repo. `integration.yml` creates, seeds and **deletes** a per-PR Neon branch — not optional on the free plan, where branch creation starts failing around nine open PRs, and fails on *someone else's* PR for a reason that looks unrelated (IG §9.2) |
| **Real Asgardeo** (Track B, last) | Console: token type → JWT, binding → None, redirect URL cleanup. ~10 minutes; blocks nothing else |
| **P14** — messaging | Twelve Meta template approvals |

## One open question, still unresolved

UC §9.1's phase lists name incidents nowhere — not First, Second or Third — yet **G-2, "one accident", is a golden fixture that must reproduce**. This tracker assumes incidents are phase one, since a fixture no scheduled phase can satisfy is a gap rather than a plan. If that is wrong, UC §9.1 is the document to change, deliberately, with the reason recorded.

## Adding an entry

A finished item becomes **one row** in §2 or §3 — what it delivers, its proof with real counts, its gap ids — not a section. Anything it did not build becomes a row in §4 **with a track**. Anything that will cost a future session an hour to rediscover goes in §5. The narrative belongs in the commit message; this file is the index.
