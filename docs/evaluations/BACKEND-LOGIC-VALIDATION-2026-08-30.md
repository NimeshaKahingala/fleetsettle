# Backend logic validation — follow-up to the 29 August review

**Status.** This is a second pass over `BACKEND-LOGIC-ACCURACY-REVIEW-2026-08-29.md` with two goals: (1) independently
re-verify every one of its 20 findings against the current code rather than trust the write-up, and (2) sweep the
backend areas that review cited only in passing or not at all — the full `queries/` layer, all 34 migrations, every
handler/route-def/route, `packages/shared/src`'s primitives, and the auth/middleware chain — for the same class of
defect: a figure silently dropped, doubled, or attributed to the wrong record by an ordinary second action.

**Method.** Two independent readers re-verified the original 20 findings line-by-line against the live code (not the
review's quotes) and spot-checked its strongest factual claims. Six further passes then read the remaining backend
area by area — roughly 30 of 36 `domain/` files read in full by hand, all 34 `queries/` files, all 34 migrations, all
33 handler/route-def/route triples, `scheduled.ts`, `index.ts`, the auth chain, and `packages/shared/src` in full —
checked against the owning spec (`docs/product/use-cases.md`, `docs/product/user-flows.md`,
`docs/engineering/data-model.md`) the same way the original review was.

**Headline.** All 20 original findings hold. Several are sharper or more severe than stated; one (M-5) does not
reproduce in the current code and is downgraded. The fresh sweep found **12 new findings**, the most serious of which
is a second and independently-discovered blind spot in the same report the 29 August review's own M-1/M-7 already
flagged as fragile: **UC-109's "how much can we safely take out" figure never subtracts money that has actually left
the business** — neither a partner payout nor a direct payment to a driver or customer ever reduces it. Two different
tables are missing from the same formula, found by two independent reviewers working on different parts of the
codebase, which is itself evidence this is a real gap and not a modelling choice.

---

## Part A — Corrections to the 29 August review

Every one of the 20 findings was re-traced against the current code. All are real. The table below is only the
deltas — where the fresh read sharpened, widened, or narrowed what was reported. Findings not listed here matched the
original write-up exactly, including line numbers.

| # | Correction |
|---|---|
| **H-1** | **Understated.** `write_off` also has no unique constraint on `obligation_id` — a second write-off against the same obligation is accepted too, doubling the recorded loss on top of the receivable already vanishing. The handler's four existence checks (obligation, both party ids, vehicle) make the *absence* of an obligation-vs-party cross-check look more deliberate than it is. |
| **H-2** | Confirmed exactly as written; no correction. |
| **H-3** | Confirmed exactly as written, including the unreachable `provisional`/`superseded` enum values on `mileage_assessment.status`. |
| **H-4** | **The fix needs a migration.** `incident_recovery` has no `payment_id` column (checked every migration through 0034), so "record which payment this recovery minted" — the fix the original review recommends — cannot land as a pure application change. A zero-migration interim exists: stop calling `markPaymentReversed` in the reverse-then-repost loop and unwind allocations the way `voidAdjustment`'s `unwindObligationAllocations` already does (reduce/void the allocation, never touch the parent payment). Ship that first; add `payment_id` provenance after. |
| **M-1** | **Three kinds wide, not two.** `listTransactionsForDateRange` (the export) also includes `customer_contribution` on the earned side, which the vehicle-profit queries omit as well — the export and the report disagree on `write_off`, `insurance_settlement`, **and** `customer_contribution`. |
| **M-2** | **The stated fix is only half right.** "Recover the colliding seq, or use `latest.seq` directly" — the second option breaks under `rollDueBillingPeriods`, which can roll one lease forward through several periods in one run; a competitor may have already committed more than one row by the time the catch fires, so `latest.seq` is not reliably the colliding one. Only the first option (thread the seq the insert itself computed out to the catch) is safe. |
| **M-3** | Confirmed exactly as written. Also: the `reduceBy` bug it names compounds with H-2 — an obligation already reduced by an off-road credit gets its pro-rata closure computed off the *original* rent, not the already-adjusted amount, so the two findings can fire on the same obligation and both understate correctly-charged rent. |
| **M-4** | Confirmed exactly as written. |
| **M-5** | **Downgrade M → L.** The failure mechanism the review describes — a `daily_lease_rate` gap silently producing no card — cannot currently occur. Every writer of `effective_to` (`changeDailyLeaseRate`) closes the old rate and opens the new one gaplessly inside one transaction, and no `daily_lease_rate` row is ever created without covering its own lease's `effective_from` forward. The code path is real and the absent error-reporting channel is worth adding cheaply, but it is a latent gap with no live trigger today, not a Medium. |
| **M-6** | Confirmed exactly as written. |
| **M-7** | **Hits a third reader.** `getPartnerSummary` (`domain/partner.ts:607`, the individual partner's own balance screen) also filters `payment.status = 'active'` via the same `listPartnerCashPositions` call — a corrected payment's surplus understates that partner's own held-cash line too, not only the two business-wide cash reports named in the original write-up. |
| **M-8** | Confirmed exactly as written. |
| **M-9** | Confirmed, and confirmed *universal*: all 82 uses of `businessDateSchema` across `packages/shared/src/schemas` were checked; none has an upper-bound refinement. |
| **M-10** | Confirmed exactly as written. |
| **L-1** | Confirmed behaviourally against the installed zod (4.4.3) — the throw inside `parse()`'s transform does escape `safeParse` for both scalar and object-nested schemas. |
| **L-2** | **The headline claim is wrong.** `lease` and `incident` carry no `posted_period_id`, so migration 0002's catalogue-driven audit trigger never attaches to either table — none of the three cited bare-transaction writes actually lose an `audit_log` row, because there is no audit trigger there to fire. `domain/business-creation.ts`'s four sites have the identical shape and the identical non-consequence. **What is real:** `updateLeaseTerms` (`queries/lease.ts:70-90`) still has no `business_id` in its `WHERE` clause — defence-in-depth missing, not an active bug since the handler already checks tenancy first. Treat this as that one residual item, not three files' worth of lost audit trail. |
| **L-3** | **Confirmed, and a third site.** `queries/home.ts:65-72` (`listDepositsDueForRelease`, the home-screen deposit-release list) carries a near-identical sequential per-deposit fan-out with the same justification comment. |
| **L-4** | **Half wrong.** Of the four rows: `insurance_claim.received_amount_minor` **does** have a `CHECK` as of migration 0031 (the review's own migration-number citation was for a different table in the same migration); `driver.driverDayFeeMinor`/`driverTripFeeMinor` **do** have `CHECK`s since migration 0001. Only `confirmDay.earnedMinor`/`receivedMinor` and `vehicle.purchaseCostMinor` are real gaps — two rows, not four. |
| **L-5** | Confirmed exactly as written. |
| **L-6** | Confirmed exactly as written, all four stale comments. |
| *"155 handlers, 13 exceptions"* | **The count is wrong, the claim's substance is right.** The real count is **174** handlers (independently corroborated three ways: `export const *Handler` count, `createRoute` def count, `.openapi()` registration count). The 13 named exceptions are exactly right and no unexpected capability gap exists. |
| *No `CURRENT_DATE` anywhere* | Holds. One grep hit total, inside a comment explaining why it isn't used. |
| *Trigger-array drift is CI-guarded* | Holds. `api/scripts/assert-no-trigger-drift.sql` exists, is dynamic (catalogue-scanned, not a hand list), and runs in `.github/workflows/integration.yml` immediately after `npm run migrate`. |

---

## Part B — New findings

Same severity scale as the original review: **H** — produces a wrong money figure with no signal. **M** — wrong
under a describable sequence, or refuses a legitimate action. **L** — wrong status code, non-determinism, or
code/comment drift.

| # | Severity | Finding | Where |
|---|---|---|---|
| NH-1 | H | Partner payouts (and loan-on-behalf drawings) never reduce cash-on-hand or distributable cash | `queries/reports.ts:1108`, `domain/reports.ts:475-551` |
| NH-2 | H | Direct payments to a driver or customer (`direction: 'paid'`) also never reduce the same figure | `queries/reports.ts:1108-1139` |
| NM-1 | M | The one legitimate ownership-share re-split (a partner buying in, INV-16's own example) 500s | `domain/partner.ts` (`setOwnershipShares`), `migrations/0001_initial_schema.sql:114-118` |
| NM-2 | M | `adjustment` has no archive-guard — new money can be raised against an archived party through it | `migrations/0031_archive_guard_and_missing_constraints.sql:212-229`, `domain/adjustment.ts` |
| NM-3 | M | GAP-187 (already tracked, confirmed still open): a fresh deposit can be taken from an archived driver | `domain/deposit.ts`, `migrations/0031...sql:244-254` |
| NM-4 | M | `voidIncidentRecovery` has the unfixed version of a race pattern already fixed twice elsewhere | `domain/incident.ts:521-563` |
| NM-5 | M | `createExpense`'s `paidByUserId` is the one party field never validated against business membership, and silently overwrites `created_by` | `handlers/expense.ts:55-92`, `domain/expense.ts:181-189` |
| NM-6 | M | `renewLease`'s rent schema allows zero/negative, unlike `startLease`'s | `packages/shared/src/schemas/lease-billing.ts:73` |
| NL-1 | L | Calendar-impossible dates (`"2026-02-30"`) pass validation and 500 at the database instead of 400 | `packages/shared/src/schemas/common.ts:44-47`, `dates.ts:41-46` |
| NL-2 | L | `listLoanPaymentsForLoan` is missing the tenancy scope its sibling function has | `queries/vehicle-loan.ts:234-244` |
| NL-3 | L | Loan-payment listings have no tie-break on same-day payments | `queries/vehicle-loan.ts:229,242` |
| NL-4 | L | `getSessionHandler`'s first-ever `app_user` insert bypasses the transaction | `handlers/session.ts:20-34` |
| NL-5 | L | Inconsistent nested-resource URL parent-verification across otherwise-identical void endpoints | `handlers/advance.ts`, `deposit.ts`, `write-off.ts`, `incident.ts` vs. `vehicle-loan.ts`, `vehicle.ts`, `dailyLease.ts` |
| NL-6 | L | Migration 0033's own `allow:` comment mislabels a narrowing `CHECK` as widening | `migrations/0033_loan_payment_replaces_id_and_settlement_check.sql:28-30` |

---

### NH-1 · Partner payouts never reduce cash-on-hand or distributable cash

`queries/reports.ts:1108-1174` (`listPartnerCashPositions`), consumed by `domain/reports.ts:475-551`
(`getCashPositionReport` / `getDistributableCashReport`).

`listPartnerCashPositions` computes each partner's held cash as `received − banked − advanced`, reading `payment`
(direction `received`), `banking_event`, and `advance`. It never references `partner_payout` — the table
`recordPartnerPayout` (`domain/partner.ts:397`) writes when an owner takes money out (UC-63, kind `'payout'`) or when
a vehicle-loan instalment is paid on an owner's personal behalf (`domain/vehicle-loan.ts`'s `loan_on_behalf` payouts).

UC-109's own formula in `docs/product/use-cases.md:830-835` is explicit:

```
Cash on hand and in bank
  −  security deposits held
  −  loan instalments due
  =  Distributable
```

"Cash on hand and in bank" is described as "the true physical total" (TRACKER.md's own GAP-186 entry, which records
a *different* bug in this exact function already found and fixed once — the deposit-cash omission from PR #131's
review). A payout is money that has actually left the business for a partner's own pocket; `sumPartnerPayoutsForUser`
(`queries/partner.ts:593`) correctly subtracts it from that partner's individual UC-67 balance — "a payout permanently
reduces what this partner is owed" — but the aggregate cash and distributable-cash reports never see it at all.

**Failure.** A business collects 200,000 in payments. `cashOnHandMinor` reads 200,000. The owner takes a 150,000
payout through the ordinary UC-63 flow. `cashOnHandMinor` **still reads 200,000** — the figure the report calls "the
single most expensive wrong number… because someone acts on it by moving money out of the business" is unchanged by
the exact action it exists to gate. A second payout of 150,000 shows the identical "safe" figure a third time. No
test exercises this: `api/tests/integration/reports.test.ts`'s distributable-cash suite covers deposits and loan
instalments only, never a payout.

**Fix.** Add a fourth, similarly-shaped subquery to `listPartnerCashPositions` — `SUM(amount_minor) FROM
partner_payout WHERE business_id = … AND voided_at IS NULL GROUP BY user_id` — and subtract it in `heldMinor`
alongside `banked`/`advanced`. `docs/engineering/data-model.md`'s DM §15 SQL needs the same added term. This is a
report-query change only; no migration is needed.

### NH-2 · Direct payments to a driver or customer never reduce the same figure

`queries/reports.ts:1108-1139`, same functions as NH-1 — found independently of NH-1, by a separate reviewer working
through the `queries/` layer rather than `domain/`.

`listPartnerCashPositions` reads only `payment` rows with `direction = 'received'`. `direction: 'paid'` is the
ordinary value `recordPayment` writes for **UC-50 "Pay the driver"** (F-6.1 — one tap on a trip's driver fee, a
retainer, a bonus), reachable through the same `POST /api/payment` endpoint under the same capability as collecting a
customer payment, and it sets `handledByUserId` exactly the way `received` does.

**Failure.** A partner collects 50,000 (`received`, held rises to 50,000), then pays a driver's fee of 15,000 in cash
through the same endpoint (`paid`, real cash leaves his hand — he now holds 35,000). `listPartnerCashPositions` still
reports 50,000 for him. This is not an edge case for an arrangement B/C business — paying drivers in cash is the
routine weekly pattern, so this compounds with NH-1 on every operating cycle, not just at payout time.

**Fix.** A fifth subquery, `SUM(amount_minor) FROM payment WHERE direction = 'paid' AND status <> 'reversed' AND
business_id = … GROUP BY handled_by_user_id` (the `status <> 'reversed'` matching M-7's own fix), subtracted from
`heldMinor` the same way. Ship together with NH-1 — both are the same function, same report, same underlying
omission pattern (a money-out table the formula was never extended to cover), and a single migration-free PR can
close both.

### NM-1 · The one legitimate ownership-share re-split 500s

`docs/product/user-flows.md:1347` states INV-16 by name: *"Last year's split changes when someone buys in."*
`ownership_share`'s date-ranged `EXCLUDE USING gist` constraint (`migrations/0001...sql:114-118`) exists to support
exactly that. Every sibling table with the identical shape — `vehicle_arrangement`, `daily_lease_rate`,
`management_fee_agreement` — has a matching "change" function that closes the prior open row before inserting the
new one. `ownership_share` never got one: `insertOwnershipShares` (`queries/partner.ts:60-63`) is insert-only, and
`setOwnershipShares`'s catch block handles only the deferred `assert_shares_total` violation (SQLSTATE `P0001`),
never the immediate `EXCLUDE` violation (SQLSTATE `23P01`).

**Failure.** An existing owner's share is reduced (not removed) when a new partner buys in — the retained owner's
`user_id` repeats between the still-open old row and the new request, both with unbounded date ranges. The `EXCLUDE`
constraint fires immediately, before the deferred total-must-be-100% trigger ever gets a chance to run, and reaches
the generic error handler as an unmapped `23P01` → raw `500`. `TRACKER.md:792`'s own tested claim ("a second POST
always 400s") is true only for a completely disjoint new owner set — not the buy-in case the constraint was written
for.

**Fix.** `setOwnershipShares` needs to close the prior open row(s) for any repeated `user_id` before inserting (the
same shape `changeDailyLeaseRate` already uses), and/or catch the `EXCLUDE` violation by name and map it to a clear
400. No migration needed — the constraint is correct as designed; the application code around it is incomplete.

### NM-2 · `adjustment` has no archive-guard

Migration 0031's `archive_guarded_party_column` view derives which tables need an archived-party guard from a
catalogue scan — but its membership test requires a **direct** foreign key to `driver`/`customer`. `adjustment`
reaches its party only indirectly, through `obligation_id → obligation.party_driver_id/party_customer_id`; it carries
no party column of its own, so the view never sees it, and `applyAdjustment` has no application-side check either.

**Failure.** A driver's obligations are all `paid`, so W-60 permits archiving him. A late `extra_charge` adjustment
(`sign = 1`) is then recorded against one of his now-closed obligations — nothing stops it, and the obligation
reopens with new money owed against a party the system says no longer exists for new business, exactly the state
GAP-187/W-60 exist to prevent, reached through a table their own scope doesn't cover.

**Fix.** A new migration adding a purpose-built trigger on `adjustment` that resolves the party via a join through
`obligation` rather than a direct column (with the same `replacesId` exemption migration 0031 gives every other
guarded table).

### NM-3 · GAP-187 confirmed still open

Already filed and deliberately deferred ("phase 2, not a Wave 9 blocker" — `TRACKER.md:518`), confirmed still
reproducible: `domain/deposit.ts` has no archived-party check anywhere, so a fresh deposit can still be taken from an
archived driver. Recorded here only because this pass independently re-confirmed it's still live, not as a new
finding — the fix path is narrower than the team's own comment suggests, since `deposit` (unlike `adjustment`)
already carries `party_driver_id`/`party_customer_id` directly and only needs a hand-added trigger, not a
catalogue-view change.

### NM-4 · `voidIncidentRecovery` has the unfixed version of an already-fixed race

`domain/incident.ts:521-563`. The blocking check (refuse to void a recovery with `receivedAmountMinor > 0`) reads via
`writer`, **before** the transaction opens. The void itself takes no lock and re-checks nothing inside its own
transaction.

**Failure.** Staff A opens a void for a recovery currently reading `receivedAmountMinor = 0` and it passes the check.
Concurrently, staff B calls `recordRecoveryReceived` for the same recovery — correctly guarded on its own side,
settles the obligation, mints a real payment. That commits first. A's stale check already passed; A's void proceeds
unconditionally. End state: a live `payment_allocation` points at a voided obligation, and the receivable disappears
from every report while a real payment sits behind it. This exact shape has already been found and fixed twice in
sibling functions — `voidObligation` (GAP-178/B12) and `voidWriteOff` (GAP-190/B12), both with comments describing
this precise race — `voidIncidentRecovery` is the one place the fix wasn't applied.

**Fix.** Move the read and the amount check inside the transaction, against a row locked `FOR UPDATE`, matching
`voidObligation`'s current shape.

### NM-5 · `createExpense`'s `paidByUserId` is unchecked and overwrites `created_by`

`handlers/expense.ts:55-92`, `domain/expense.ts:181-189`. Every other party reference on an expense —
`vehicleId`, `tripId`, `incidentId`, `borneByDriverId`, `borneByCustomerId` — is validated against this business
before the write. `paidByUserId` is not: it flows straight to `createExpense`, which writes it to **two** columns —
the legitimate `paid_by_user_id`, and also `created_by`, silently substituting it for the real authenticated actor
(`requireUserId(c)` is only used as a fallback when the field is omitted).

**Failure.** Any staff member with `dailyOperations` can submit an arbitrary well-formed UUID as `paidByUserId` —
another member's id, or a member of a *different* business (member ids are visible via `GET /api/business-member`).
The row writes with no 404/400: `created_by` now falsely attributes who entered the record, and `paid_by_user_id`
carries an unverified reference that `domain/expense.ts`'s own comment says will feed a near-term reimbursement
figure. `recordPaymentHandler` had and fixed this identical class of gap for a partner party (GAP-93); this handler
is a live instance the fix didn't reach.

**Fix.** Validate `body.paidByUserId` against business membership the same way `recordPaymentHandler` now does.
Separately, stop writing `createdBy: input.paidByUserId` — pass the real actor id through as its own field.

### NM-6 · `renewLease`'s rent schema drifted from its own sibling's fix

`packages/shared/src/schemas/lease-billing.ts:73` vs. `arrangement.ts:28`. `startLeaseRequestSchema.rentAmountMinor`
deliberately uses `positiveMoneyWireSchema` — its own comment cites GAP-177: "a mileage-only lease is not a real
arrangement… rent is always a real amount." `renewLeaseRequestSchema.rentAmountMinor` — same field, same table, same
concept — was never brought into line and still uses the plain `moneyWireSchema`, which admits both zero and
negative.

**Failure.** `PUT .../renew {"rentAmountMinor":"0"}` passes validation and the DB's `>= 0` CHECK — every billing
period generated from that point bills ₨0 rent, silently, with none of the goodwill trail GAP-177 exists to force. A
negative value passes validation but fails the CHECK as an unmapped `23514`, surfacing as a raw 500 instead of 400.

**Fix.** Change `renewLeaseRequestSchema.rentAmountMinor` to `positiveMoneyWireSchema`, matching `startLease`.

### NL-1 · Calendar-impossible business dates pass validation

`packages/shared/src/schemas/common.ts:44-47` and `dates.ts:41-46` both use a shape-only regex
(`/^\d{4}-\d{2}-\d{2}$/`) with no real-calendar check. `"2026-02-30"`, `"2026-04-31"`, `"2026-06-31"` all pass on
every business-date field in the API. Confirmed the value survives all the way to a Postgres `date` column, which
raises SQLSTATE `22008` — a code `db/pg-error.ts` has no predicate for, so it falls through to a raw 500. Separately
confirmed `Date.parse("2026-02-30T00:00:00Z")` does **not** throw — it silently rolls forward to 2 March — so any
pure date arithmetic (`inclusiveDays`, `addDays`) called on such a string *before* its first DB round-trip would
compute silently against the wrong date rather than erroring. Two call sites (`recordOffRoad`, `closeLease`) happen
to hit a DB write before their own date-arithmetic call today, so the live failure mode is the 500, not a silent
miscalculation — but that ordering isn't a defended invariant anywhere.

**Fix.** Validate real calendar validity in `asBusinessDate` (re-derive y/m/d via `Date.UTC` and compare, the same
technique `addCalendarMonths` already uses to detect month overflow) rather than relying on Postgres as the
backstop. Add `22008` to `pg-error.ts` regardless, as defence in depth.

### NL-2 · `listLoanPaymentsForLoan` missing tenancy scope

`queries/vehicle-loan.ts:234-244`. Its sibling three lines above, `listLivePaymentsForLoan`, takes `businessId` and
filters on it, with a comment explaining why (N7/GAP-190). `listLoanPaymentsForLoan` — same file, same table, the
full void-and-live history a manager browses to find a payment to void — takes no `businessId` at all. Its only
caller already 404s via a prior tenancy-scoped lookup, so this is defence-in-depth only, the same class the original
review's L-2 already named for six other functions.

**Fix.** Add `businessId` and filter on it, matching the sibling function immediately above.

### NL-3 · Loan-payment listings have no tie-break

`queries/vehicle-loan.ts:229,242` order by `paidOn` alone — money-safe today (every consumer sums the whole list,
order-independent) but the same class the original review's M-6 named for `obligation.ts`, on a table M-6 didn't
cover. A manager's own payment list can silently reorder between page loads whenever two payments share a date.

**Fix.** `.orderBy(loanPayment.paidOn, loanPayment.id)`.

### NL-4 · `getSessionHandler`'s first `app_user` insert bypasses the transaction

`handlers/session.ts:20-34`. The very first `app_user` row for a brand-new identity is inserted directly on the
top-level writer, never wrapped in `.transaction()` — the same shape the original review's L-2 named, a further
instance not previously listed. Low severity: `app_user` is not a money table and carries no
`assert_period_open()` exposure; only `changed_by = NULL` in that one audit row is lost.

**Fix.** Wrap the `insertAppUser` call in `writer.transaction(...)`.

### NL-5 · Inconsistent nested-resource URL verification

Routes like `/{id}/settlement/{settlementId}/void` name a parent in the URL. Loan payments, vehicle unavailability,
and daily-lease exceptions verify the child's parent field matches the URL's named parent explicitly. Advance
settlements, deposit movements, write-off recoveries, and incident recoveries do not — the domain function derives
the true parent from the child row itself, so this isn't exploitable today (still correctly `businessId`-scoped), but
the URL's parent segment is decorative on half of an otherwise-identical shape.

**Fix.** A deliberate pass to make the check uniform (or the URL shape uniform), not urgent.

### NL-6 · Migration 0033's comment mislabels its own CHECK change

`migrations/0033...sql:28-30`. The new `CHECK` is strictly *narrower* than the old one (it now excludes a negative
`amount_minor` on a settlement row that used to be admitted), but the `-- allow: widening a CHECK is additive`
annotation was copied from a sibling pattern where that label is accurate. Not a live-data risk — no existing row can
fail the new constraint — but this codebase leans on that exact label as a trusted, scannable marker; one mislabeled
instance is worth a comment correction the next time this file's neighbourhood is touched (never edit a historical
migration on its own for this alone — that would itself violate the forward-only rule the file otherwise honours).

---

## Part C — Coverage record

What this pass read and found already correct, so it isn't re-covered next quarter:

**`domain/` (30 of 36 files read in full).** `offset.ts`, `obligation.ts`, `obligation-status.ts`, `driver-view.ts`,
`accounting-period.ts`, `home.ts`, `attachment.ts`, `invite-code.ts`, `membership.ts`, `platform-admin.ts`,
`setup.ts`, `vehicles.ts`, `confirmDay.ts`, `dailyLease.ts`, `vehicle-loan.ts`, `business-creation.ts`,
`credit-forward.ts`, `party-archive.ts`, `advance.ts`, `payment.ts`, `deposit.ts`, `adjustment.ts`, `mileage.ts`,
`write-off.ts` (partial), `incident.ts` (partial), `payment-correction.ts`, `management-fee.ts`, `lease.ts`,
`billing-period.ts`, `lease-closure.ts`, `opening-balance.ts`, `day-card-generation.ts`, `trip.ts` (partial) — no
further money-correctness defects found beyond NM-1 through NM-6 above. In particular: `applyCreditForward`'s
FOR-UPDATE locking and direction-matching are correct; every void function's obligation-reversal arithmetic correctly
uses `computeObligationStatus`; `settleVehicleLoan`'s principal/finance split and rounding absorption hold under
every liability-owner branch; `saveOpeningBalance`'s commit/re-commit/correction cycle correctly reverses each
target-table kind by its own correct mechanism (void by id for obligations/advances, status flip for payments, a
real offsetting movement for deposits — never a flag, since deposit sums aren't `voided_at`-filtered).

**`queries/` (all 34 files, full read).** Every `SUM`/aggregate checked against its `voided_at`/`business_id` scope;
every `status IN (...)` filter checked against the real CHECK-constraint enum. Confirmed clean beyond NH-1/NH-2/NL-2/
NL-3 above.

**Migrations (all 34 files, full read).** No forward-only violations (zero `DROP TABLE`/`DROP COLUMN`/`ALTER
COLUMN…TYPE` across the whole set). Both original `ON DELETE CASCADE`s on money-adjacent tables were already replaced
with `RESTRICT` in migration 0023. All 25 `isUniqueViolation`/`isExclusionViolation` constraint names traced from
`domain/*.ts` back to their defining migration match exactly. `schema.ts` matches the live DDL on every money table
sampled.

**Handlers/route-defs/routes (all 33 of each, plus `index.ts`/`scheduled.ts`).** `business_id` provenance clean
everywhere (JWT-resolved only, never body/query). All 30 money routes correctly gated behind `authMiddleware`. All 4
cron jobs are independently try/caught, idempotent via a real unique constraint, and never a prerequisite for a user
action. The linked-driver boundary has exactly one entry point and no override path.

**`packages/shared/src` primitives.** `split`/`splitInteger` correct under zero totals, negative totals, ties, and
zero-weight shares; `divideHalfUp`'s single call site is fully guarded; `addCalendarMonths` recovers a clamped
month-end day correctly across repeated calls because every real caller recomputes from a fixed anchor rather than
chaining a prior result; over 15 of the 38 wire schemas spot-checked with no further gaps beyond NM-6 above.

**Auth chain.** The full `Capability × Role` matrix was rebuilt from `policy.ts` by hand; no inconsistent cell.
`platform-admin.ts` never sets `businessId`. `withActor`'s transaction-only actor attribution is confirmed to be the
exact mechanism NL-4 (and the original L-2) fall into.

---

## Part D — Consolidated fix list, in order

Combines the original review's own suggested order with the new findings, adjusted for the corrections above.

1. **NH-1 + NH-2** (partner payouts and `direction: 'paid'` payments invisible to cash-on-hand/distributable cash) —
   ship together, one PR, no migration. This is now the single most consequential open item across both reviews: it
   sits on UC-109's own figure, which both reviews agree is the one number in this system whose whole purpose is
   being acted on immediately.
2. **H-4** (recovery receipt reverses an unrelated payment) — ship the migration-free interim (stop calling
   `markPaymentReversed` in the reverse-then-repost loop) now; follow with the `payment_id` migration.
3. **H-1** (write-off) — including the newly-found double-write-off gap; both close with the same amount-vs-outstanding
   check plus a party cross-check.
4. **H-2** (off-road re-entry) — as originally scoped.
5. **H-3** (mileage period range) — as originally scoped.
6. **NM-1** (ownership-share re-split 500s) — INV-16's own worked example currently fails; likely to be hit the next
   time a real buy-in happens.
7. **M-7 / NL-2-class items** (corrected payment drops out of cash position, now including the third reader
   `getPartnerSummary`) — one-line filter change, same PR as NH-1/NH-2 makes sense given they touch the same query.
8. **NM-4** (`voidIncidentRecovery` race) — the fix is a direct copy of the pattern already applied twice elsewhere.
9. **NM-5** (`createExpense`'s unchecked `paidByUserId`) — a tenancy-adjacent gap with a known-good fix already
   shipped for the sibling case (GAP-93).
10. **M-1** (vehicle profit ignores waivers/write-offs) — needs the DM §15 decision the original review flagged;
    open it now since M-4 and this hang off the same question.
11. **NM-2 / NM-3** (adjustment and deposit archive-guard gaps) — one migration can plausibly close both.
12. **NM-6** (renewLease rent schema) — a one-line schema change.
13. **M-2, M-3, M-5 (now L), M-6, M-8, M-9, M-10** — each self-contained, as the original review ordered them.
14. **L-1 … L-6, NL-1, NL-3 … NL-6** — one sitting, grouped by file where they overlap (e.g. NL-1's date-validation
    fix and L-1's money-regex fix are both schema-layer hardening and land naturally together).

Every item above is a defect in the current build. As with the original review, only **M-1** is a disagreement with
the specification rather than the code — flagged there for the same reason: it needs a decision recorded in DM §15,
not a patch guessed at here.
