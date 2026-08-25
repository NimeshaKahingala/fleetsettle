# FleetSettle — Code Evaluation & Bug Report

**Date:** 2026-08-23 00:00 UTC (Asia/Colombo +5:30)
**Branch:** `docs/gap-170-printed-slip-and-qa-pass` — HEAD `54bfd21`
**Evaluator:** Muse Spark (opencode) — parallel sub-agents + manual spot reads
**Scope:** `api/src/domain|handlers|queries|middleware`, `packages/shared`, `web/src`, `api/migrations`, `docs/engineering/*` vs `api/src/db/schema.ts`
**Automated gates:** `npm run guard` clean, `npm run typecheck` clean (api/web/shared), `eslint`/`check-forbidden` clean — so remaining issues are logic not caught by tooling.

> This is a living document. Further validations are appended in §7 with timestamps. Do not treat §3 as exhaustive until §7 says so.

---

## 1. Project — Clear Understanding

**What it is:** Ledger for a small Sri Lankan vehicle-rental business — 1 bus + 2 cars, 2 partners. One partner enters everything, the other reads reports. Whole promise is being believed about money — every rule exists because breaking it produces a plausible wrong number noticed months later (`CLAUDE.md:5`).

**Three arrangements by cost-bearer, not vehicle type** (`docs/product/use-cases.md:17`):
- **A Lease out** — customer runs, pays fixed `rent_amount_minor` per billing period + mileage excess (`W-24`/`W-25`). Odometer = billing.
- **B Daily lease to driver** — driver pays `daily_lease_amount_minor` per operating day, bears fuel/tolls (`W-7`). Odometer optional (`W-20`).
- **C Operated hire** — charter/short hire, one flow (`W-40`): customer pays `agreedAmountMinor`, we pay driver `driver_fee_minor`.

**Key invariants:** `INV-1` one arrangement/vehicle-day (`vehicle_day_allocation` PK `api/migrations/0001_initial_schema.sql:397`), `INV-2` earned vs received separate (`day_record.earned_minor` vs `obligation.settled_minor` `docs/engineering/data-model.md:38`), `W-2` two driver balances never netted + `offset_record`, `W-40` billing period (12th→11th) ≠ accounting period (calendar month).

**Stack** (`docs/engineering/tech-stack.md:12`): Workers + Neon Postgres 17 + `@neondatabase/serverless` (`neon()` reads / `Pool` WS writes `api/src/db/client.ts`) + Drizzle (query only, hand-written forward-only migrations) + Asgardeo OIDC `jose` + KV JWKS cache (`audience = clientId OEWdJbFmoc65GbQkr4WwuBlEfnUa`) + React 19 + Vite + TanStack Query/Router + Radix + Recharts (`web/package.json:6`) + R2/KV/Queues/Cron. Money is `bigint` minor units, `string` on wire (`packages/shared/src/money.ts:1`, `TS §6`), split by largest-remainder (`packages/shared/src/split.ts:20`).

**Architecture** (`docs/engineering/implementation-guidelines.md:116`): `constants → schemas → queries → domain → route-defs → handlers → routes` (`api/src:12` dirs). `queries/*` pure SQL, `domain/*` owns multi-row transactions (confirmDay = 4 inserts). `business_id` resolved from JWT `sub → app_user → business_member`, never from body (`CLAUDE.md:51`, `api/src/middleware/auth.ts:32`). Platform tier `api/src/queries/platform/` isolated behind `platformAdminMiddleware` on `/api/admin/*` (`IG §7.6`).

**Docs hierarchy** (`docs/README.md:5`): 7 docs `use-cases > user-flows (62 flows F-n, 31 INV-n) > data-model > tech-stack > implementation-guidelines > ui-ux > brand`. `TRACKER.md` is the build record, `Plan.md` the 11-wave plan (Wave 0–5 ✅), golden fixtures `134,000 / 15,000 / 7,500` are the regression suite. Deployed `qa.fleetsettle.com`/`fleetsettle.com` (`DEPLOYMENT.md:44`), `main` deploys on merge with no human gate after PR.

**Current state:** Phase 1 largely through Wave 5; remaining per `Plan.md:5` header: `GAP-147` void/correction endpoints lacking client, `LT-9/LT-10` live-browser checks, then Release. Platform tier spec merged 18 Aug (`use-cases v1.2.14`), bootstrap SQL `DEPLOYMENT.md:362` not yet run (zero `app_user` rows). Latest commits refresh scenario catalogue (`docs/qa/scenarios/*`).

---

## 2. Methodology

- Parallel explore sub-agents: 20 domain + 14 handlers + queries/middleware/migrations; shared `money.ts`/`split.ts`/`schemas/*`; web `features/*` + `lib`/`components`/`app` (15+ feature files).
- Manual reads: `api/src/domain/incident.ts`, `api/src/domain/expense.ts`, `api/src/domain/confirmDay.ts`, `api/src/domain/trip.ts`, `api/src/queries/reports.ts:1337`, `packages/shared/src/money.ts`, `web/src/lib/formatShortDate.ts`, plus `grep` for `T00:00:00`, `Date.parse`, `WIRE`, `fromInput`.
- Automated signals: `npm run guard`, `npm run typecheck`, `grep` for `TODO/FIXME`, `business_id` leaks, `z.number()` on money.

---

## 3. Bugs — Ranked by Severity

> Every row cites an absolute path + line so it is checkable without search.

| # | Severity | File:Line | Class | One-line |
|---|----------|-----------|-------|----------|
| B1 | MEDIUM | `api/src/domain/incident.ts:612` | `belongs_to_period_id` missing | `submitInsuranceClaim` inserts `insurance_claim` with `postedPeriodId` only `api/src/domain/incident.ts:619`. Paired `incident_recovery` correctly spreads `belongsToPeriodId` `api/src/domain/incident.ts:628`. Late claim (claimed Jul, settled Sep) mis-reports in DM §15 month-by-month bucket. |
| B2 | MEDIUM | `api/src/queries/reports.ts:1346` | Voided allocation counted | `countAllocatedDaysForVehicle` raw `SELECT COUNT(*) FROM vehicle_day_allocation ... is_hold=false` with no `voided_at IS NULL`. Post-`0022` voided rows still counted for UC-79 utilisation. Siblings filter `isNull(dayRecord.voidedAt)`. |
| B3 | MEDIUM | `web/src/features/home/HomeScreen.tsx:55`, `:62`, `web/src/features/vehicles/VehicleCalendarScreen.tsx:127`, `:136`, `web/src/features/trips/BookTripScreen.tsx:54`, `web/src/features/trips/TripDetailScreen.tsx:44`, `web/src/features/vehicles/VehicleOverviewScreen.tsx:83`, `web/src/features/period/CloseMonthScreen.tsx:34`, `:234`, `web/src/features/leases/LeaseHubScreen.tsx:74`, `web/src/features/leases/CloseLeaseScreen.tsx:83`, `web/src/features/leases/AdjustmentsSheet.tsx:40`, `web/src/features/people/CustomerDetailScreen.tsx:52`, `web/src/features/people/AdvanceSettlementsSheet.tsx:36`, `web/src/features/people/WriteOffRecoveriesSheet.tsx:30`, `web/src/features/incidents/IncidentScreen.tsx:68` (14 sites) | Timezone: local midnight | `new Date(\`${date}T00:00:00\`)` without `Z` → device-local midnight, shifts by DST/offset (Colombo +5:30, off by one day 5.5h/day `CLAUDE.md:44`). Correct pattern `web/src/lib/formatShortDate.ts:16` `T00:00:00Z`+`timeZone:"UTC"`, `web/src/components/DateField.tsx:14`. |
| B4 | MEDIUM | `api/src/queries/reports.ts:894` | Ageing off-by-timezone | `listAgeingBuckets` `Date.parse(asOfDate)-Date.parse(row.effectiveDueOn) / 86400000`. `asOfDate`/`effectiveDueOn` are `date` columns, `Date.parse` interprets at UTC midnight while business day is `Asia/Colombo` → edge dates mis-bucket `current` vs `1-30`. |
| B5 | LOW | `api/src/domain/expense.ts:129`, `api/src/domain/incident.ts:251` | TOCTOU period linkage | `resolvePeriodLinkage(writer, …)` outside `writer.transaction`, then `insertExpense(tx, {postedPeriodId: linkage…})` `api/src/domain/expense.ts:146`. Concurrent `closeAccountingPeriod` makes trigger throw rather than clean `PeriodClosedError`. Same for `recordCustomerContribution` `api/src/domain/incident.ts:251`. Correct inside-tx pattern `api/src/domain/deposit.ts:46`, `api/src/domain/payment.ts:61`. |
| B6 | LOW | `api/src/domain/reports.ts:321` | Money `Number()` | `Number(profitMinor)/distanceKm` for `profitPerKm`. Isolated display ratio, but silent loss if `profitMinor > 9e15` (≈ Rs 90M) — mis-ranks year report at scale. |
| B7 | LOW | `packages/shared/src/money.ts:25`, `:49` | Codec leniency | `WIRE ^-?\d+$` accepts `-0` (`parse("-0")→0n`, `toWire(0n)="0"` non-round-trip). `fromInput` regex allows `"5."` → `500n` via `padEnd(2,"0")` `packages/shared/src/money.ts:59` while `parse("5.00")` throws — two entry points disagree. |
| B8 | INFO | `api/src/domain/adjustment.ts:206` | Void cascade partial | `voidAdjustment` unwinds `payment_allocation` only, not `offset_allocation`. If obligation settled via offset, `unwound < excess` → `400` `"some may be settled through an offset instead"`. By design, but caller must void offsets first. |
| B9 | INFO | `api/src/domain/opening-balance.ts:295` | Deposit reversal period | Reversal of `taken` deposits posts `refunded` at `priorGoLiveDate`’s period; if closed, entire `saveOpeningBalance` `409 PERIOD_CLOSED`. No alternative posted-to-open-period path. |

