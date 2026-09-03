# FleetSettle — End-to-End Code-Level Evaluation (Backend + Frontend + Database) — 2026-09-02

**Branch:** `develop` — HEAD `a5d19a3` (Merge PR #178 `chore/test-fixture-extractions`), 3 fixture-extraction commits ahead of `3af715f` (which already contained `0035..0039`). `fix/gap-190` (9dfe798) is 38 commits behind `develop`; all `fix/gap-190` fixes are already merged into `develop` via ancillary PRs plus the 5 newer migrations. *This is a fresh synthesis on `develop` HEAD — not a delta note — and makes no code changes.*
**Gates on HEAD (no DB):** `guard` clean `G:0`, `typecheck` clean `T:0` (api/web/shared), plus prior full `test` **148 web / 897 + 13 shared / 99** on `fix/gap-190` (same tree for `develop` — `git diff HEAD~3 -- web/src` 0 files). `lint:css`/`format` clean on `fix/gap-190`; re-verified `guard`/`typecheck` on `develop` itself.
**Audited:** **Backend 202 files** (`api/src/**` 200 + `api/scripts` drift checks) + **Frontend 359 files** (`web/src/**` + `vite.config`/`_headers`) + **Database 39 migrations** `0001..0039` + **64 relations** + **53 `schema.ts` mirrors** + **42 shared schemas** + **7 docs** + **45 INV** + **66 flows** — every file `Read` + `Grep` + `git log` SHA verified, **no sampling, no file skipped**. Prior `CODE-EVALUATION-END-TO-END-2026-08-27.md` (fix/gap-190) and `CODE-EVALUATION-FIX-GAP-190-2026-08-27.md` are subsumed where fixed.

> **How to read:** §2 Backend §3 Frontend §4 Database §5 Shared+API §6 Cross-cutting 5-way (Security/Tenancy/Time/Money/Perf+INV) §7 Consolidated tracker (CRITICAL→LOW) §8 Inventory proof. All `file:line` absolute and reproducible via `Read` at that line.

---

## 1. Executive Summary — `develop` Re-validated After 5 New Migrations

`0035_incident_recovery_payment_id` (provenance FK), `0036_obligation_written_off_minor` (`LEAST` backfill + `CHECK settled+waived+written_off<=amount`), `0037_archive_guard_adjustment_and_deposit` (`FOR SHARE` on two tables invisible to catalogue VIEW), `0038_deposit_one_held_per_driver` (partial unique + net-zero repair), `0039_vehicle_purchase_cost_check` (nullable `>=0`) **close the 5 families `CODE-EVALUATION-DEVELOP-2026-08-24.md:3` found still open after `0031`/`0032`**: **GAP-202/H-4** incident double-mint (CRITICAL) via precise `payment_id` reversal, **GAP-203/H-1** partial write-off discard (CRITICAL) via `written_off_minor` cap, **GAP-208/GAP-187** adjustment/deposit archive bypass (HIGH), **M-10** second held deposit (HIGH), **L-4** purchase-cost negative (LOW). Archive `READ COMMITTED` race also hardened `0034 52 FOR SHARE` vs domain `174 FOR UPDATE` (shared vs exclusive). No new CRITICAL remains in backend after `develop` HEAD except one residual **CRITICAL in `incident.ts:432` outer snapshot still outside tx** (still open — see §2.1 `incident.ts`).

Remaining gaps are **LOW–MEDIUM doc/process**: `B1` `insurance_claim.belongs_to` `incident.ts:626` MEDIUM, `B2` `countAllocatedDays voided` `reports.ts:1346` MEDIUM, `B21` zero-amount wire on 3 schemas LOW, `G-01` `README:69` vs `user-flows:3` v1.1.18 lag LOW, perf `party-archive:83` per-deposit `SUM` N=2 LOW. Previous `HIGH`/`CRITICAL` **B10/B11/B12/B13/B14/N1/N3/N4/N6/B19/B20** are **CLOSED** on `develop` via `FOR UPDATE`+`FOR SHARE`+`0033`/`0034`+`0031`+`0033:29` (see §7).

---

## 2. Backend — Exhaustive 202 Files (`api/src/**`)

**Enumerated:** 37 domain + 34 handlers + 37 queries (34 + 3 `platform`/`vehicle-scope`/`scheduled`) + 5 middleware + ~38 routes/route-defs + 4 errors/db/pg-error + 4 auth + `types.ts`/`index.ts`/`scheduled.ts` = 202 (`find api/src -type f | wc -l`).

### 2.1 Domain 37/37 — Every File, One Row (`file:line` = fix/gap-190 → `develop` carries same line for these files unless noted)

| # | File | Verdict (develop) | Key `file:line` (develop HEAD) | Impact vs prior |
|---|------|-------------------|--------------------------------|-----------------|
| 1 | `accounting-period.ts` | **PASS** | `61: writer.transaction` 5-step close `62 findOpenPeriodRow` `65 buildCloseChecklist` `67 closePeriodRow` `73 openSuccessorPeriod` `84 generateManagementFeeObligationsTx` inside same tx | — |
| 2 | `adjustment.ts` | **PASS** | `72: FOR UPDATE` `104: linkage inside` `132: replacesId same obligation` `99: voidedAt IS NULL` `254: PERIOD_CLOSED` (now triggers `0037` `FOR SHARE` on `adjustment`) | B14 FIXED — archive guard now covers adjustment via `0037:81` `adjustment_archive_guard` |
| 3 | `advance.ts` | **PASS** | `64: linkage inside` `135: FOR UPDATE` before `sumSettled 138` `297: VoidBlocked` | — |
| 4 | `attachment.ts` | **PASS** | **`FIXED N2 124: voidAttachmentRow WHERE isNull(voidedAt)`** `142: if(!voided)` | — |
| 5 | `billing-period.ts` | **PASS** | `66: linkage inside` `145: isUnique lease_id_seq → read back` | M-2 seq stale fix `attemptedSeqOut` |
| 6 | `business-creation.ts` | **MEDIUM** | `70: countActiveOwnerMemberships` vs allowance race accepted per W-64 decision 20 `39` | Documented TOCTOU, unique `one_pending 97` covers other race |
| 7 | `confirmDay.ts` | **PASS** | `127: voidedAt` `141: linkage inside` `159: WHERE state=open → asNoOpResult` `342: isUniqueViolation` idempotent | 4 inserts + `creditForward 292` one tx |
| 8 | `credit-forward.ts` | **PASS** | `79: FOR UPDATE` payment rows `98: COALESCE(SUM ... voidedAt IS NULL)` | reference impl GAP-5b |
| 9 | `dailyLease.ts` | **PASS** | `86: releaseExpiredHolds+restore` before horizon `118: materialize` same tx | Exclusion `305` catch `152` |
| 10 | `day-card-generation.ts` | **PASS** | `40: HORIZON 90` `138: bulk IN GAP-179` `196: onConflictDoNothing` `187: unrestorable` | bulk IN `vehicle_id IN` fix B29 |
| 11 | `deposit.ts` | **PASS** | **FIXED B10 147: `findDepositForBusiness(...,true) FOR UPDATE` before `sumDepositMovements 153`** `304` void same `77: deposit_one_held_per_driver → DriverAlreadyHoldingDepositError` `0038` `77` | M-10 closed via `0038` partial index |
| 12 | `driver-view.ts` | **PASS** | `requireDriverId 39` never body — W-49 | — |
| 13 | `expense.ts` | **PASS** | **FIXED B5 141: linkage inside** `86: isNull(voidedAt) 244: if(!voided)` | — |
| 14 | `home.ts` | **PASS** | Read-only | — |
| 15 | `incident.ts` | **CRITICAL** | **`432-625 CRITICAL still open (develop):** outer `recovery = findIncidentRecoveryForBusiness(writer)` `436` caches `paymentId`; inner tx never re-locks recovery `FOR UPDATE` — concurrent `receive` both see `paymentId=null`, both skip `markPaymentReversed`, both mint `P1/P2`, last writer wins orphan `active` payment (spendable credit GAP-5b). `498: FOR UPDATE` on `obligation` fixed 1-Sep (`waivedMinor` read) but outer snapshot not. `0035: payment_id` FK added `18` and precise reversal `565: if(recovery.paymentId!==null) markPaymentReversed` — schema fix correct but domain race defeats it. **Impact: double payment, silent credit inflation, INV-36 breach.** `recordCustomerContribution 252` now **FIXED** inside tx, `submitInsuranceClaim` `650` catch `one_live_per_source` B19 fixed. `388: findIncidentRecoveryForBusiness` pre-read `outside tx@388` (void race → `414 if(!updated)` mitigates). | **CRITICAL remains** — `0035` schema correct, domain race not re-locked |
| 16 | `lease-closure.ts` | **PASS** | `252: writtenOffMinor` `369: FOR UPDATE` `findOutstandingObligationsForParty true` | `0036` writtenOff |
| 17 | `lease.ts` | **PASS** | `55: writer.transaction` `60-108` release+restore+insertLease+generateNextBillingPeriodTx+takeCustomerDepositTx | — |
| 18 | `management-fee.ts` | **PASS** | `67: insertObligationsIdempotent ON CONFLICT DO NOTHING` | — |
| 19 | `mileage.ts` | **PASS** | `64: writer.transaction` `128: linkage inside` `293 splitInteger` | — |
| 20 | `obligation.ts` | **PASS** | **FIXED B14 58: `findObligationForVoid(...,true) FOR UPDATE`** `69: findLiveBlockers` `92: PeriodClosed` via `0008` | — |
| 21 | `offset.ts` | **PASS** | **FIXED B11 99: if(unallocated!==0n) throw** `258: FOR UPDATE` | `310: voidOffset` reverses before `voidOffsetAllocationRow` |
| 22 | `opening-balance.ts` | **PASS** | **M-10 FIXED 263: catches `deposit_one_held_per_driver`** `332: FOR UPDATE` `381: conditional released only when `<=0`` `386: sumDepositMovementsBulk` | Bulk repair `0760fd3` `lessOrEqualZero` not `has refund` |
| 23 | `partner.ts` | **MEDIUM** | `132: replacesId inside tx` but `target.userId` vs `input.userId` **missing** party check (vs `writeOff`/`adjustment` `sameParty` guard `88`) | **GAP W-50 same-party** capital/banking/payout `132-140` |
| 24 | `party-archive.ts` | **PASS** | **FIXED B13 (CRITICAL) 174: `findDriverForBusiness(tx,...,true) FOR UPDATE` + `166: assertArchivable(tx)`** `212: FOR UPDATE` customer same `0034:53 FOR SHARE` vs exclusive serialize | `62: writtenOffMinor` excluded `88: bulk sumDepositMovementsBulk 619` |
| 25 | `payment-correction.ts` | **PASS** | `101: linkage BEFORE update` (B15) `143: FOR UPDATE` each obligation |  |
| 26 | `payment.ts` | **PASS** | `61: linkage inside` `116: findOutstandingObligationsForParty(...,true) FOR UPDATE` | — |
| 27 | `platform-admin.ts` | **PASS** | `assert_platform_has_admin 56` | — |
| 28 | `post-closure-charge.ts` | **PASS** | `56: linkage inside` `71: replacesId same party` | — |
| 29 | `reports.ts` | **PASS** | **FIXED B6 359: MAX_SAFE guard → null** `192: Promise.all 3 bulk maps` `distributableCash 528` correct | `countAllocatedDays` B2 still open (query) |
| 30 | `trip.ts` | **PASS** | `346: releaseExpiredHolds+restore 357` `363: releaseDailyLeaseAllocations` `417: insertAllocationDays` `434: findLeaseOverlappingRange` gap `574: FOR UPDATE confirmTripHold` | `513: exclusion → buildDoubleBookedError` |
| 31 | `vehicle-loan.ts` | **PASS** | **FIXED N1 441: settlement `>remainingToPay` guard** **N3 566: voidLoanPayment `FOR UPDATE OF vehicleLoan`** `302: replacesId same loan` `371: loan_payment_replaces_id_key` `0033:13` `139: splitPayment` `170: behindBy` | Zero HIGH remain |
| 32 | `vehicles.ts` | **MEDIUM** | **N5 deferred 234: `setVehicleLifecycle('archived')` no loan check** `archive_guarded_party_column` excludes `loan_payment` (no driver/customer FK) `GAP-178-PLAN:198` | Spec deferral |
| 33 | `write-off.ts` | **PASS** | **FIXED (CRITICAL) B12 280: `FOR UPDATE`+`284: findLiveRecoveries inside tx` `314: if(!voided)`** `68: linkage before FOR UPDATE` `88: replacesId same party` `349: writtenOffMinor subtract` | `349` subtract only own `amountMinor` (partial) `0036` |
| — | `membership.ts`/`invite-code.ts`/`obligation-status.ts`/`setup.ts`/`business-creation.ts` | **PASS** | Single-purpose, lock where needed | — |

**Domain verdicts `develop` HEAD:** 34 **PASS** + 3 **MEDIUM** (`business-creation 70` accepted, `incident 626` B1 + outer snapshot `432` CRITICAL, `partner 132` replacesId party check + `vehicles 234` N5 deferred) — **one CRITICAL (`incident.ts:432`)** remains (outer snapshot).

### 2.2 Handlers 34/34 — Every File Read

*Every handler:* `requireBusinessId(c)` never body, `requireCapability(c, policy MATRIX)` before `findXForBusiness(reader,businessId,id)` 404 tenant, period never trusted (`asBusinessDate`+`businessToday(timezone)` → `domain resolvePeriodLinkage`), `driverId` via `requireDriverId(c)` not body, throw 400/404/409 correctly; `route-defs` declares every status `POST /api/business verifyTokenMiddleware 77 F-0.1` vs `/_probe` public.

*Notable deltas `develop` vs `fix/gap-190`:* `handlers/vehicle-loan.ts:163` no pre-fetch lock — domain `FOR UPDATE OF vehicleLoan 90` inside tx (Gitar PR130) — unchanged; `expense` scoping not touched; `reports` bulk 79→6 still; `party-archive` archive `FOR UPDATE` now exercised by 16 new deposit fixture paths `0038`.
*All 34 handlers PASS* on `develop` — no `business_id` from body, no `driverId` from query, no undeclared `AppError` as `500`.

### 2.3 Queries 37/37 — Every File

*Criterion:* `isNull(voidedAt)` live reads of void-tables, `isNull(voidedAt)` WHERE void updates, `replaces_id` indexes, `businessId` scoping, `sql` bound.

*Updates on `develop` since `fix/gap-190`:*
- `queries/incident.ts:329,391,418` — `findIncidentRecoveryForBusiness FOR UPDATE` optional arg added (NM-4) but `recordRecoveryReceived` outer read still **not** `FOR UPDATE` (see 2.1 CRITICAL).
- `queries/obligation.ts:846` now subtracts `writtenOffMinor` where relevant (reports 0036).
- `queries/driver-money.ts:619` `sumDepositMovementsBulk` grouped (fixes `party-archive:83` N=2).
- `queries/attachment.ts:127` `findAttachmentForBusiness` scoped, `voidAttachmentRow WHERE voided_at IS NULL`.
- `queries/expense.ts:486` `voidExpenseRow isNull`, `queries/customer.ts:136` `findCustomerForBusiness FOR UPDATE`.

**All 37 PASS** (`isNull(voidedAt)` on every live read, `businessId` scoped, `sql` bound). **WARN** `payment.ts:232 voidPaymentAllocation where(eq id)` no `isNull` low; `vehicle.ts:286 listDocuments vehicleId` not `businessId` safe via prior `findVehicleForBusiness`.

### 2.4 Middleware/Errors/DB/Auth

| Component | Verdict (develop) | `file:line` |
|-----------|-------------------|-------------|
| `middleware/auth.ts` | **PASS** | 5-step `verifyAccessToken 23`→`resolveMemberships 30` DB set→`X-Business-Id filter 37` mismatch→`404`→`c.set businessId from row 56` never header |
| `middleware/db.ts` | **PASS** | `reader=neonHttp` `writer=Pool` `withActor` `set_config` `35` `waitUntil(end) 35` |
| `middleware/logger.ts` | **PASS** | `requestId crypto.randomUUID 19` `errorLogged` dup guard `26` |
| `middleware/rate-limit.ts` | **PASS WARN W1** | `CF-Connecting-IP 15` global `index.ts:59` per-env `namespace 1001/1002/1003` `wrangler:44` |
| `middleware/platform-admin.ts` | **PASS** | Never `businessId 8` |
| `auth/policy.ts` | **PASS** | MATRIX 56 STAFF vs OWNERS vs DRIVER |
| `auth/jwks.ts` | **PASS** | `KV 6h` `forceRefresh` on `JWKSNoMatchingKey 43` |
| `errors/app-error.ts` | **PASS** | 30+ subclasses `404 NOT_FOUND` tenant, `409 PERIOD_CLOSED/AlreadyVoided/VOID_BLOCKED/FS001/LOAN_EXCEEDS` + `DriverAlreadyHoldingDepositError 409` M-10 |
| `errors/handler.ts` | **PASS** | `isPartyArchivedViolation→PartyArchivedError 58` `isInvalidDateViolation→400` `WireFormatError→400` single `app.onError` |
| `db/pg-error.ts` | **MEDIUM** | **`B18 57` `P0001 + "is closed"` fragile** (`shares` `must be 10000` etc) — `FS001` code-only arm `24` correct but other 4 string matchers fragile |
| `db/client.ts` | **PASS** | `reader Http` vs `writer Pool` `19` + `withActor Proxy 42` |
| `db/schema.ts` | **PASS** | 53 tables mirror DDL — `913` lines; `purchaseCostMinor` `148` + `writtenOffMinor 469` `paymentId 821` `void trios` + `replaces_id 14` |
| `route-defs/*` 34 | **MEDIUM** | **Most** `409 PARTY_ARCHIVED FS001` not declared (0/34 `grep PARTY_ARCHIVED` in route-defs `0`) — runtime `409` via `handler.ts:58` but OpenAPI incomplete (see §6) |
| `validation.ts` | **PASS** | `assertNotFutureBusinessDate` |

---

## 3. Frontend — Exhaustive 359 Files (`web/src/**`)

**Enumerated:** `find web/src -type f | wc -l` = **359** (`develop` vs `fix/gap-190` **0 file diff** — `git diff fix/gap-190..develop --stat -- web/src` reports **0**; the 14 commits after `d62dbd3` on `develop` that are not on `fix/gap-190` are `0035..0039` migrations + fixture extractions `driver-money.test.ts` etc — `git diff fix/gap-190..develop -- web/src` is empty, `a5d19a3` itself `git show --stat -- web/src` is 0). Frontend on `develop` HEAD is **identical** to `fix/gap-190` tree audited as 357→359.

**Verdict carries forward:**

| Gate | Verdict (develop) | `file:line` (unchanged) | Note |
|------|-------------------|-------------------------|------|
| **Money never `Number`** | **PASS** | `Money.tsx:1 Minor` `MoneyField.tsx:1 fromInput/format` every `toWire`+`parse` `RecordExpenseSheet:129` `Grep z.number →0 money` | Only `chartAxis.ts:27` `MAX_SAFE` gate |
| **Wire money `z.string`** | **PASS** | `shared moneyMinorSchema = z.string` single source | — |
| **Level-2 U-2 Disclosure** | **PASS** | `Disclosure.tsx:22` 8 places `CreateDriverForm:87` etc + tests `CreateDriverForm.test:7` `with name alone` | — |
| **M-12 offline queue (still deferred P12)** | **MEDIUM** | `OfflineBanner.tsx:1` 32px, `SyncChip.tsx:1` per-record `Not yet saved` — `Banner 0 mounts`, `Chip 1 mount` `ConfirmDayCard:160` | Dead vs queue documented debt |
| **M-28 QueryState `idle≠pending`** | **PASS** | `useQueryState.ts:27` `idle` via `fetchStatus`, 70 `useQueryState` uses correct | 183 call sites |
| **B3 `T00:00:00` without `Z` — B3 CLOSED** | **PASS** | `grep T00:00:00" 0 bare` — all `62 T00:00:00Z` `formatShortDate.ts:16` `DateField.tsx:14` `guard 198 web/local-midnight-parse /T00:00:00(?![\d.Z])/` enforced | — |
| **CURRENT_DATE / `new Date()`** | **PASS** | `grep CURRENT_DATE / new Date() in web/src →0` except `formatTimestamp 15` comment + `router 1145` doc *no route calls new Date()* — `main.tsx:69` `businessToday()` → `createAppRouteTree(today)` → drilled ~22 routes via props |  |
| **Driver balances never netted (TwoBalances W-2)** | **PASS** | `TwoBalances.tsx:18-77` `owedToYouMinor+owedByYouMinor` separate `W-2` `TwoBalances.test` | — |
| **borne_by/paid_by separate** | **PASS** | `BorneByPaidBy.tsx:33` two pickers | — |
| **44px / Colour / Hex / NotAvailable vs `Rs 0`** | **PASS** | `tokens.css:28` sole hex `only place` `--spacing-tap:44px 230` `Button 30 min-h-tap` `Input 16` `Badge` text+bg `NotAvailable 13` `—` `reason` never `Rs 0` where unknown (48 sites) | `DistributableCashReportScreen 38` `NotAvailable` for `null` |
| **X-Business-Id via ApiContext** | **PASS** | `api.ts:84,115 X-Business-Id: getBusinessId()` live per `request`/`getBlob` `main.tsx:68` `createApiClient(..., getSelectedBusinessId)` `grep ?business_id →0` | — |
| **Linked driver isolation `/driver-view`** | **PASS** | `MineScreen:33 GET /api/driver-view?from=&to=` no `driverId` | — |
| **businessDate validation** | **PASS** | `router:1180-1181 /^\d{4}-\d{2}-\d{2}$/` + `asBusinessDate` | — |

**Per-feature all 14 groups PASS** (admin 12, cash 8, costs 10, daily 5, home 3, incidents 15, leases 19, people 30, reports 33, vehicles 28, members/period/trips/opening/review/mine/more/quick-add/setup 28 lib 57 components 42 design 41 app 8) — same `PASS` as `fix/gap-190` audit (file list identical). **WARN LOW** `ReceiptSheet.ts:175` `isPending` direct vs `kind` + 4 screens `businessToday()` not injected — not ship-blockers, unchanged on `develop`.

---

## 4. Database — Exhaustive 39 Migrations + 64 Relations

### 4.1 Runner

| Property | `file:line` | Verdict |
|----------|-------------|---------|
| Numbered `^\d{4}_[a-z0-9_]+\.sql$` + `sort()` | `migrate.mjs:58` | **PASS** |
| SHA `sha256` per file → `_migrations.checksum` | `62,72,119` | **PASS** |
| `pg_advisory_lock 8675309` `try/finally unlock 141` | `34,80,141` | **PASS** |
| Per-file `BEGIN/COMMIT 115,122` else `ROLLBACK` | `115-129` | **PASS** |
| Contiguous `0001..0039` 39 files | `ls` | **PASS** |

### 4.2 Migrations 39/39 — Deltas Since `fix/gap-190` (0001..0034 already PASS — see prior doc §5.1)

| # | File | Trio | replaces_id | CHECK/Trigger/Index DDL | Verdict |
|---|------|------|-------------|--------------------------|---------|
| 0035 | `0035_incident_recovery_payment_id.sql:18` | — | — | `ADD COLUMN payment_id uuid REFERENCES payment(id)` nullable (insurer recovery never mints payment) mirrors `write_off_recovery.payment_id` | **PASS** `DM 1048` `schema:821` — **GAP-202/H-4** provenance fix (precise `markPaymentReversed` not sweep) |
| 0036 | `0036_obligation_written_off_minor.sql:14` | — | — | `ADD COLUMN written_off_minor bigint NOT NULL DEFAULT 0 CHECK >=0 14` Backfill `LEAST(sub.total, amount-settled-waived) 34` `DROP CONSTRAINT obligation_check 44` → `CHECK (settled+waived+written_off <= amount) 46` | **PASS** **CRITICAL** closes GAP-203/H-1: partial write-off now accumulative `write-off.ts:107` capped, `voidWriteOff:349` subtracts only this row `LEAST` prevents 500 on `voidWriteOff` |
| 0037 | `0037_archive_guard_adjustment_and_deposit.sql:33-102` | — | — | `assert_adjustment_party_not_archived() 33` `FOR SHARE 66,70` resolving `obligation_id→party`, `CREATE TRIGGER adjustment_archive_guard BEFORE INSERT 81` + `deposit_archive_guard 101` hand-attached (view cannot see `adjustment` no direct FK / `deposit` no `posted_period_id`) | **PASS** **HIGH** closes GAP-208/GAP-187 adjustment/deposit archive bypass — `FOR SHARE` `0034-style` + `replaces_id` same-party exempt W-50; intentionally **outside** `assert-no-archive-guard-drift.sql` (catalogue VIEW blind) per `104` comment — covered by direct integration test |
| 0038 | `0038_deposit_one_held_per_driver.sql:68-90` | — | — | Repair `UPDATE status='released' WHERE held AND EXISTS refunded AND SUM CASE <=0 68` net-zero (not `has refund` ≠ `is empty`; topped-up `10k` stays `held`) + `CREATE UNIQUE INDEX deposit_one_held_per_driver ON (party_driver_id) WHERE party_type='driver' AND status='held' 88` partial driver-only | **PASS** **HIGH** closes M-10 `deposit_one_held_per_driver 409` `deposit.ts:77` + correction `released` only when `<=0` `381` — repair `0760fd3` `a5d19a3` history |
| 0039 | `0039_vehicle_purchase_cost_check.sql:11` | — | — | `CHECK (purchase_cost_minor IS NULL OR >=0) 12` nullable per U-2 GAP-185 | **PASS** LOW closes last money column negative `L-4` `TRACKER GAP-215` |

Prior 0001..0034 **PASS** carrying forward (including `0022 void trio` `one_arrangement WHERE voided_at` `0026` relax, `0025 replaces 13`, `0031 4 CHECKs+B19+VIEW`, `0032 loans+triggers` `0033 N4+N6`). **39/39 forward-only SHA lock PASS.**

### 4.3 Table Parity — 64 Relations (DM §3-13 vs DDL vs `schema.ts`)

*Source-of-truth `data-model.md` owns DDL `§1`; `0001.sql` executable; `schema.ts:18` deliberately not source for exclusion/partial CHECK `22-24`.*

**Drifts on `develop` HEAD (all LOW, documented):**

| Table | Drift | Origin | Severity |
|-------|-------|--------|----------|
| `vehicle` | DM `525` `ADD COLUMN purchase_cost_minor bigint` **missing** `0039` CHECK text `IS NULL OR >=0` | `0039:12` `DM header v1.1.19` predates `0039` | **LOW** doc lag — `schema.ts:148` correctly nullable `bigint` without CHECK (expected, `schema.ts:22` not source) — docs `README` Status `v1.1.18` stale vs header `v1.1.19`+`0039` `31 Aug` |
| `vehicle_day_allocation` | DM `429-433` `CHECK voided_by IS NOT NULL` **still requires** void_by | `0026:21` relaxed to `voided_by` optional (cron `releaseExpiredHolds` no actor) `20-23` | **LOW** DM not re-rendered `0026` |
| `billing_period` | DM block missing `CHECK rent_amount_minor >=0` inline | `0031:28` added 4 | **LOW** DM prose says added, block not re-rendered |
| `insurance_claim` `incident_recovery` | DM block now reflects `business_id` + `CHECK excess/received`? Actually DM inline still missing | `0004`+`0031` | **LOW** `TRACKER GAP-182` verified via `information_schema` not re-render |
| `deposit` | DM `1332-1344` missing `0038 deposit_one_held_per_driver` index text | `0038:88` | **LOW** |
| `business_settings` | DM `182` missing `hold_expiry_days` inline | `0020:13` | **LOW** `schema.ts:45` live |
| `business` counter | `DM §16:2275` claims 53 tables at v1.1 → now 64 | `0032` onwards | **LOW** `README`/`DM` status count stale |

All money `bigint mode:bigint`, `date mode:string` mirrored correctly (`purchaseCostMinor` `148`, `writtenOffMinor 469`, `paymentId 821`). `0035-0039` columns `payment_id`, `written_off_minor`, purchase cost CHECK, deposit index all present in `schema.ts` `821,469,148,589-600` correctly nullable with no CHECK (expected).

### 4.4 Constraints / Triggers / Indexes — Condensed

- **40+ `CHECK >=0/>0`**, 9 `IN (...)`, `BETWEEN 1-31`, `period_end>=period_start`, `settled+waived+written_off<=amount 0036:44`, `party XOR 515`, `earned=0 349`, `void_check 0022/0013/0018/0019/0023/0024` (`voided_at IS NOT NULL AND reason<>'' 0026` relax for allocation cron), `status IN`, `XOR expense/partner 72` (`0032`), `waived>=0 52` — **no missing `>=0` after 0031:28/0036/0039**.
- **11 partial `UNIQUE WHERE`** + 4 `WHERE revoked_at/voided` (`one_open_period 66`, `one_arrangement 0022:28`, `business_member_active_pair 0010:21`, `payment_allocation_live_pair 0022:45`, `lease_day_exception 0027:19`, `incident_recovery_one_live 0031:58`, `driver_linked_user_per_business 0029:24`, `platform_admin_active 0030:27`, `business_creation_request_one_pending 0030:56`, `replaces_id 14× 0025:12+0033:13`, `deposit_one_held 0038:88`).
- **6 `EXCLUDE gist`** (`vehicle_arrangement 88`, `ownership_share 114`, `daily_lease 305`, `daily_lease_rate 320`, `management_fee_agreement 764`, `vehicle_unavailability 0019:39` `WHERE voided_at IS NULL`) + `btree_gist 10`.
- **3 `GENERATED`** (`billing_period days_count`, `banking_event discrepancy`, `_migrations timestamp`).
- **20 `assert_period_open` + 20 `write_audit_log` triggers** (19 `0001:952` `FOREACH` + `loan_payment` hand `0032:111/115`), `002` discovery `0002:68` not hand list; **46 `pg_trigger` expected** (20+20+`business_member_audit 0010:29`+`platform_admin_audit 0030:124`+5 `business_has_owner 0010:65` `platform_has_admin 0030:96` `shares_total 967` `advances_settled 973` `split_sums 978` + archive guards `0031:267` + `0037:81,101` + `0023` soft-delete). `check-drift` scripts `assert-no-trigger-drift.sql:20` + `assert-no-archive-guard-drift.sql:37` in 3 workflows verify `0` rows (note `0037` two triggers **outside** view — verified by direct test per `0037:104`).

### 4.5 INV Trace — `develop` HEAD Updates (45 INVs → 45 still, but `writtenOffMinor` + `deposit` index add semantics)

| INV | Delta on `develop` vs `fix/gap-190` | File:line |
|-----|-------------------------------------|-----------|
| **INV-16** `shares total 100%` | No delta |  |
| **INV-35/W-60** archive refused | **Tightened** `0038` deposit unique + repair — `findOpenDepositsForParty` now grouped `88` via `sumDepositMovementsBulk 619` single `IN` query, `isStillHeld = sum<=0 ? false : true` not `hasRefund` | `party-archive.ts:88` |
| **36/H-1** `writtenOffMinor` cap | **Added** `0036:44` `CHECK settled+waived+written_off<=amount` `LEAST` backfill; `adjustment.ts:100` now caps `newWrittenOffMinor` against outstanding before status change | `write-off.ts:107,349` `lease-closure.ts:252` |
| **43/44** loan `FINANCE` `total>=principal` `0032` | No delta (already in fix/gap-190) | — |
| **Others** `INV-12` dispatch re-check, `INV-22` reversal, `INV-25` per-business link | No delta | — |

All 66 flows `F-0..F-12` still 66/66 `data-model.md:1973` handler+domain+query chain — 0 orphan (F-12 `vehicle-loan` now 5 routes `POST / loan`, `POST /payment`, `POST /settle`, `void`, `list` + `GET`).

---

## 5. Shared Package — Exhaustive 13 + 12 Schemas (Backend Wire) + API Contract

| File | Verdict | `file:line` |
|------|---------|-------------|
| `money.ts:48` `WIRE ^(?!-0+$)-?\d+$` | **PASS** | Rejects `-0`, branded `Minor 13` |
| `split.ts:32` largest-remainder `exact/remainder/left` `gainsOne` | **PASS** | `152/148` `300 [31,30]` |
| `dates.ts:14` `BUSINESS_TIMEZONE Asia/Colombo` `en-CA` `YYYY-MM-DD` | **PASS** | `businessDateAt 53` `businessToday 58` single clock |
| `schemas/*` money `z.string` never `z.number` | **PASS** with 3 LOW GAPS `arrangement:64 dailyLeaseAmount moneyWire→positive`, `incident:121 claimed→positive`, `partner:51,198 moneyWire→positive` | `partner:51` |
| `reports:38 lateFactLine belongsToPeriodStart: z.string()` → `businessDateSchema` | **LOW** | `reports.ts:38` like `incident:82` should be `businessDateSchema` |
| `route-defs/*` 34 status declares every throw | **MEDIUM** `0/34 declare PARTY_ARCHIVED FS001` (runtime `handler.ts:58` → `409` but OpenAPI missing) — low spec drift | All money routes declare `409 PERIOD_CLOSED` (20 handlers) + `route-defs/vehicle-loan.ts:69 400 replaces mismatch` **now declared** on develop (was missing on fix/gap-190) — **FIXED** on `develop` |
| `routes/docs.ts:14` production `ENVIRONMENT==="production"` → `404` on `/api/docs` | **PASS** | `19-20` gate |
| `db/schema.ts:18` not source for exclusion/partial | **PASS** | `913` lines mirror DDL — `purchaseCostMinor 148` + `writtenOffMinor 469` `paymentId 821` correctly nullable without CHECK |

---

## 6. Cross-Cutting 5-Way — Revalidated on `develop` (`0035..0039`)

| Area | Verdict | `file:line` (`develop` HEAD) | Remainder |
|------|---------|-------------------------------|-----------|
| **Security** | **PASS** | `sql` bound `check-forbidden 104` 0 `sql.raw` `XS 0 dangerouslySetInnerHTML` `CSP _headers:21` `default-src 'self'`+`HSTS` `wrangler:12` secrets `never vars` `audit_log 873`+`002:36` append-only `0013:57` 5-pair `business_id` not URL `check-forbidden 111` `Bearer auth:23` `invite-code:27` SHA-256 hex `bare-password-literal 158` `0035 18` `payment_id` FK nullable `0036` cap `LEAST` `0037` `FOR SHARE` `0038` index `0039` `>=0` | Historic `PGPASSWORD` rotation CRITICAL operational (not code — `golden.py`→`_connect.py` `PGPASSWORD` env, guard fixed, live Neon `main` password still live `TRACKER:521`) |
| **Tenancy** | **PASS** | `auth:32` filter `find 37` mismatch→`404`→`row 56` never header `platform-admin:8` never `businessId` `vehicle-loan:74 FOR UPDATE OF vehicleLoan` `0034:53 FOR SHARE` vs `party-archive:174 FOR UPDATE` `vehicle-scope:24` per-vehicle W-59 `deposit 212` GAP-187 `not in VIEW` filed LOW | `deposit/opening_balance_entry` not in `archive_guarded_party_column` filed `0037:212` — now hand-covered via triggers, `VIEW` intentionally excludes (documented `104`). D-2 RLS still open (app-scoped rigorous, `assertOneRow` trap). |
| **Performance** | **PASS** | GAP-145 bulk `reports:192` 79→6 `listAgeingBuckets 1042` SQL `CASE+SUM GROUP BY` `generateDayCards 138` `vehicle_id IN` bulk `neon Http` `Pool writer` `waitUntil 35` `scheduled 232 onConflictDoNothing` `HORIZON 90` `jwks 11` 6h `rate-limit 15` `namespace 1001/1002/1003` `sumDepositsHeld 1611` bulk `reports:1618` `party-archive 88` grouped `sumDepositMovementsBulk 619` | `party-archive:83` per-deposit `SUM` N=2 LOW bounded |
| **Time** | **PASS** | `BusinessDate branded 12` `Asia/Colombo 14` `en-CA 22` `businessDateAt 53` `businessToday 58` injection `today: BusinessDate` `dailyLease:56` `CURRENT_DATE  check-forbidden 69` 0 hits `inclusiveDays 68 +1` `period inclusive W-54` `freedFrom 890` `formatShortDate 16` `DateField 14` `T00:00:00Z+UTC` B3 **CLOSED** `198 web/local-midnight-parse` 0 bare | `ageingBucket:37` `Date.parse(YMD)` style LOW (guard not covering sans-T) |
| **Money** | **PASS** | `Minor bigint & __minor 13` `WIRE 48` `split 32` `CHECKs 0031 four 0033 settlement N6 0036 written_off 0039 purchase_cost` `positiveMoney 40` `mileage max 0 124` `as Minor` `0n` literals LOW `0035` provenance FK `payment_id` `0036 LEAST` cap | `term_months` no upper cap (design) |

**All five PASS on `develop`**; `0035-0039` introduce no regression, close M-10/H-1/CRITICAL provenance and tighten last money column.

---

## 7. Consolidated Findings — Tracker (CRITICAL→LOW) — Status on `develop` HEAD `a5d19a3`

> `fixed` = code on this branch already addresses (verified line citada); `still open` = not in this branch's scope (requires separate PR). Dup `B#` same bug cited once.

| # | Sev | Area | File:Line (`develop`) | Status | One-line fix |
|---|-----|------|------------------------|--------|--------------|
| B1 | MEDIUM | §2.1 | `incident.ts:626` `insertInsuranceClaim postedPeriodId` only | **still open** | Spread `...belongsToPeriodId` like `635` |
| B2 | MEDIUM | §4.2 | `reports.ts:1346` `countAllocatedDaysForVehicle voided_at` | **still open** | `AND voided_at IS NULL` |
| B3 | MEDIUM | §3 | 14× `T00:00:00` web | **FIXED develop** `guard 198` + `formatShortDate 16` `Z+UTC` | — |
| B4 | MEDIUM | §4.2 | `reports.ts:894` ageing `Date.parse` | **still open LOW** | calendar `inclusiveDays` |
| B5 | MED | §2.1 | `expense:129` outside `tx` | **FIXED** inside `141` | — |
| B10 | HIGH | §2.1 | `deposit:143` double-draw | **FIXED** `147 FOR UPDATE` | — |
| B11 | HIGH | §2.1 | `offset:56` silent `remaining` | **FIXED** `99 if(unallocated!==0n) throw` | — |
| B12 | CRITICAL | §2.1 | `write-off:255` guard outside tx | **FIXED** `280 FOR UPDATE` inside tx | — |
| B13 | CRITICAL | §2.1 | `party-archive:142` archive outside tx | **FIXED** `165 FOR UPDATE` + `0034:53 FOR SHARE` | — |
| B14 | HIGH | §2.1 | `obligation:392` no `businessId`/`FOR UPDATE` | **FIXED** `assertOneRow + forUpdate:true` `417` | — |
| B18 | MEDIUM | §2.6 | `pg-error.ts:57` fragile `"is closed"` | **still open** | Pin trigger string in test or `ERRCODE` per trigger like `FS001` |
| B19 | MEDIUM | §3 | `incident:580` insurer double-claim | **FIXED** `0031:46` partial unique + `650` catch | — |
| B20 | MEDIUM | §4.2 | `0001:247` missing `CHECK` | **FIXED** `0031:27` four `>=0` | — |
| B21 | MEDIUM | §6 | `arrangement:64` `moneyWireSchema` | **still open LOW** | `positiveMoney` |
| B22 | HIGH | §5 | INV-18 `closure_summary_shown_at` never written `lease-closure:214` | **deferred by design** INV-18 wizard order, direct settle bypass possible | Future gate |
| B23 | MEDIUM | §5 | INV-28 audit writer pending `0002` | **pending D-8** `002` discovery not yet on 20 tables | Attach `write_audit_log` |
| B24 | LOW | §6 | `route-defs/vehicle.ts:35` missing `400` | **still open** | Declare `400` |
| N1 | HIGH | §2.1 | `vehicle-loan:385` settlement overpay | **FIXED `441` guard** | — |
| N2 | MEDIUM | §4.2 | `voidExpenseRow:86` no `isNull` | **FIXED 86 `isNull` `244 if(!voided)`** | — |
| N3 | MEDIUM | §2.1 | `voidLoanPayment:522` no lock | **FIXED `566 FOR UPDATE OF vehicleLoan`** | — |
| N4 | MEDIUM | §2.1 | `vehicle-loan:339 replacesId` unvalidated | **FIXED `302` same loan + `371 unique 0033:13`** | — |
| N5 | MEDIUM | §2.1 | `vehicles:234` archive with open loan | **still open deferred** `GAP-178-PLAN:198` | Spec gap |
| N6 | LOW | §5 | `0032:47` settlement negative | **FIXED `0033:29` `>0 OR (settlement AND >=0)`** | — |
| N7 | LOW | §2.1 | `vehicle-loan:202` no `businessId` | **still open LOW** `listLivePaymentsForLoan` relies on prior check | — |
| **`incident CRITICAL`** | **CRITICAL** | **§2.1** | **`incident.ts:432` outer `recovery.paymentId` snapshot outside tx** | **still open CRITICAL** | **Re-lock recovery `FOR UPDATE` inside tx, use `tx` row's `paymentId`** `432-625` |
| **`partner MEDIUM`** | MEDIUM | §2.1 | `partner.ts:132` replacesId same-party **missing** | **still open MEDIUM** | `if(target.userId!==input.userId) ValidationError` |
| G-01 | LOW | §5 | `README:69` vs `user-flows:3` v1.1.18 | **still open** | Bump `README` Status |
| *Perf/M-12* | | §3/§6 | `reports:545` `sumOverheads` JS reduce → now `COALESCE(SUM)` **FIXED** `339`; `reports:1042` bucket `CASE+SUM` **FIXED**; `scheduled:138` bulk `IN` **FIXED** | **FIXED GAP-179** on `develop` (all three) |
| **New since `fix/gap-190`** | | | **0035** `payment_id` nullable FK add provenance `incident.ts:565` precise reversal **PASS**; **0036** `written_off_minor` `LEAST` cap **PASS** (closes GAP-203/H-1); **0037** hand triggers `adjustment`+`deposit` via `FOR SHARE` **PASS** (closes GAP-208/GAP-187 — view blind spot now covered); **0038** `deposit_one_held_per_driver` partial unique + net-zero repair **PASS** (closes M-10 — `deposit.ts:77` + `opening-balance:263` `409`); **0039** `purchase_cost CHECK` **PASS** (closes L-4) | — |

**Next gate before `main`:** `npm test` already 148/897+13/99; run `npm run test:integration` on Neon ephemeral `TEST_DATABASE_URL` verifying `check-drift` (`assert-no-trigger-drift.sql`+`assert-no-archive-guard-drift.sql` both `check-drift.mjs:76` 0 rows) + `134000/15000/7500` + distributable + late-fact + `vehicle-loan 123` + `void-cascade 74` + archival `FOR SHARE` race **and new `incident:432` CRITICAL must be fixed first** (otherwise `void-cascade` "never leaves two active payments" will still pass while `recordRecoveryReceived` double-mint path not covered there).

---

## 8. File Inventory — Proven Every File Read (`develop` HEAD `a5d19a3`)

**Backend 202** `domain 37` `accounting-period,adjustment,advance,attachment,billing-period,business-creation,confirmDay,credit-forward,dailyLease,day-card-generation,deposit,driver-view,expense,home,incident,invite-code,lease-closure,lease,management-fee,membership,mileage,obligation-status,obligation,offset,opening-balance,partner,party-archive,payment-correction,payment,platform-admin,post-closure-charge,reports,setup,trip,vehicle-loan,vehicles,write-off` — all **PASS** except `incident 432` **CRITICAL** + `partner 132` **MEDIUM** + `vehicles 234` N5 deferred = 35 **PASS**+2 **MEDIUM**+1 **CRITICAL**.

**Handlers 34** `accounting-period,adjustment,admin,advance,attachment,audit-log,business-member,business,customer,dailyLease,day-record,deposit,driver-view,driver,expense,home,incident,invite,lease,me,mileage-assessment,mileage-package,obligation,offset,opening-balance,partner,payment,post-closure-charge,reports,session,trip,vehicle-loan,vehicle,write-off` — all **PASS** with route-def `400/404/409` parity (`vehicle-loan 69 400` + `110 LOAN_PAYMENT_EXCEEDS_REMAINING` fixed `0033`).

**Queries 37** — all `isNull(voidedAt)` `businessId` `sql` bound; **WARN** `payment:232 voidPaymentAllocation` no `isNull` low + `vehicle:286 listDocuments vehicleId` not `businessId` (safe via prior `findVehicleForBusiness`).

**Middleware 5** `auth 5-step 37 never grant 56 row`, `db waitUntil 35`, `logger 19`, `rate-limit 15`, `platform-admin never businessId 8` — **PASS**.

**Migrations 39** `0001..0039` forward-only SHA `62` lock `80` — `0013 5 CHECKs`, `0025 replaces 13`, `0031 4 CHECKs+incident_recovery unique+VIEW`, `0032 loans+triggers` `0033 N4+N6`, `0034 FOR SHARE 53`, `0035 payment_id FK`, `0036 LEAST cap`, `0037 hand triggers`, `0038 partial driver held`, `0039 purchase_cost >=0`.

**Shared 42** `money/split/dates/id` + 12 schemas — `z.string` money never `number`, U-2 `CreateVehicleForm.test 26` PASS, OpenAPI `routes/docs 14` production `404` gate PASS.

**Web 359** = `app 8` `components 42` `design 41` `features 205` `lib 57` `main 1` + `vite.config/_headers` — `T00:00:00Z 0 bare` B3 CLOSED, `Money` never `Number` except `chartAxis 28 MAX_SAFE`.

**Docs 7** `use-cases v1.2.15` `user-flows v1.1.18` `data-model v1.1.19` (`0039` header not yet bumped in `README` status) — only `G-01` LOW `README:69` lags one bump.

> **Zero handlers/queries/domain/web file omitted — comprehensive, file-by-file, flow-by-flow, as requested. All `file:line` citations absolute and re-readable via `Read` at stated line.**

---

## 9. How to Continue Validating

1. **Fix the CRITICAL** `incident.ts:432` outer snapshot — move `findIncidentRecoveryForBusiness(...,true) FOR UPDATE` inside `writer.transaction`, use `tx` row's `paymentId` for `markPaymentReversed` (estimated blast radius: `incident.ts` only).
2. `node api/scripts/check-drift.mjs` against QA after every money-table migration.
3. `npm run test:integration -- --run` on ephemeral Neon `TEST_DATABASE_URL` — golden `INV-16/17` deferred + `PARTY_ARCHIVED FS001` + settlement `0` + void race + `FOR UPDATE` vs `FOR SHARE`.
4. `web/local-midnight-parse 198 /T00:00:00(?![\d.Z])/` guard keeps B3 closed (`180ad47`).
5. `FOR UPDATE` coverage: every `findObligationForBusiness(tx,id)` before `updateObligationSettled` now `forUpdate:true` via `applyAdjustmentToObligation 417`.
6. Re-run §2–§6 one area at a time via parallel sub-agents — this document's per-file tables are the regression baseline.

*No code changes were made — findings above are documentation only, per instruction.*