### Detail

**B1 — `insurance_claim.belongs_to_period_id` never set.** Schema has the column (`api/migrations/0001_initial_schema.sql:463`), every other money writer spreads `...(linkage.belongsToPeriodId !== null ? {belongsToPeriodId} : {})` (`api/src/domain/adjustment.ts:118`, `api/src/domain/payment.ts:78`, `api/src/domain/incident.ts:621`). `submitInsuranceClaim` omits it `api/src/domain/incident.ts:612`, so W-35 late-claim reporting cannot relocate.

**B2 — utilisation counts voided days.** `0022_void_everywhere.sql` voided allocations rather than deleting them, but `countAllocatedDaysForVehicle` raw SQL `api/src/queries/reports.ts:1346` does not filter `voided_at`. A cancelled trip or freed daily-lease day still counts as earning.

**B3 — device-local date formatting.** Grep `T00:00:00"` finds 14 call sites without `Z` (`web/src/features/*`), while `DateField.tsx:14` and `formatShortDate.ts:16` use the correct `Z`+`UTC` pattern. On a device in IST vs UTC the formatted label can be off by one calendar day.

**B4 — ageing buckets use UTC parse.** `Date.parse("2026-08-23")` is UTC midnight; business date is Colombo wall time. At the bucket boundary (`daysLate <=0` vs `<=30`) a Colombo `2026-08-23` vs UTC `2026-08-22T18:30Z` difference can mis-bucket by one day.

**B5 — linkage resolved outside transaction.** Trigger still blocks the write (so not a bypass), but turns a clean domain error into a DB exception path and an extra retry for the caller.

**B6 — `profitPerKm` ratio.** Sanctioned with `eslint-disable` comment `api/src/domain/reports.ts:318`, but precision loss is silent past `MAX_SAFE_INTEGER`.

---

## 4. Docs vs SQL Drift (spec lies, not runtime bugs — schema is correct)

| Doc vs SQL | Doc says | SQL has |
|---|---|---|
| `business_creation_request.status DEFAULT 'pending'` | `docs/engineering/data-model.md:282` | `api/migrations/0030_platform_tier.sql:38` no DEFAULT (explicit set) — `api/src/db/schema.ts:90` `.default("pending")` matches docs, diverges from SQL |
| `insurance_claim`/`incident_recovery` `business_id` | DDL blocks `docs/engineering/data-model.md:911`, `:927` omit `business_id` | `api/migrations/0004_business_id_on_audited_child_tables.sql:23` adds both; `api/src/db/schema.ts:748` correct |
| `expense.voided_by` | `docs/engineering/data-model.md:847` DDL omits `voided_by` | `api/src/db/schema.ts:523` + `api/migrations/0007_expense_voided_by.sql` has it |
| `offset_allocation` void trio | `docs/engineering/data-model.md:1173` omits `voided_at/voidedBy/voidedReason` | `api/migrations/0024_offset_allocation_void.sql` + `api/src/db/schema.ts:572` has it |
| `excess_borne_minor` / `received_amount_minor` `CHECK >=0` | DM §2 convention sweep | `api/migrations/0001_initial_schema.sql:456`, `:459`, `:473` + docs `docs/engineering/data-model.md:915`, `:918` omit `CHECK >=0` (every other money column has it) |

Also: `docs/engineering/data-model.md:746` note already acknowledges `businessId` drift for `insurance_claim`, but DDL blocks not updated; `0030:107` `audit_actor()` canonical vs docs snippet `current_setting('app.actor_id')`.

---

## 5. Verified Good (intentionally not bugs)

- No `z.number()` on money fields; only `moneyWireSchema = z.string().regex(/^-?\d+$/).transform(parseMoney)` (`packages/shared/src/schemas/common.ts:12`).
- No `business_id` taken from body/query; `W-49` linked-driver boundary 404-tested.
- All money writes in one `writer.transaction`; `isPeriodClosedViolation` mapped to `PeriodClosedError`; `replaces_id` unique-constraint idempotency `api/src/domain/expense.ts:191`.
- `split.ts:20` largest-remainder correct; `TwoBalances` never netted `web/src/components/TwoBalances.tsx:28`.
- `toISOString().slice(0,10)` zero hits; LKR cents inside `MAX_SAFE_INTEGER` so tests would not catch `Number` loss — hence `lint` + `guard` matter.

---

## 6. Recommendations (fix order)

1. **B1, B2** — one-line spreads/filters, affect reported money/days.
2. **B3** — codemod `T00:00:00 → T00:00:00Z` + `timeZone:"UTC"` across 14 sites; add `check-forbidden` rule for bare `T00:00:00"` (same as `toISOString` guard).
3. **B4** — replace `Date.parse` diff with calendar-day diff (`inclusiveDays`/`addDays` string arithmetic as `api/src/domain/incident.ts:150` does).
4. **B5** — move `resolvePeriodLinkage` inside `writer.transaction` (2 files).
5. **Docs drift** — sync DDL blocks from `api/migrations/*.sql` into `docs/engineering/data-model.md` (or generate DDL from migrations as `IG §1.6` warns).

---

## 7. Further Validations — Live Log

_Update as validations run; each entry is append-only with timestamp._

### 2026-08-23T00:00Z — Initial pass
- Sub-agents: 20 domain + 14 handlers + shared + web (15+ features). Signals: `guard` clean, `typecheck` clean. Greps: `T00:00:00"` 14 hits, `Date.parse` 1 hit, `WIRE`/`fromInput` 2 leniencies, `z.number()` 0 on money.

### 2026-08-23T01:15Z — Further validations (round 2)

**Voided-row filter scan (`api/src/queries/*`, 134 `isNull(voidedAt)` hits):**
- Checked all void-capable tables from `0022_void_everywhere.sql` + `0024_offset_allocation_void.sql`: `vehicle_day_allocation`, `payment_allocation`, `day_record`, `opening_balance_entry`, `offset_allocation` + money tables `expense`, `adjustment`, `obligation`, `advance`, `banking_event` etc.
- Result: broadly correct. `vehicle.ts:252` `isNull(vehicleDayAllocation.voidedAt)`, `vehicle.ts:211` `isNull(dayRecord.voidedAt)`, `day-record.ts:168`, `:182`, `:212`, `:241`, `:271`, `:326`, `:396` all filter `voidedAt`. `reports.ts` filters `isNull(obligation.voidedAt)` / `isNull(expense.voidedAt)` throughout, and `listVehicleUnavailabilityForVehicle` `vehicle.ts:400` filters. **One confirmed miss remains B2** `api/src/queries/reports.ts:1346` raw SQL `vehicle_day_allocation` missing `voided_at` (already in §3). No other `vehicle_day_allocation` read missing the filter. `payment_allocation`/`offset_allocation` reads via `queries/payment.ts` / `queries/adjustment.ts` filtered via `isNull(voidedAt)` where applicable; `driver-money.ts` advance settlement correctly filters.

**Period-trigger drift:**
- Script is `api/scripts/check-drift.mjs` + `api/scripts/assert-no-trigger-drift.sql:1` — queries `pg_attribute where attname='posted_period_id'` for missing `_period_open` + `_audit` triggers. Cannot run without `DATABASE_URL` Neon branch, but **code path is sound**: every money table discovered via catalogue, not hand list, so cannot drift as `0002_audit_log_writer.sql:73` does for audit. Hand-maintained `_period_open` array in `0001_initial_schema.sql:952` historically drifted (`trip` missing, fixed 18 Aug — DM §13). Current array expected 19 tables; live check would be `clean` per doc claim `docs/engineering/data-model.md:1702`. Flagged for CI rerun when DB available.

**`Number()` triage (`grep -R "Number(" api/src`):**
- `api/src/queries/reports.ts:1353` `Number(count)` — day count, not money (with `eslint-disable -- day count`).
- `api/src/queries/accounting-period.ts:250` `Number(count)` — row count.
- `api/src/queries/expense.ts:296` `Number(total)` — `SUM(litres)` fuel volume (`numeric(8,2)`), comment `litres, a fuel volume, not money`.
- `api/src/domain/mileage.ts:308` `Number(km)` — `BigInt(excessKm)` kilometres.
- `api/src/domain/reports.ts:321` `Number(profitMinor)/distanceKm` — **B6**, display ratio, already listed.
- **No money `Number()` other than B6.** Confirmed by `eslint` `no-restricted-syntax` on money + `guard` clean.

**Layer / `queries/platform` isolation:**
- `api/src/queries/platform/business-creation-request.ts:9` and `platform-admin.ts:3` import only `appUser`, `businessMember`, `platformAdmin`, `platformAuditLog` from `db/schema.ts` — no money-table imports. `check-forbidden` rule for `queries/platform → money-table schema` would have flagged, did not. `IG §7.6` boundary intact.

**Lint / css:**
- `npm run lint` — 0 errors, 64 warnings. All warnings are `react-refresh/only-export-components` on `VehicleMonthReportScreen.tsx:34`, `ReviewThisMonthScreen.tsx:28`, `ApiContext.tsx:17`, `AuthActionsContext.tsx:48` + one `Unused eslint-disable` on `UtilisationReportScreen.tsx:24` — none is a bug.
- `npm run lint:css` — clean (stylelint).
- `100vh` vs `100svh`: grep finds `100svh` only at `web/src/design/primitives/AppShell.tsx:101`, `:139` — correct, no `100vh` in `web/src`.
- `#[0-9a-f]` hex outside `tokens.css`: only `web/src/design/tokens.css` + `web/src/design/tokens.test.ts` guard, zero feature hits (comments referencing tokens excluded).

**Web `?? []` / `?? 0` hygiene (GAP-101):**
- `grep "?? []"` ~35 hits, `?? 0` ~8 hits. Pattern is `const data = query.data ?? []` then later `QueryStateFailure` gate. Examples `web/src/features/home/HomeScreen.tsx:298` + `web/src/features/costs/RecordExpenseSheet.tsx:141` + `web/src/features/vehicles/VehicleCalendarScreen.tsx:202` — `?? []` runs before the error gate (`failedState`/`QueryState` `kind==="error"`), but render is gated later (`QueryStateFailure` prevents empty-state lie). No `?? []` hides a failed read behind a confident `Rs 0` vs `NotAvailable` confusion as pre-GAP-101 did; arithmetic on `[]` yields `ZERO`/`0` but is also shown alongside the error `NotAvailable` strip. Low residual risk, not a re-introduction of the bug. `ExpenseCostRow.tsx:54` `?? 0` for `attachmentsQuery.data?.length` is receipt count, not money — correctly paired with pending check.

### 2026-08-23T02:45Z — Further validations (round 3) — full gate + deep domain/reports/security

**Full gate (no DB):**
- `npm run guard` — clean `guard: clean` (exit 0).
- `npm run lint` — 0 errors, 64 warnings (all `react-refresh/only-export-components` on `VehicleMonthReportScreen.tsx:34`, `ReviewThisMonthScreen.tsx:28`, `ApiContext.tsx:17`, `AuthActionsContext.tsx:48` + `Unused eslint-disable` on `UtilisationReportScreen.tsx:24`). No money/timezone/tenancy lint hits.
- `npm run lint:css` — clean.
- `npm run format:check` — `All matched files use Prettier code style!`.
- `npm run typecheck` — clean (api/web/shared `tsc --noEmit`).
- `npm test` (unit + shared, no Neon) — **146 web files / 873 tests passed**, **12 shared files / 91 tests passed** (vitest `54.01s` + `1.05s`). Integration tests not run (needs `DATABASE_URL` Neon branch — expected `TEST_DATABASE_URL must not equal DATABASE_URL` guard per `api/tests/support/env.ts`).

**Deep domain — new HIGH/CRITICAL (beyond B1–B9):**
| # | Sev | File:Line | Detail |
|---|---|-----------|--------|
| **B10** | **HIGH** | `api/src/domain/deposit.ts:143` | Deposit held race — `sumDepositMovements(tx, depositId)` `api/src/queries/driver-money.ts:553` has no `FOR UPDATE` on `deposit_movement` rows → two concurrent `recordDepositMovement(reduced 800)` both read `held=1000`, both pass `amount > held` check `deposit.ts:145`, final SUM negative. No DB `CHECK (held>=0)` (balance derived). Same void path `deposit.ts:325`. Fix: `SELECT ... FOR UPDATE` on deposit before sum, or row-lock movements. |
| **B11** | **HIGH** | `api/src/domain/offset.ts:56` / `:220` | Offset outstanding TOCTOU + silent partial allocation — `sumOutstandingByDirectionForDriver` `offset.ts:56` no `FOR UPDATE`, then `allocateAgainstOldest` `offset.ts:220` does `FOR UPDATE` but caller never asserts `remaining===0` (`offset.ts:99`). Two concurrent `createOffset(1000)` with `outstanding=1000` both pass, Tx1 fully allocates, Tx2 inserts `offset_record amount=1000` with zero `offset_allocation` rows — money record without settlement, violates `INV-3`. Also `deductFromDriverFeeTx:156` missing `owed_to_us` outstanding check → `updateObligationSettled` `offset.ts:187` can set `settled > amount` → raw DB `CHECK` throw not `ValidationError`. |
| **B12** | **CRITICAL** | `api/src/domain/write-off.ts:255` | Write-off void guard outside transaction — `findWriteOffForBusiness(writer)` + `findLiveRecoveriesForWriteOff(writer)` `write-off.ts:255`, `:259` outside `writer.transaction:275`. Concurrent `recordWriteOffRecovery` between check and void inserts live recovery, void proceeds with orphaned recovery `payment` (spendable credit). Violates `INV-36 §3.7` refuse while live recovery exists. Also `voidedAt` check `write-off.ts:257` races. |
| **B13** | **CRITICAL** | `api/src/domain/party-archive.ts:142` | Archive TOCTOU — `findDriverForBusiness(reader)` + `assertArchivable(reader)` `party-archive.ts:142`, `:146` via `Reader` outside `writer.transaction:156`. Between `146` `findOpenMoneyForParty` and `156 archiveDriverRow(tx)` a new `obligation pending`/`deposit held`/`advance open` can be inserted → archive succeeds with open money, violates `INV-35`/`W-60`/`UC-100`. Same for `archiveCustomer:185`. Needs `FOR UPDATE` inside tx or serializable. |
| **B14** | **HIGH** | `api/src/queries/obligation.ts:392` / `api/src/domain/payment-correction.ts:152` / `api/src/domain/write-off.ts:62` | `updateObligationSettled` / `applyAdjustmentToObligation` / `reverseAdjustmentOnObligation` `obligation.ts:392`, `:246`, `:376` do `UPDATE obligation SET ... WHERE id=?` without `AND businessId=?`. Scoped reads (`findObligationForBusiness`) gate it, but a bug passing wrong `obligationId` cross-tenant mutates. Also `payment-correction.ts:152` `findObligationForBusiness` without `forUpdate:true` → concurrent `correctPayment` unwinds race (`settledMinor - take` both read 100 → final 50 not 0). `write-off.ts:62`, `:277` same missing `FOR UPDATE`. |
| **B15** | **MEDIUM** | `api/src/domain/payment-correction.ts:104` / `api/src/domain/write-off.ts:77` | Period linkage after writes — `resolvePeriodLinkage` after `unwindAllocations`/`updateObligationSettled`. Atomic rollback safe but holds `FOR UPDATE` locks longer; canonical order is linkage first as `deposit.ts:46`. Low functional risk, but wastes lock time. |
| **B16** | **MEDIUM** | `api/src/queries/driver-money.ts:621` | `listOffsetsForDriver:621` missing `voidedAt IS NULL` — unlike `listAdvancesForDriver:99` and `sumOutstanding` filters, voided offsets returned → driver statement inflates if summed naïvely. Inconsistent with `listWriteOffsForBusiness:101` which intentionally includes voided (struck-through). |
| **B17** | **LOW** | `api/src/domain/offset.ts:279` | `voidOffset:279` `findObligationForBusiness(tx,businessId,alloc.obligationId)` without `forUpdate:true` (unlike `deposit.ts:295` correct). Concurrent `voidOffset` + `allocateAgainstOldest` last-write-wins on `settledMinor`. |

**Deep reports — confirmation + one re-confirmation of B2:**
- **Lost-days denominator** `api/src/queries/reports.ts:1107`, `:1162` already fixed `GAP-147` — `COUNT FILTER (state='did_not_run' OR LIKE 'ran_%')` + `HAVING >0` + `voidedAt IS NULL` — correct, no re-inflate. `listLostDaysByReason:1219` scoped `did_not_run` only.
- **Goodwill** `api/src/queries/reports.ts:1285` `SUM(-sign * amountMinor)` + `voidedAt IS NULL` + `occurredOn BETWEEN` — correct; `SUM` without `COALESCE` safe due `GROUP BY` + `zeroSeeded` but defensive `COALESCE` noted as INFO.
- **Vehicle PnL** `api/src/queries/reports.ts:87`, `:231` earned (`rent`/`daily_amount`/`mileage_excess` + trip `closed`) vs costs (`borne_by='us' expense` + `driver_fee`/`management_fee` obligation) — correct, `G-1 134,000` gate. Overheads excluded from per-vehicle, read separately `sumOverheadsForPeriod:545`.
- **Cash position** `api/src/queries/reports.ts:931` `received(active) - banked(voidedAt IS NULL, countedMinor) - advanced(status<>'settled')` — correct per DM §15, documented `part_settled` simplification (`part_settled` counted at full `amountMinor` `reports.ts:994`, `:1049` — tracked simplification, not a new bug).
- **Utilisation** — `countOffRoadDays` dedup via `Set` correct; `listOffRoadRanges`/`listVehicleUnavailabilityRanges` correct. **B2 re-confirmed** `api/src/queries/reports.ts:1346` raw `vehicle_day_allocation` missing `voided_at IS NULL` — only remaining voided-filter miss after full scan of 22 money/occupancy tables in `reports.ts`.
- **Partner summary** effective-dating `findOwnershipSharesAsOfBulk:611` `lte(effectiveFrom) AND (effectiveTo IS NULL OR >=asOfDate)` + `orderBy(id)` UUIDv7 → `split.ts` largest-remainder deterministic — correct.
- **Ageing** re-confirmed B4 — `Date.parse` in `reports.ts:894` spec `docs/engineering/data-model.md:1857` notes Worker-side at small scale intentionally, SQL form has no such mode.

**Security & tenancy — PASS (deepened from round 2):**
- Tenant: zero `business_id` from body/query; single header read `api/src/middleware/auth.ts:32` selector over DB `memberships.find(m=>m.businessId===header)` → `c.set("businessId", membership.businessId)` row value `auth.ts:56` (IG §7.5 step 4). Every handler follows `requireBusinessId(c)` + `findXForBusiness(reader,businessId,id)` (`vehicle.ts:73`, `driver.ts:48`, `payment.ts:41`, `reports.ts:58` etc.). Exceptions `business.ts:9`, `invite.ts:7`, `session.ts:19` (`verifyTokenMiddleware`, no business — F-0.1 creator) and `admin.ts:32` (`requireUserId` only, no business — platform tier) are correct.
- Platform isolation IG §7.6: `api/src/index.ts:92` `app.use("/api/admin/*", dbMiddleware(), platformAdminMiddleware())` never `authMiddleware`; `middleware/platform-admin.ts:32` sets only `userId`/`isPlatformAdmin` never `businessId`; `queries/platform/*:1` imports only `appUser`/`businessMember`/`platformAdmin`/`platformAuditLog`/`business`/`businessCreationRequest` — zero money tables; `check-forbidden` guard would flag, did not.
- Linked driver INV-25: `handlers/driver-view.ts:70` `viewOwnData` + `requireDriverId` from `authMiddleware:59`, no `driverId` param; `queries/identity.ts:62` `UNION ALL` dedup per `businessId` preferring member row. Staff twin `handlers/driver.ts:136` business-scoped + `dailyOperations` capability gate → linked driver 403. Reports `viewReports` flat STAFF today (per-vehicle manager scoping deferred per `policy.ts:23` comment — accepted debt).
- Rate limit `middleware/rate-limit.ts:14` per-IP `CF-Connecting-IP` + global `app.use("*")` — per-IP by design (`businessId` unavailable before auth), shares `namespace_id 1001/1002/1003` per env so QA not burning prod. Not a bypass.
- CSP `web/public/_headers:21` `default-src 'self'; img-src 'self' blob:; connect-src 'self' https://api.asgardeo.io; frame-ancestors 'none'` — meets IG §10.9, minimal.
- R2: `handlers/attachment.ts:185` Worker proxy `requireBusinessId` `186` → `findAttachmentForBusiness` `190` → `requireCapability` `194` → `c.env.R2.get(r2Key)` `196` → `private, no-store` — never presigned; `web/src/lib/api.ts:61` `getBlob` through Worker with `Authorization` + `X-Business-Id`. IG §10.10 compliant.
- OWASP: `drizzle-orm` parameterized only (`eq`/`and`/`sql` template bindings); `errors/handler.ts:14` only `AppError.message`/`code` returned, stack only server-side for 5xx; `db/schema.ts:779` `auditLog` append-only via `write_audit_log()` trigger 0002, platform audit separate `schema.ts:100`.
- Header injection: `X-Business-Id` filter not grant (404 not 403 `auth.ts:38`, `CLAUDE.md` tenancy).
- Capabilities `auth/policy.ts:55` — `writeOffOrWaiveAboveThreshold`/`reverseReceipt`/`closePeriod`/`managePartnerCapital` all OWNERS; `voidAdjustment:106` stays `dailyOperations` even for large waiver (noted as INFO, intentional).

**Web deep (from bash greps + prior round 3 sub-agent):**
- `100vh` zero hits, `100svh` only `AppShell.tsx:101`, `:139` — correct (`IG §6.1`).
- `#[0-9a-f]` hex only `tokens.css` + `tokens.test.ts` guard — no feature hex.
- `useQueryState` 368 hits (`web/src/lib/useQueryState.ts:1`), `QueryStateFailure`/`NotAvailable` hygiene per GAP-101 — `HomeScreen.tsx:291` `combineQueryStates` error beats pending beats idle, not hiding `?? []`.
- Money formatting: `Money` `web/src/components/Money.tsx:15` + `MoneyField` + `web/src/lib/chartAxis.ts:20` only sanctioned `Number(Minor)` for Recharts axis with `MAX_SAFE_INTEGER` guard.
- `min-h-tap` 44px floor on `Button.tsx:29`, `Input.tsx:16`, `MoneyField.tsx:71`, `EntityPicker.tsx:65`, `Sheet.tsx:40` + `useCloseWatcherDismiss` — no sub-44px tappable found.
- Offline: `Screen.tsx:38` `offlineBanner` slot + `main.tsx:64` QueryState retry behind 3 attempts (M-12).

**Next:**
- [ ] Patch B1–B17 in severity order (CRITICAL B12/B13 → HIGH B10/B11/B14 → MEDIUM B2/B4/B5/B15/B16).
- [ ] Run `npm run check` + Neon integration tests on a branch (`npm run test:integration`) to verify drift + `134k/15k/7.5k` fixtures before merge.
- [ ] Codemod B3 (`T00:00:00` → `T00:00:00Z`) and add `check-forbidden` rule for bare `T00:00:00"`.


---

## 8. How to Use This Document

- **Before changing behaviour, read the owning spec** (`docs/README.md` read order). Where this report disagrees with `docs/`, `docs` wins until changed deliberately via `doc-change` skill (`.claude/skills/doc-change/SKILL.md`) with reason recorded.
- **Money table touch → run** `npm run guard && npm run typecheck && npm run test` and `node api/scripts/check-drift.mjs` (DM §13).
- **Exemptions** require `// eslint-disable-next-line … -- reason` or `-- allow: <reason>` in SQL — visible in diff.

---

## 9. Ten Areas — Code-Level Deep Validation (2026-08-23T03:30Z)

> Minimum 10 distinct areas, each audited against source with `file:line` citations. Severity: `CRITICAL` = wrong money / security bypass / data loss; `HIGH` = race / correctness under concurrency; `MEDIUM` = spec lie / reporting drift / lock order; `LOW` = leniency / hygiene; `INFO` = by-design / deferred.

### Area 1 — Error Handling & Failure Modes

**Scope:** `api/src/errors/app-error.ts:8`, `api/src/errors/handler.ts:14`, `api/src/db/pg-error.ts:56`, `api/src/handlers/*`, `api/src/domain/*`

- **PASS:** Single `AppError` base `app-error.ts:8` + `app.onError` `handler.ts:14` emits `{error,code,requestId,details}` (IG §3.3), `warn` for 4xx / `error`+stack for 5xx, no handler hand-rolls error shape. Non-`AppError` → `500 INTERNAL_ERROR` `handler.ts:17`.
- **PASS:** `PERIOD_CLOSED` uniformly `409` `app-error.ts:57` (not 400), `VALIDATION_ERROR` 400 `app-error.ts:21`, `NOT_FOUND` 404 `app-error.ts:42`, `FORBIDDEN_CAPABILITY` 403 `app-error.ts:48`, all 9 already-voided + `VoidBlocked` + `ReplacesTarget*` 409 `app-error.ts:385`. `VoidBlocked` carries `details.blocking[{kind,id,amountMinor}]` `app-error.ts:471` — UI actionable.
- **B18 MEDIUM — fragility:** `isPeriodClosedViolation` `pg-error.ts:57` matches `code==="P0001" && message.includes("is closed")` — English substring from trigger `0001` `assert_period_open()`. Migration wording change silently becomes 500. Same for `isSharesNotFullViolation` `"must be 10000"` `pg-error.ts:30`. Needs regression test pinning trigger message.
- **B19 MEDIUM — insurer double-claim 500:** `submitInsuranceClaim` `api/src/domain/incident.ts:580` does app `findIncidentRecoveryBySource → InsuranceClaimAlreadyExistsError` but no `isUniqueViolation` catch for concurrent `submitted` inserts racing DB constraint → bubbles 500 not 409. Add `isUniqueViolation` catch for `insurer` unique.
- **B5 re-confirmed MEDIUM:** `resolvePeriodLinkage(writer)` outside `writer.transaction` in `expense.ts:129`, `incident.ts:251`, `advance.ts:53` → relies on trigger fallback; move inside `tx` like `deposit.ts:46`. `voidWriteOff` `write-off.ts:255` + `voidAdvance` `advance.ts:269` blocker check outside tx → INV-36 window.
- Uniform `ReplacesTarget` trichotomy correct: `404` not found vs `409 REPLES_TARGET_NOT_VOIDED` `app-error.ts:485` vs `409 REPLACES_TARGET_ALREADY_REPLACED` via `isUniqueViolation(...replaces_id_key)` `write-off.ts:121` — checked across 13 tables; cross-entity party guard added since Gitar PR #45 (`target.driverId !== input.driverId`).

### Area 2 — Concurrency & Transaction Isolation

**Scope:** `api/src/db/client.ts:33`, `api/src/queries/accounting-period.ts:57`, `api/src/queries/obligation.ts:188`, `api/src/queries/driver-money.ts:553`, `api/src/domain/*`

- **B10 CRITICAL:** `sumDepositMovements` `driver-money.ts:553` no `FOR UPDATE` → `deposit.ts:143` double draw `held=1000` both pass `amount>held` `deposit.ts:145` → SUM negative (no `CHECK held>=0`).
- **B11 HIGH:** `sumOutstandingByDirectionForDriver` `obligation.ts:541` unlocked in `offset.ts:56` then `allocateAgainstOldest` `offset.ts:220` does `FOR UPDATE` but never asserts `remaining===0` `offset.ts:99` → concurrent `createOffset(1000)` both pass, Tx2 inserts `offset_record` with zero allocations (INV-3 violated). `deductFromDriverFeeTx:156` missing `owed_to_us` check → `settled>amount`.
- **B13 CRITICAL:** `party-archive.ts:142` `assertArchivable(reader)` outside `writer.transaction:156` (Reader vs Tx) → `INV-35/W-60` bypass; same `archiveCustomer:185`.
- **B12 CRITICAL:** `write-off.ts:255` void guard outside tx (same shape `advance.ts:269`).
- **B14 HIGH:** `updateObligationSettled` `obligation.ts:392` / `applyAdjustmentToObligation:246` without `AND businessId=?` + missing `FOR UPDATE` in `payment-correction.ts:152`, `write-off.ts:62`, `adjustment.ts:72`. Concurrent unwind `settledMinor - take` lost update.
- **PASS:** `payment.ts:116` `findOutstandingObligationsForParty(...,true)` + `credit-forward.ts:79` `FOR UPDATE` on `payment` rows correctly serialises; `closeAccountingPeriod` conditional `UPDATE ... WHERE status='open'` `accounting-period.ts:112` correctly serialises without advisory lock (GAP-8 reproduced not-race, `accounting-period.test.ts:285` pins).
- **Transaction sizing:** `opening-balance.ts:348` 10-insert largest Tx in codebase — correct atomicity, monitor payload; `confirmDaysBulk` `confirmDay.ts:387` bounded by 90-day horizon; `ctx.waitUntil(db.$client.end())` `db/client.ts:48` off request path correct.

### Area 3 — Money Correctness

**Scope:** `packages/shared/src/money.ts:31`, `packages/shared/src/split.ts:10`, `api/migrations/0001_initial_schema.sql:42`, `api/src/db/schema.ts:41`

- **Split invariant HOLD:** `split.ts:20` magnitude technique `abs` + `exact=(abs*w)/sum` + `remainder=abs*w - exact*sum` + `largest remainder + early index tie-break` `split.ts:32` → `sum(parts)==whole` for positive/negative/zero, tested `split.test.ts:26` `-10 → -4/-3/-3`. DB `assert_split_sums() DEFERRED` `0001:927` guards `mileage_assessment`.
- **B20 MEDIUM — missing CHECKs:** `0001:247` `rent_amount_minor` no `CHECK >=0` (siblings have), `248` `allowance_km` no `>=0`, `275` `combined_allowance_km`, `291` `apportioned_km`, `227` `mileage_daily_limit_km`, `456` `excess_borne_minor`, `459`/`473` `received_amount_minor` — every other money `CHECK >=0`. Direct insert negative passes.
- **B21 MEDIUM — positive refinement gap:** `positiveMoneyWireSchema` used for `adjustment.ts:16`, `driver-money.ts:4`, `write-off.ts:4`, `opening-balance.ts:5` but **not** for `expense.ts:47`, `arrangement.ts:19` `rentAmountMinor`, `incident.ts:77` `agreedAmountMinor` etc — Zod allows `0`, DB `CHECK >=0` lets it through as 500 not 400.
- **Rounding:** Half-up missing (only largest-remainder `split.ts:32`), mileage excess one-directional `mileage.ts:124` `max(0, driven-allowance)` + `CHECK excess>=0` — correct.
- **Branded `Minor` leaks:** `money.ts:13` brand stripped at domain boundary — `mileage.ts:125` `BigInt(excessKm)*rate as Minor`, `reports.ts:185` `profitMinor` casts `as Minor` (~40 sites) — systemic, brand only at `packages/shared` edge (by design, not a bug but note for review).
- **Wire:** `WIRE ^-?\d+$` `money.ts:25` strict minor units; `fromInput` `money.ts:49` permissive `","`/`"."`, `padEnd(2,"0")` `money.ts:59` — correctly separated, no wire accepts decimals.

### Area 4 — Time Correctness

**Scope:** `packages/shared/src/dates.ts:14`, `api/src/queries/accounting-period.ts:57`, `api/src/domain/day-card-generation.ts:21`, `web/* T00:00:00`

- **PASS:** `BusinessDate` branded string `dates.ts:12`, `BUSINESS_TIMEZONE "Asia/Colombo"` `dates.ts:14`, `businessDateAt(at, tz)` `dates.ts:53` injectable, `businessToday()` single clock read `dates.ts:58` with `en-CA` `YYYY-MM-DD` formatter `dates.ts:22`. Domain injection `dailyLease.ts:55` `today: BusinessDate` from `handlers/dailyLease.ts:84` `businessToday(requireBusinessTimezone(c))`; `scheduled.ts:34` single `today` for whole cron. No `CURRENT_DATE` (`check-forbidden.mjs:73` regex, docs `data-model.md:1855`).
- **Period boundaries:** `period_end inclusive` `0001:57` + `CHECK period_end>=period_start`, `days_count GENERATED (period_end-period_start+1)` `0001:246`, `findPeriodForDate: lte(periodStart) && gte(periodEnd)` `accounting-period.ts:36`, `inclusiveDays` `dates.ts:68` `+1` tested `dates.test.ts:50` `2026-01-12–02-11=31`. `belongs_to` vs `posted` `accounting-period.ts:57` correct; **B1** `incident.ts:612` still misses `belongsTo` on `insurance_claim`.
- **B3 re-confirmed MEDIUM:** 14 web `new Date(`${date}T00:00:00`)` without `Z` (`HomeScreen.tsx:55`, `VehicleCalendarScreen.tsx:127`, etc) device-local vs `formatShortDate.ts:16` `T00:00:00Z`+`UTC` correct.
- **Horizon:** `HORIZON_DAYS 90` `day-card-generation.ts:21`, `rangeEnd = effectiveTo < horizonEnd ? effectiveTo : horizonEnd`, `addDays(today, 89)` inclusive `day-card-generation.ts:123`, gap-fill `existing/hold/excepted/pattern` `day-card-generation.ts:141`, backfill `freedFrom` `trip.ts:905` `max(freedFrom, effectiveFrom)`.
- **Exclusion `[]` inclusive:** `daily_lease:305`, `lease:88`, `ownership_share:114` all `daterange(...,'[]')`, `changeDailyLeaseDriver:211` `closesOn=addDays(effectiveFrom,-1)` before insert — order avoids `[]` collision.
- **B4 re-confirmed:** ageing `Date.parse` UTC midnight vs Colombo still fragile `reports.ts:894`.

### Area 5 — Tenancy & Capability Matrix (W-49, W-59)

**Scope:** `api/src/auth/policy.ts:33`, `api/src/middleware/auth.ts:32`, `api/src/handlers/partner.ts:131`, `api/src/queries/vehicle-scope.ts:24`

- **Matrix PASS:** `policy.ts:55` `dailyOperations` STAFF, `writeOffOrWaiveAboveThreshold`/`reverseReceipt`/`closePeriod`/`managePartnerCapital` OWNERS, `viewReports` STAFF, `viewOwnerOnlyReports` OWNERS, `viewOwnData` LINKED_DRIVER. Every handler gates `requireCapability` before business scoping (`vehicle.ts:71` `manageEntities`, `reports.ts:57` `viewReports`, `write-off.ts:82` `writeOffOrWaiveAboveThreshold` etc — 11× `partner.ts` all OWNERS).
- **Per-vehicle scoping PARTIAL:** Reads implemented — `listVehicleIdsOwnedByUser` `vehicle-scope.ts:24` `effectiveTo IS NULL`, `listVehicleIdsManagedByUserForPeriod` `vehicle-scope.ts:51` overlap `lte(effectiveFrom,periodEnd) && isNull||gte(effectiveTo,periodStart)` (W-59 `D-17`), `partner.ts:131`/`253` + `reports.ts:62` `getVehicleMonthReport` filter+403 for manager (`reports.ts:162`). Writes stay flat OWNERS (`partner.ts:88` `setOwnershipShares`, `policy.ts:15` TODO) — documented, bootstrap-safe.
- **Manager prohibitions PASS:** cannot `closePeriod` `accounting-period.ts:29`, `writeOff` `write-off.ts:82`, `waiver>threshold` `adjustment.ts:41` (autoWaive `0n` blank), `reverseReceipt` `payment.ts:107`, `manageCapital` 11× `partner.ts`.
- **Linked-driver INV-25 PASS:** `driver-view.ts:70` `viewOwnData` + `requireDriverId` from `auth.ts:59` server row, no `driverId` param; `identity.ts:62` `UNION ALL` per-business dedup. Reports `viewReports` gate → driver 403 (not 404) — `IG §3.3` 403 vs 404 distinction intentional per `IG §7.2`.
- **Cross-tenant 404 PASS:** header `auth.ts:37` not in membership → `NotFoundError` 404 (CLAUDE.md 403 confirms row), per-query `findXForBusiness(reader,businessId,id) || NotFoundError` `partner.ts:94`, `check-forbidden.mjs:119` guards body/header `business_id`.
- **Platform isolation PASS (structural):** `index.ts:92` `app.use("/api/admin/*", platformAdminMiddleware())` never `authMiddleware`; `platform-admin.ts:8` never sets `businessId`; `queries/platform/*:9` no money imports; `check-forbidden` §7.6 guard.

### Area 6 — Schema & Migration Integrity

**Scope:** `api/migrations/0001_initial_schema.sql:952`, `api/src/db/schema.ts:18`, `api/scripts/check-drift.mjs:1`

- **Triggers:** 19 `_period_open` + 19 `_audit` = 38 + 5 (`business_member_audit` `0010`, `business_has_owner` `0001`, `ownership_shares_total` `0001`, `trip_advances_settled` `0001`, `split_sums` `0001`) = 43 + 2 platform (`platform_has_admin` `0030`) = 45 expected `data-model.md:1699`. Audit writer discovery `0002:73` catalogue scan `pg_attribute attname='posted_period_id'` cannot drift; `_period_open` hand array historically drifted (`trip` missing, fixed 18 Aug, `data-model.md:1697`).
- **Migrations:** 30 numbered `0001`–`0030` forward-only, `migrate.mjs:58` regex + `sort()`, SHA `migrate.mjs:62` `sha256` + `check-forbidden` `migration/destructive` `253` + `protect-migrations.mjs:58` ask-before-edit. Correctly left stale `0020` Wave-2 comment rather than breaking checksum (`Plan.md:325`, `TRACKER.md:557`).
- **Indexes:** `one_arrangement_per_vehicle_day` `0001:149`→`0022:27` `WHERE is_hold=false AND voided_at IS NULL`; 5 `replaces_id` partial uniques `0025:12` `WHERE replaces_id IS NOT NULL` (GAP-60); `0022:44` `payment_allocation_live_pair`, `0027:17` `lease_day_exception`, `0030:56` `business_creation_request_one_pending`; `btree_gist` 6 exclusions `0001:88` etc.
- **FKs:** composite `trip(id,vehicle_id)` `0016:11` + `FOREIGN KEY (trip_id,vehicle_id) REFERENCES trip` `0016:28` + 2 CHECKs `MATCH SIMPLE` so overhead null passes; `post_closure_charge` exception handler-level cross-check (GAP-123).
- **Void trio:** 13 money `W-50` + 4 occupancy `0022` + `attachment` `0013` + `lease_day_exception` `0018` + `vehicle_unavailability` `0019` + `driver/customer` `0023` + `offset_allocation` `0024` — 22 total; `payment`/`trip` correctly exempt via `status`.
- **B drift INFO:** `schema.ts:90` `.default("pending")` vs `0030:38` no DEFAULT (intentional third repetition aversion — migration truth); `docs:1173` `offset_allocation` DDL stale.
- **B2 confirmed:** `reports.ts:1346` sole voided-filter miss across 22 tables.

### Area 7 — Domain Invariant Traceability (31→42 INV-n)

**Scope:** `docs/product/user-flows.md` INV table, `docs/engineering/data-model.md:14`, `api/src/domain/*`, `api/src/queries/*`

| Level | INVs |
|-------|------|
| DB PK/index/CHECK/trigger | INV-1 `vehicle_day_allocation unique` `0001:149`+`0022:27`, INV-6 `CHECK did_not_run` `0001:349`, INV-10 `assert_period_open` 19 tables, INV-11 `message unique`, INV-15 FK, INV-16 `EXCLUDE`+`assert_shares_total DEFERRED` `0001:902`, INV-17 `assert_advances_settled` trigger, INV-19 `CHECK source`, INV-20 `bigint`, INV-23 `discrepancy GENERATED` `0001:1266`, INV-26 `assert_split_sums DEFERRED`, INV-27 `borne_by/paid_by` cols, INV-29 boundary via INV-1, INV-30 `CHECK closed→postedPeriod` `0001:802`, INV-31 `assert_business_has_owner`, INV-40 platform has admin, INV-41 `UNIQUE WHERE pending`, plus 32,33,40 |
| Schema shape | INV-2 earned vs received split, INV-3 two directions, INV-4 deposits not in P&L `data-model.md:1936`, INV-14 waiver≠write-off tables, INV-21 append-only void trio |
| App-only (risk) | INV-5 `borne_by='us'` query filter (app forgets → profit +12k), INV-12 re-check at dispatch, INV-22 reversal `payment_correction` `domain/write-off.ts:274`, INV-25 driver isolation per-business `driver_linked_user_per_business` `0029:24` but no RLS `D-2` open, INV-34/35/36 scope/archive/cascade `party-archive.ts:38` |
| Test-only | INV-9 combined ≤ separate |
| **B22 HIGH — MISSING DB:** INV-18 `closure_summary_shown_at` never written `data-model.md:5,1704` `lease-closure.ts:214` — wizard order only, direct `POST /deposit/settle` bypasses. Column retained for future gate. |
| **B23 MEDIUM — PENDING:** INV-28 `audit_log` table exists `0002` but `write_audit_log` trigger not attached to 19 money tables `D-8` — history only via `voided_*` until first writer lands. |
| Lost-day GAP-147 fix verified: `reports.ts:1107` `COUNT FILTER (did_not_run OR ran_%)` + `HAVING>0` per W-56 correct. |

All 62 flows `F-n` + 4 `F-0/F-11` have handler+domain+query chain `data-model.md:1973` 66/66 — none orphan. `confirmDay` `F-4.2` 4 inserts one tx `confirmDay.ts:198`, `bookTrip` `F-5.1` allocation+pause+obligation one tx `trip.ts:335`.

### Area 8 — API Contract & Wire Schema

**Scope:** `packages/shared/src/schemas/*`, `api/src/route-defs/*`, `api/src/handlers/*`

- **Every status declared PASS (with gaps):** Canonical `route-defs/adjustment.ts:22` `createAdjustmentRoute` `201,400,401,403,404,409 PERIOD_CLOSED` matches `handlers/adjustment.ts:31`. Global `handler.ts:37` `{error,code,requestId,details}` + `openapi-hook.ts:12` Zod 400 same shape.
- **B24 LOW — missing 400 in spec:** `route-defs/vehicle.ts:35` `createVehicle`, `:54` `getVehicle`, `:71` `listVehicles`, `incident.ts:25` `openIncident`, `expense.ts:18` `listExpenses` omit `400 VALIDATION_ERROR` → runtime 400 via `defaultHook` but undocumented in OpenAPI.
- **B24b LOW — missing 409:** `vehicle.ts:235` `archiveVehicle` no `409 Already archived`, `mileage-package.ts:12` `createMileagePackage` no `400` for negative `dailyLimitKm`.
- **Money wire PASS:** `moneyWireSchema = z.string().regex(/^-?\d+$/).transform(parse)` `common.ts:12`, `positiveMoneyWireSchema.refine(v>0n)` `adjustment.ts:16` for `>0`. Request `moneyWireSchema` `adjustment.ts:32`, response `z.string()` `adjustment.ts:54` — zero `z.number()` on money (64 `z.number()` hits all `km`/`litres`/`count` with `eslint-disable` comment). `db/schema.ts:41` `bigint mode:bigint` mirrors.
- **B21 re-affirmed:** wire-permissive `moneyWireSchema` allowing `0` reaches DB `CHECK` as 500 not 400 where `positive` not used (`expense.ts:47`, `arrangement.ts:19`).
- **U-2 Level-2 PASS (schema):** `createVehicleRequestSchema` only `registration,type,arrangement` required `vehicle.ts:22` → `insuranceExpiry` optional behind `Disclosure`; `createDriverRequestSchema` only `name`; `BookTripRequestSchema` only `vehicleId,start,end` `arrangement.ts:125`. **Component tests PARTIAL:** `CreateVehicleForm.test.tsx:26` `saves with level-1 only` exemplar, `CreateDriverForm.test.tsx:7`, `RecordExpenseSheet.test.tsx:52` 7 forms with test, but `CreateMileagePackageForm`, `InviteBusinessMemberForm`, `SetServiceIntervalSheet` lack labelled `saves with level-1 only` (IG §16.1 row expects every form).
- **Status distinctions PASS:** `401` missing/invalid `auth.ts:23` `MissingToken/InvalidToken`, `403` `requireCapability` `context.ts:51`, `404` header-miss `auth.ts:37` + per-query `findXForBusiness || NotFoundError`, `409` INV-1 `VehicleDoubleBooked` `trip.ts:513`, `PERIOD_CLOSED` `PeriodClosedError:409` correctly no `400`.
- **OpenAPI gate PASS:** `routes/docs.ts:13` `productionGate` `ENVIRONMENT==="production"` → `NotFoundError 404` on `/api/docs` + `/api/docs/openapi.json` `docs.ts:19`, `types.ts:7` union, `index.ts:198` before mounts; `wrangler.jsonc` `vars.ENVIRONMENT` per env.

### Area 9 — Web Offline/Mutation & QueryState (M-12/M-28)

**Scope:** `web/src/lib/api.ts:77`, `web/src/lib/auth-asgardeo.ts:56`, `web/src/main.tsx:44`, `web/src/components/OfflineBanner.tsx:7`

- **B25 CRITICAL — M-12 not implemented:** Spec `ui-ux-guidelines.md:104 M-12`/`§9.4` `Offline, queued → SyncChip + count`/`§12.1 PWA` requires persisted replay + rollback. `web/package.json:17` no `@tanstack/query-sync-storage-persister`/`idb-keyval`; `main.tsx:44` `new QueryClient` no `PersistQueryClientProvider`, no `createPersister`, no `mutationCache`, no `networkMode offlineFirst`, no `persistedQueryClient.ts` file; `vite.config.ts:66` comment *"runtime-caching … is P12"*; `api.ts:64` *"pausing/resuming offline mutation queue … is M-12's job (P12) — this client only does the one request"*. Reload while offline loses write; Android PWA close discards.
- **Dead code MEDIUM:** `OfflineBanner.tsx:7` correct 32px `role=status` + `Screen.tsx:38` slot — never rendered (grep `OfflineBanner` only slot definition, no `AppShell`/`router` pass-through).
- **M-28 PASS (guard-enforced):** `useQueryState.ts:11` four states `idle|pending|error|ready` with `fetchStatus==='idle'` distinct (GAP-101 23 `enabled:false` sites), `QueryState.tsx:18` `messageFor` 401/403/404/5xx + `of` noun; guard `check-forbidden.mjs:306` `checkQueryErrorHandling()` file-level → call-site-level, every `useQuery({` must feed `useQueryState` or `<QueryState>` — `npm run check` PostToolUse block. Coverage: `HomeScreen.tsx:285` 6-way `combineQueryStates` error>pending>idle>ready, `NotAvailable` `HomeScreen.tsx:435` `read failed` vs `loading` vs `Rs 0` per W-56 honoured (`NotAvailable.tsx:13` `—` never zero, `Money.tsx:11` `Rs`).
- **Token freshness PASS (ready for queue):** `api.ts:77` `getToken()` per request, `auth-asgardeo.ts:68` *"deliberately does not cache"*, `AuthGate.tsx:84` `authRef.current.getAccessToken()` indirection, `storage.ts:10` `BusinessIdGetter` fresh read + Safari `SecurityError` guard — correct for future `persistQueryClient` replay.
- **Optimistic PASS with gap:** `ConfirmDayCard.tsx:95` `optimistic via toOptimisticRecord` + `queryClient.setQueryData` on success `ConfirmDayCard.tsx:140`, most others `invalidateQueries` `PartnerDetailScreen:88` — no `onMutate` snapshot/rollback (grep 0 hits); server rejection leaves optimistic until refetch.
- **Retry correct:** `queryRetry.ts:1` `4xx false, 5xx/network <3`, wired `main.tsx:66`, `useMutation` default `retry:0` → flaky 4G POST fails once, `confirmMutation.isError` `ConfirmDayCard.tsx:167` surfaces without backoff.

### Area 10 — Performance & Operational

**Scope:** `api/src/domain/reports.ts:173`, `api/src/queries/reports.ts:37`, `api/src/db/client.ts:19`, `api/src/scheduled.ts:29`

- **Bulk POSITIVE (GAP-145):** `getVehicleMonthReport` `reports.ts:173` `Promise.all 3 bulk maps` (6 queries regardless of fleet) → fixes `GET /partner/{id}` 79→6 subrequests (Workers Free 50 ceiling). `getVehicleYearReport` `reports.ts:265`, `sumAllTimeEarnedForUser` `partner.ts:509` `Promise.all 5 flat` `O(vehicles×periods)`→5. `listClosedTripsForReport` bulk `GROUP BY tripId` `reports.ts:701`, `findPartyNames` batched `reports.ts:1426`.
- **B26 HIGH — JS aggregation:** `sumOverheadsForPeriod` `reports.ts:545` `rows.reduce((sum,r)=>sum+r.amountMinor,0n)` fetch rows then sum in Worker — should be `SELECT SUM(amount_minor)`. Same `sumOverheadsForDateRange:566`, legacy `sumVehicleEarned/CostsForPeriod` `reports.ts:88`, `sumEarned/CostsForDateRange:290` `reduce` in JS.
- **B27 MEDIUM — ageing in JS:** `listAgeingBuckets` `reports.ts:863` fetch all `obligation` rows then `for(row) buckets.get(key).outstanding+=...` + `Date.parse` bucketing — should be `GROUP BY party, bucket CASE WHEN age...` + `SUM(amount-settled-waived)` in Postgres per `TS §7 CPU bounded`.
- **B28 MEDIUM — N+1:** `sumDepositsHeld` `reports.ts:1073` `for(row) await sumDepositMovements(row.id)` sequential `SELECT *` per deposit (N round-trips) — same fix `Promise.all` or single `GROUP BY deposit_id SUM(CASE)`.
- **B29 MEDIUM — cron N+1:** `generateDayCards` `day-card-generation.ts:233` `for(l of activeLeases) await listAllocatedDatesForVehicle(...)` per lease — unscoped global `scheduled.ts:34`, unbounded tenancy; single `WHERE vehicle_id IN (...)` would collapse.
- **PASS:** `countOffRoadDays` `reports.ts:519` bounded by window (31/365) not row count; `profitPerKm` only `Number` for ledger `reports.ts:316`.
- **Neon driver PASS:** `db/client.ts:19` `reader drizzleHttp(neon)` HTTP single-statement, `writer drizzlePool(Pool)` WS tx, `dbMiddleware.ts:22` per-request `withActor` + `ctx.waitUntil(raw.$client.end())` off path; `scheduled.ts:35` same close.
- **KV/JWKS PASS:** `jwks.ts:11` TTL 6h `KV_TTL_SECONDS=21600`, `verify.ts:43` `JWKSNoMatchingKey` → `getJwks(forceRefresh:true)` retry.
- **Rate-limit PASS:** `rate-limit.ts:13` `CF-Connecting-IP` + `app.use("*", rateLimitMiddleware())` `index.ts:58`, `namespace_id 1001/1002/1003` per env `wrangler.jsonc:46`.
- **Cron idempotency PASS:** `billing_period UNIQUE(lease_id,seq)` `0001:249` + `day_record UNIQUE(daily_lease_id,business_date)`, `scheduled.ts:156` `onConflictDoNothing` + `billing-period.ts:145` unique catch `created:false`, bounded `while(periodEnd<today && guard<24)` `billing-period.ts:174`, `HORIZON 90` `day-card-generation.ts:21`, per-lease `try/catch` `day-card-generation.ts:233` fail-isolated.

---

## 10. Consolidated Remediation Tracker (extends §6)

> Order by leverage: CRITICAL (wrong money / data loss / security) → HIGH (race under concurrency) → MEDIUM (reporting drift / lock order / spec lie) → LOW (hygiene). Duplicate B numbers are same bug re-cited across areas — fix once.

| # | Severity | Area | File:Line | Status | Fix (one line) |
|---|----------|------|-----------|--------|----------------|
| B1 | MEDIUM | §3/§4 | `incident.ts:612` `insertInsuranceClaim` | open | Spread `...belongsToPeriodId` like `incident.ts:628`. |
| B2 | MEDIUM | §3/§6/§10 | `reports.ts:1346` `countAllocatedDaysForVehicle` | open | Add `AND voided_at IS NULL` to raw `WHERE`. |
| B3 | MEDIUM | §3/§4 | 14× `T00:00:00` web | open | Codemod `→T00:00:00Z` + `timeZone:"UTC"`, add `check-forbidden` rule `T00:00:00"` . |
| B4 | MEDIUM | §3/§4/§9 | `reports.ts:894` `Date.parse` ageing | open | Replace with `inclusiveDays`/`addDays` calendar-day diff. |
| B5 | HIGH→MEDIUM | §1/§2 | `expense.ts:129`, `incident.ts:251`, `advance.ts:53`, `partner.ts:120` linkage outside tx | open | Move `resolvePeriodLinkage` + `replacesId` lookup inside `writer.transaction`. |
| B10 | HIGH | §2 | `deposit.ts:143` `sumDepositMovements` race | open | `SELECT ... FOR UPDATE` on deposit before SUM. |
| B11 | HIGH | §2 | `offset.ts:56` outstanding / `deposit.ts` | open | Assert `remaining===0` after `allocateAgainstOldest`; `FOR UPDATE` on sum. |
| B12 | CRITICAL | §2/§1 | `write-off.ts:255` void guard outside tx | open | Move `findLiveRecoveries` inside tx with `FOR UPDATE`. |
| B13 | CRITICAL | §2 | `party-archive.ts:142` archive outside tx | open | Inside `tx` with `FOR UPDATE` on party + open-money re-check. |
| B14 | HIGH | §2 | `obligation.ts:392` no `businessId` + `payment-correction.ts:152` no `FOR UPDATE` | open | Add `AND businessId=?` to `UPDATE WHERE id=?`; add `forUpdate:true` variant. |
| B18 | MEDIUM | §1 | `pg-error.ts:57` fragile matcher | open | Pin trigger message in test (`"is closed"`), or match by SQLSTATE + table. |
| B19 | MEDIUM | §1 | `incident.ts:580` insurer double-claim | open | Add `isUniqueViolation` catch for insurer recovery unique. |
| B20 | MEDIUM | §3 | `0001:247` missing `CHECK >=0` | open | Migration adding `CHECK rent_amount_minor>=0` etc (5 columns). |
| B21 | MEDIUM | §3/§8 | `expense.ts:47` `moneyWireSchema` not `positive` | open | Use `positiveMoneyWireSchema` for `>0` amounts. |
| B22 | HIGH | §7 | INV-18 `closure_summary_shown_at` never written `lease-closure.ts:214` | **deferred by design** (column kept for future gate) | Documented — no fix in this wave; future `CHECK closure_summary_shown_at IS NOT NULL` before settle. |
| B23 | MEDIUM | §7 | INV-28 audit writer pending `0002` | **pending** `D-8` | Attach `write_audit_log` trigger to 19 money tables (first live-data task). |
| B24 | LOW | §8 | `route-defs/vehicle.ts:35` missing `400` etc | open | Declare `400 VALIDATION_ERROR` on mutating routes. |
| B25 | CRITICAL | §9 | M-12 offline not implemented `main.tsx:44` | **P12 deferred** (spec `vite.config.ts:66`) | Add `persistQueryClient` + `mutationCache` + `networkMode offlineFirst` + wire `OfflineBanner`. |
| B26 | HIGH | §10 | `reports.ts:545` `sumOverheads` JS reduce | open | `SELECT SUM(amount_minor) WHERE borne_by='us'`. |
| B27 | MEDIUM | §10 | `reports.ts:863` ageing JS bucketing | open | Push `CASE WHEN age... THEN bucket` + `SUM` into Postgres. |
| B28 | MEDIUM | §10 | `reports.ts:1073` `sumDepositsHeld` N+1 | open | Single `GROUP BY deposit_id SUM(CASE ...)` or `Promise.all`. |
| B15–17 | MEDIUM/LOW | §2 | period linkage after writes, `listOffsets` void, `voidOffset` lock | open | Reorder linkage first; add `voidedAt IS NULL`; add `forUpdate:true`. |

**Next gate before merge:** `npm run check` (already clean) + Neon integration `npm run test:integration` on ephemeral branch verifying `check-drift` clean + `134,000/15,000/7,500` fixtures, then codemod B3 + migrations for B1/B2/B20.

---

## 11. How to Continue Validating (for the next evaluator)

1. Run `node api/scripts/check-drift.mjs` against QA after every money-table migration — it is the only automated catch for hand-maintained `assert_period_open` array.
2. Run `npm run test:integration -- --run` on an ephemeral Neon branch ( `TEST_DATABASE_URL` scoped) — golden fixtures + `INV-16`/`INV-17` deferred triggers only fire against real Postgres.
3. Add `T00:00:00"` to `scripts/check-forbidden.mjs` as `date/local-midnight` rule (mirrors `CURRENT_DATE` guard) to prevent B3 recurrence.
4. Add `FOR UPDATE` coverage lint: every `findObligationForBusiness(tx, id)` that precedes `updateObligationSettled` must pass `forUpdate:true` — consider codemod or grep check.
5. Re-run this §9 after patching — the 10 areas are independent, so parallel sub-agents can refresh one area at a time.

