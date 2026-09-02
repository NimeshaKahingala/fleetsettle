# Backend logic & accuracy review — 29 August 2026

**Scope: the whole backend, read file by file.** Every module under `api/src` — 43 domain,
34 queries, 33 handlers, 33 route-defs, 34 routes, auth, middleware, db, errors, `index.ts`,
`scheduled.ts` — plus `packages/shared/src` (money, dates, split, 38 wire schemas), all 34
migrations, and the CI workflow wiring. Roughly 25,000 lines of backend logic.

**Question asked.** Not "is this code tidy" — *does every number this backend produces match
the fact it claims to represent, and where it cannot, does it say so.* Everything was read
against the owning document (`docs/product/use-cases.md`, `docs/product/user-flows.md`,
`docs/engineering/data-model.md`) rather than against intuition, because in this system the
document decides.

**Headline.** The money primitives, transaction discipline, period-trigger handling,
void/replace cascades, concurrency locking and the tenancy boundary are in genuinely good
shape — I attacked the split arithmetic, credit-forward allocation, loan principal/finance
ratio, the auth chain and the capability matrix and could not break any of them. What remains
is almost all one species: **a figure silently dropped, doubled, or attributed to the wrong
record by a second, ordinary manager action** — not arithmetic errors.

**Twenty findings. Four move a reported balance with no signal.**

Severity: **H** — produces a wrong money figure with no signal. **M** — wrong under a
describable sequence, or refuses a legitimate action. **L** — wrong status code,
non-determinism, or code/comment drift.

| # | Severity | Finding | Where |
|---|---|---|---|
| H-1 | H | A partial write-off erases the whole receivable | `domain/write-off.ts:82` |
| H-2 | H | Re-recording an off-road window double-credits the rent | `domain/incident.ts:116` |
| H-3 | H | Mileage drops any billing period only partly covered by the reading range | `domain/mileage.ts:107` |
| H-4 | H | Recording a recovery receipt reverses an unrelated earlier payment | `domain/incident.ts:443` |
| M-1 | M | Vehicle profit ignores every waiver, discount and write-off | `queries/reports.ts:139` |
| M-2 | M | The billing-period idempotency recovery is off by one and never fires | `domain/billing-period.ts:145` |
| M-3 | M | Pro-rating a final lease period is booked as goodwill | `domain/lease-closure.ts:145` |
| M-4 | M | Partner all-time earnings invent management fees never raised | `domain/partner.ts:567` |
| M-5 | M | A daily-lease day with no rate in force is silently skipped | `domain/day-card-generation.ts:73` |
| M-6 | M | Allocation order is non-deterministic among same-day dues | `queries/obligation.ts:398` |
| M-7 | M | A corrected payment drops out of the cash position entirely | `queries/reports.ts:1134` |
| M-8 | M | Adjustments cannot be backdated, defeating `occurred_on` | `handlers/adjustment.ts:58` |
| M-9 | M | No future-date guard on any business date | `schemas/common.ts:44` |
| M-10 | M | A driver can hold two deposits; his own view shows one | `queries/driver-money.ts:367` |
| L-1 | L | `"-0"` on any money field returns 500 instead of 400 | `schemas/common.ts:12` |
| L-2 | L | Three domain writes bypass the transaction, losing audit attribution | `domain/incident.ts:80` |
| L-3 | L | `sumDepositsHeld` is an N+1 against the Workers subrequest ceiling | `queries/reports.ts:1250` |
| L-4 | L | Money columns admitting negatives with no CHECK behind them | `schemas/day-record.ts:34` |
| L-5 | L | Trip fuel litres ignore `borne_by`, unlike trip fuel costs | `queries/expense.ts:294` |
| L-6 | L | Four stale comments that a later reader would trust | various |

---

## H-1 · A partial write-off erases the whole receivable

`domain/write-off.ts:82-85`, `handlers/write-off.ts:88-91`, `schemas/write-off.ts:11-21`

`recordWriteOff` flips the named obligation's `status` to `written_off` **regardless of the
amount written off**. Nothing — not the wire schema, not the handler (which only checks the
obligation exists), not the domain function — compares `amountMinor` against
`amount_minor − settled_minor − waived_minor`.

**Failure.** A customer owes 50,000. The owner writes off 10,000 ("he'll never pay the last
bit"). The obligation leaves receivables entirely — `listReceivables`
(`queries/reports.ts:1006`) and `listAgeingBuckets` (`:1057`) both filter
`status IN ('pending','part_paid')`. UC-74 now shows the customer owing nothing; the
transactions export shows a 10,000 loss. **40,000 of receivable vanishes with no row
recording where it went**, and the two reports disagree by exactly that amount.

The mirror case is open too: writing off *more* than is outstanding is accepted and
overstates the loss in UC-99's export.

**Also unchecked:** the named `obligationId` is never compared against
`partyCustomerId`/`partyDriverId`. A write-off can clear customer A's obligation while
attributing the loss to customer B.

**Fix.** In the transaction, after the locked read: require
`amountMinor === amount − settled − waived`, or add a partial form that records the residual
(a replacement obligation, or a `written_off_minor` column working the way `waived_minor`
already does). Compare the obligation's party to the request's and 400 on mismatch. Either
answer is defensible; the current silence is not.

---

## H-2 · Re-recording an off-road window double-credits the rent

`domain/incident.ts:116-207`

`recordOffRoad` has **no re-entry guard**. It updates `incident.off_road_from/to` and then,
for `credit_days`, applies a fresh pro-rata `agreed_discount` against the billing period's
rent obligation (`:185-201`). For `extend`, it pushes `lease.end_date` out by the window
length and writes a new `lease_extension` row (`:150-165`).

**Failure.** The manager records 8–19 July off the road, then corrects it to 8–17 July
(entirely ordinary — the workshop rang back). The second call applies a *second* discount on
top of the first. Two adjustments, neither wrong alone, and the rent obligation is reduced by
roughly twice the credit. `extend` behaves the same way: the lease end date moves out twice,
and each added day carries its own mileage allowance (F-2.3), so the excess is under-billed
too.

The guard rails only catch the pathological end: `applyAdjustmentTx` refuses once
`amount_minor` would go below zero or below `settled + waived`. A double credit on a half-paid
month lands cleanly.

**Fix.** This is F-3.4 step 2 — a decision recorded once. Either make it idempotent on
`incident_id` (reverse the prior adjustment/extension first, the shape `voidAdjustment`
already implements), or refuse a second call and require the prior treatment be voided, per
W-61's "undo what you did, in the order you did it". The `rent_treatment` column already
records that a treatment was applied; nothing reads it.

No test covers a repeated submission (`tests/integration/incident.test.ts` covers each
treatment once).

---

## H-3 · Mileage silently drops any billing period the reading range only partly covers

`domain/mileage.ts:107-124`, `queries/billing-period.ts:126-146`

`findBillingPeriodsInRange` selects periods **fully contained** in
`[previous.read_on, this.read_on]` (`periodStart >= from AND periodEnd <= to`). Odometer
readings in practice never land exactly on period boundaries.

**Failure.** Lease anchored on the 12th. Handover reading 12 Jan. Reading #2 on 14 Feb (two
days late — normal) closes period 1 correctly. Reading #3 on 12 Mar: the range is
`[14 Feb, 12 Mar]`, so period 2 (`12 Feb – 11 Mar`) starts *before* the range and is excluded;
period 3 hasn't ended. Zero periods match, and the manager gets *"This reading does not close
out any billing period yet"* — a legitimate reading refused.

If they wait until 12 Apr, the range `[14 Feb, 12 Apr]` contains period 3 but still not period
2, so **two months of driving are assessed against one month's allowance**. The excess is
over-billed by `daily_limit × days_in_period × excess_rate` and marked `isEstimated: false`,
because `periods.length === 1`.

This is precisely the case F-2.3 names as *"the one that will actually happen: no boundary
reading — periods either side are assessed **together** against their combined allowance."*
The code implements the combined-allowance arithmetic correctly and feeds it the wrong period
set.

**Fix.** Select periods that **overlap** the range (`periodStart <= to AND periodEnd >= from`)
and drop those a prior assessment already closed out (`mileage_assessment` /
`mileage_assessment_split` already record which). The `isEstimated` flag and the day-weighted
`splitInteger` apportionment both become correct for free once the period set is right.

**Related, same area:** `mileage_assessment.status` accepts `provisional | final | superseded`
(`queries/mileage-assessment.ts:19`) but `assessMileage` writes `"final"` unconditionally —
grep confirms nothing in `api/src` ever writes `provisional` or `superseded`. F-2.3's *"prior
provisional assessments are **reconciled**, not rewritten (INV-10, INV-21)"* is unimplemented,
and the enum makes it look implemented.

---

## H-4 · Recording a recovery receipt reverses an unrelated earlier payment

`domain/incident.ts:443-453`

`recordRecoveryReceived` reverse-then-reposts, to stop a corrected amount double-posting cash
(the fix its own comment describes). But it reverses **every live allocation against the
obligation**, not the ones this handler minted:

```ts
const priorAllocations = await findPaymentAllocationsForObligation(tx, recovery.obligationId);
for (const alloc of priorAllocations) {
  await voidPaymentAllocation(tx, alloc.id, { … });
  await markPaymentReversed(tx, alloc.paymentId);   // ← the whole parent payment
}
```

`findPaymentAllocationsForObligation` (`queries/payment.ts:250`) returns every live allocation
regardless of which payment produced it, and `markPaymentReversed` (`:37`) flips the entire
`payment` row to `status = 'reversed'`.

**Failure.** `recordCustomerContribution` calls `applyCreditForward` (`domain/incident.ts:322`),
so a customer carrying unapplied credit has the contribution partly settled from an **earlier,
genuinely separate payment**. When the money for the recovery later arrives, this loop voids
that credit-forward allocation and marks the earlier payment — a real 20,000 receipt from
three months ago — `reversed`. That payment then disappears from the partner cash position and
`getDistributableCashReport` (both filter `status = 'active'`), from credit-forward, and from
the customer's payment history. **A receipt the business genuinely took is erased by recording
an unrelated one.**

The same shape hits a payment allocated across several obligations: reversing it for one
obligation reverses it for all.

**Fix.** Reverse only what this path minted — record the `payment_id` on the recovery row (or
match on `payment.party/occurred_on` provenance) and unwind that alone. `voidAdjustment`'s
`unwindObligationAllocations` (`domain/adjustment.ts:262`) uses the same query correctly: it
voids or reduces allocations and never touches the parent payment. That is the model.

---

## M-1 · Vehicle profit ignores every waiver, discount and write-off

`queries/reports.ts:139, 191, 242, 289, 407, 497`

`sumVehicleEarned*` counts `obligation.amount_minor` for `rent | daily_amount |
mileage_excess`. `sumVehicleCosts*` counts `expense` (`borne_by='us'`) plus obligations of kind
`driver_fee | management_fee`. Nothing else enters either side.

So a mileage excess of 340 **auto-waived on the spot** (`domain/mileage.ts:180-196` writes the
obligation at full `amount_minor` with `waived_minor` equal to it) counts as 340 of vehicle
revenue in UC-70's month, with no offsetting cost. Same for every `waiver`, `agreed_discount`,
`goodwill` and `extra_charge` adjustment, and every `write_off`.

**This matches DM §15's documented UC-70 query verbatim**, so the code is faithful — but the
document is producing the wrong number, and CLAUDE.md explicitly invites that to be said. The
stated intent (FL §5.73, *"the month shows the 340 charged and the 340 waived"*) is not what
the month shows: it shows the 340 charged and nothing else.

**Consistency evidence this is a real gap, not a modelling preference:** UC-99's export
(`listTransactionsForDateRange`, `:1926-1960`) *does* include `write_off` (money out),
`customer_contribution` and `insurance_settlement`. So the year's CSV and the year's report
are computed from different fact sets and will not reconcile — same business, same window,
same screen session.

**Fix (a decision, not a patch).** Pick one basis and state it in DM §15: either net
`waived_minor` out of earned and add write-offs to costs, or state that UC-70 is
gross-of-goodwill and make the export agree. Then make the three report families read one list
of kinds.

---

## M-2 · The billing-period idempotency recovery is off by one and never fires

`domain/billing-period.ts:145-153`

On a `billing_period_lease_id_seq_key` unique violation the wrapper re-reads
`findLatestBillingPeriodForLease` and computes `seq = latest.seq + 1` — but by then the
*winner's* row is the latest, so this asks for the seq **after** the one that collided.
`findBillingPeriodByLeaseAndSeq` returns nothing and the original violation is rethrown as a
500.

The function's own doc claims *"either path re-firing is a no-op, not a duplicate due"*, and
`tests/integration/lease.test.ts:299-307` states the race is *"not re-tested here"*. The claim
has never been exercised. Reachable in production: `rollDueBillingPeriods` (cron) and
`POST .../billing-period` can both target the same lease.

**Fix.** Recover the *colliding* seq, not the next one — `generateNextBillingPeriodTx` already
computes it; pass it to the catch, or use `latest.seq` directly.

---

## M-3 · Pro-rating a final lease period is booked as goodwill

`domain/lease-closure.ts:139-155`

`closeLease` with `finalPeriodMode: "days_used"` applies the pro-rata reduction as
`adjustmentType: "goodwill"`. `sumGoodwillGiven` (`queries/reports.ts:1470-1483`) sums
`waiver | auto_waiver | goodwill`, so **every pro-rated closure inflates UC-77's annual
"goodwill given" total** — the one number that report exists to produce (W-28).

Charging only for the days actually used is a contractual entitlement, not a gift. The sibling
branch already knows this: `finalPeriodMode: "agreed"` uses `agreed_discount`/`extra_charge`
(`:158-172`), neither of which is in the goodwill list.

Smaller issue in the same block: `reduceBy` is computed from `period.rentAmountMinor` but
applied against `obligationRow.amountMinor`, which may already carry an earlier adjustment.

**Fix.** Use `agreed_discount` for `days_used`, and compute `reduceBy` from the obligation's
current `amount_minor`.

---

## M-4 · Partner all-time earnings invent management fees that were never raised

`domain/partner.ts:563-570` vs `domain/management-fee.ts:41-45`

`sumAllTimeEarnedForUser` adds `monthlyAmountMinor` for every accounting period in which the
agreement was effective **as of `period.periodEnd`**. The actual `management_fee` obligations
are written by `generateManagementFeeObligationsTx` using
`listManagementFeeAgreementsEffectiveAsOf(period.periodStart)`.

Two different effective-date bases for one fact. An agreement starting mid-period is counted in
`balanceMinor` but has no obligation; one revoked mid-period is the reverse. And because this
is a pure in-memory replay, it counts the fee for every historical period **whether or not the
obligation was ever generated** — the cron and period-close path only started writing them at
A10a/GAP-39, so earlier periods are counted as the partner's income while the vehicle's costs
for those months never bore them.

`getPartnerSummary`'s `earned.managementFeeMinor` (`sumManagementFeeAsOfDate(periodEnd)`) has
the same mismatch — and `queries/partner.ts:632-643` flags it in its own comment: *"switching
this read to the obligation table is a real question for whoever revisits it."* This is that
revisit.

**Fix.** Read the actual `management_fee` obligations (they carry `posted_period_id`,
`party_user_id`, `voided_at`). That also makes the partner balance agree with the vehicle cost
side by construction.

---

## M-5 · A daily-lease day with no rate in force is silently skipped

`domain/day-card-generation.ts:73-77, 176-195`

`resolveRateForDate` returns `undefined` when no `daily_lease_rate` covers the date, and
`materializeDailyLeaseHorizon` then creates the **allocation** row but no `day_record` — no
error, no counter, and nothing in `unrestorableDayRecordDates` (that array is only appended for
the period-boundary case).

**Failure.** A rate's `effective_to` is set (a rate change entered with an end date, successor
entered a day late) and every pattern day in the gap produces no card. The vehicle reads as
occupied, the driver owes nothing for those days, and nothing says a day is missing. F-4.1's
unconfirmed-days list cannot show it — there is no row.

The on-demand path does the right thing: `confirmDayHandler` 404s with *"No rate is in force
for this daily lease on this date"* (`handlers/day-record.ts:83`).

**Fix.** Report rate-gap dates the same way period-gap dates are reported — they already have a
channel (`MaterializeDailyLeaseHorizonResult`) and a log line (`logUnrestorableDailyLeaseDates`,
`scheduled.ts`'s `warn` level).

Adjacent, milder: `isPatternDay`'s `alternate` anchor (`effective_from` as day zero) is a
judgment call the code's own comment flags as undocumented. Worth recording in FL §4.2 before a
second vehicle uses the pattern.

---

## M-6 · Allocation order is non-deterministic among same-day dues

`queries/obligation.ts:398, 449, 791`

`findOutstandingObligationsForParty` / `…ForDriver` / the lease variant order by `dueOn` alone,
with no tie-break. Same-date dues are common — a rent and a mileage excess both on the 12th,
several `daily_amount` obligations from one confirm-all — and Postgres may return them in any
order. §6.5's "oldest first" holds; *which* of the day's dues a partial payment clears does not.

Consequences: the allocation preview shown to the manager can disagree with what the write
does; two replays of the same figures settle different obligations; the ageing report moves
between refreshes.

The codebase already states the rule elsewhere: `findOwnershipSharesAsOfBulk` is explicitly
ordered by `id` because *"an unordered SELECT leaves that to whatever the query planner happens
to pick"* (`queries/reports.ts:768-778`). Same argument, three queries that missed it.

**Fix.** `.orderBy(asc(obligation.dueOn), asc(obligation.id))` — ids are UUIDv7, so this is
insertion order, matching the ownership-share precedent exactly.

---

## M-7 · A corrected payment drops out of the cash position entirely

`queries/reports.ts:1134`, `domain/credit-forward.ts:88`, `domain/payment-correction.ts:120`

`payment.status` is `active | corrected | reversed` (migration 0001:540). A *partial*
correction sets `corrected` and reduces `amount_minor` to the remaining real figure — that
remainder is money the business genuinely holds. But both readers filter `status = 'active'`:

- `listPartnerCashPositions` — the partner's held cash, and through it
  `getCashPositionReport` **and** `getDistributableCashReport`.
- `applyCreditForward` — so a corrected payment's surplus can never settle a later due.

**Failure.** A 10,000 receipt is corrected down to 8,000 (miscounted at handover). The
partner's held cash drops by the whole **10,000**, not 2,000. `cashOnHandMinor` and
`distributableMinor` — the figure W-56 calls the most expensive wrong number in the system,
"because someone acts on it by moving money out of the business" — both understate by 8,000.

**Fix.** Both filters should be `status <> 'reversed'` (or `IN ('active','corrected')`).
`reversed` is the only status that means "none of this counts"; `corrected` means "this much
of it does", which is exactly what `amount_minor` now holds.

---

## M-8 · Adjustments cannot be backdated, defeating `occurred_on`

`handlers/adjustment.ts:58`, `schemas/adjustment.ts:24-42`

`createAdjustmentRequestSchema` has **no `occurredOn` field**, and the handler pins
`occurredOn: today`. Every other money endpoint — advance, deposit, offset, payment, partner
payout, banking event, incident recovery, write-off, post-closure charge — accepts the date
from the client. Adjustment is the sole outlier.

Migration 0017 added `adjustment.occurred_on` specifically so UC-77's goodwill report could
window on the date the waiver was *given*. `sumGoodwillGiven`'s own comment states the reason:
*"`created_at` was when the row was inserted, which is a different date whenever U-8's 'any
record can be entered for a past date' applies."* With the write path pinning `occurred_on` to
today, it is always the insert date — so GAP-73 moved the report onto a column that still
carries the defect it was fixing.

**Failure.** A waiver agreed in June, entered on 1 September during catch-up, never appears in
June's goodwill total and inflates September's. Combined with M-3, UC-77's annual figure is
unreliable in two independent ways.

**Fix.** Add `occurredOn: businessDateSchema` to the request schema (optional, defaulting to
today) and pass it through — the domain function already takes it.

---

## M-9 · No future-date guard on any business date

`schemas/common.ts:44-47`, `queries/accounting-period.ts:57-66`

`businessDateSchema` accepts any well-formed `YYYY-MM-DD`. A sweep of every handler found **no
upper bound anywhere** — no `<= today` check on `occurredOn`, `spentOn`, `dueOn`, `issuedOn`,
`paidOn`, `writtenOffOn` or any other money date.

`resolvePeriodLinkage` then behaves badly on a future date: `findPeriodForDate` finds no period
(the successor month does not exist yet), so `belongsToPeriodId` is `null` and the row posts to
the open period **indistinguishable from an on-time fact** — W-35's late-fact flag has no
early-fact counterpart.

**Failure.** A year typo (2062 for 2026 — one keypress on a phone) puts a real payment outside
every date-windowed report that would show it: `sumVehicleEarnedForDateRange` (`due_on`),
`sumVehicleCostsForDateRange` (`spent_on`), `getTransactionsCsv`, `sumGoodwillGiven`
(`occurred_on`). It still counts in the period-keyed vehicle-month report, so the two report
families disagree; and in the ageing report `asOfDate − effective_due_on` is negative, so it
sits in "current" forever and never ages.

**Fix.** A shared `notFutureBusinessDate` refinement (the same shape `positiveMoneyWireSchema`
took for GAP-177/B21), applied to the money-date fields. The business timezone's today is
already available at every handler via `requireBusinessTimezone`.

---

## M-10 · A driver can hold two deposits; his own view shows one

`handlers/deposit.ts:37-75`, `queries/driver-money.ts:367-385`

`takeDriverDeposit` mints a **new** `deposit` row on every call, and nothing refuses a second
one for a driver who already has a `held` deposit — no unique index, no pre-check.
`findHeldDepositForDriver` then returns `ORDER BY created_at DESC LIMIT 1`.

**Failure.** A driver hands over 20,000, then tops up 10,000 through the *take* endpoint rather
than the *movement* endpoint (both are plausible taps). Two `held` deposits. `getDriverOwnView`
(F-6.8/UC-59) shows only the newest — **10,000, when he has handed over 30,000**. UC-59's whole
promise, and INV-25's *"every figure here must match F-6.5 exactly, since it's two people
looking at one number instead of two memories"*, breaks.

The business-side figures are fine: `sumDepositsHeld` and `findOpenDepositsForParty` (the
archive guard) both sum every deposit. Only the driver's own statement is wrong, which is the
one surface where being believed about money matters most.

**Fix.** Either refuse a second `taken` while one is `held` (directing the manager to the
top-up movement), or make the driver view sum every held deposit. The first is closer to
DM §10.4's one-deposit-per-party-per-lease shape.

---

## L-1 · `"-0"` on any money field returns 500 instead of 400

`schemas/common.ts:12-16` with `money.ts:56-61`

`moneyWireSchema`'s regex is `^-?\d+$`, which admits `"-0"`; the `.transform(parseMoney)` it
feeds then throws a `TypeError`, and **a throw inside a zod v4 transform escapes `safeParse`**
(verified against the installed version, not assumed). It reaches `errorHandler`
(`errors/handler.ts:33-35`), which has no `AppError` to map and returns `500 INTERNAL_ERROR`
with a stack logged at `error` level.

Not a wrong number — but a malformed request that pages as a server fault, on every money field
in the API.

**Fix.** Tighten the schema regex to the wire grammar `money.ts` actually accepts
(`/^(?!-0+$)-?\d+$/` — already written and commented there), so zod rejects it as a 400.

---

## L-2 · Three domain writes bypass the transaction, losing audit attribution

`domain/incident.ts:80` (`openIncident`), `domain/incident.ts:739` (`closeIncident`),
`domain/lease.ts:161` (`renewLease`)

`withActor` (`db/client.ts:48-73`) sets `fleetsettle.actor_id` **only inside `.transaction()`**.
A bare top-level write never opens one, so `write_audit_log()` records `changed_by = NULL`.
Every other domain write in these same files wraps for exactly this reason and says so
(`createExpense`, `recordCustomerContribution`, `setOwnershipShares`).

`lease` is in migration 0002's audit set, so `renewLease` is the one that actually loses a
money-relevant trail. `domain/business-creation.ts:61, 85, 142, 172` has the same shape and
deserves the same check.

Separately, `renewLease` accepts a `businessId` it never uses — `updateLeaseTerms`
(`queries/lease.ts:70-90`) has no `business_id` in its `WHERE`. The handler checks tenancy
first, so this is defence-in-depth only, but it is the exact pattern PR #144 fixed for
`archiveVehicle` and left in place here (and in `changeVehicleArrangement`,
`changeVehicleServiceInterval`, `archiveDriverRow`, `unarchiveCustomerRow`).

---

## L-3 · `sumDepositsHeld` is an N+1 against the Workers subrequest ceiling

`queries/reports.ts:1250-1262`

One query per held deposit, inside `getCashPositionReport` **and**
`getDistributableCashReport`. The comment argues the count is bounded, and today it is — but
GAP-145 was this same shape and surfaced as a live 500 at 79 subrequests against a ceiling of
50, on a six-vehicle business. A fleet with ~30 held deposits puts UC-109's distributable-cash
screen over the line.

**Fix.** One grouped query:
`SELECT deposit_id, SUM(CASE WHEN movement_type IN ('taken','topped_up') THEN amount_minor ELSE -amount_minor END) … WHERE voided_at IS NULL GROUP BY deposit_id`,
keeping the sign logic where it already lives.

The same shape exists in `domain/party-archive.ts:78-80`, though there it is at least
`Promise.all` rather than sequential.

---

## L-4 · Money columns admitting negatives with no CHECK behind them

Checked every `*Minor` field in `packages/shared/src/schemas` against its column's constraint.
All are `bigint` mode in `db/schema.ts` (no `number` anywhere — verified). Four gaps:

| Field | Schema | Column CHECK |
|---|---|---|
| `confirmDay.earnedMinor` / `receivedMinor` | `moneyWireSchema` | negative 500s at `obligation.amount_minor >= 0`; **zero passes**, bypassing GAP-177/B21's "record it at full price with an explicit waiver" rule |
| `settleInsuranceClaim.receivedAmountMinor` | `moneyWireSchema` | `insurance_claim.received_amount_minor` has **none** (migration 0031 added one to `incident_recovery` only) — a negative 500s mid-transaction on the paired row |
| `driver.driverDayFeeMinor` / `driverTripFeeMinor` | `moneyWireSchema` | **none** — stored and displayed only, no report arithmetic |
| `vehicle.purchaseCostMinor` | `moneyWireSchema` | **none** — same |

None silently corrupts a ledger figure; the first two turn a 400 into a 500, the last two are
display defects. Worth closing as a set, with `positiveMoneyWireSchema` where it applies.

---

## L-5 · Trip fuel litres ignore `borne_by`, unlike trip fuel costs

`queries/expense.ts:294-302` vs `:277-291`

`sumTripCostsByCategory` filters `borne_by = 'us'` (INV-5); `sumTripFuelLitres` does not. So
`closeTrip`'s `kmPerLitre` divides the trip's distance by litres that may include fuel the
driver bore. §6.7 defaults arrangement C's fuel to `us`, so it rarely bites — but the matrix is
explicitly "all overridable on the individual record", and UC-72's own rule (*"only fuel you
bought"*, W-20) is what `listUsBoughtFuelFills` enforces two files away.

---

## L-6 · Four stale comments a later reader would trust

- `auth/policy.ts:30-40` — says `viewReports` is "a flat stand-in… every report in P11 reads
  across the whole business regardless of role". No longer true: `getVehicleMonthReportHandler`
  resolves a manager's vehicle set via `listVehicleIdsManagedByUserForPeriod` (D-17/INV-34).
  The other reports being business-wide *is* deliberate (W-59), which the comment now obscures.
- `domain/opening-balance.ts:263-266` — asserts `sumDepositMovements` "sums every row
  regardless of `voided_at`". It filters `isNull(voidedAt)` (`queries/driver-money.ts:600`).
  The behaviour the comment justifies is still correct; only the reason is now false.
- `db/pg-error.ts:100-110` — `isPeriodClosedViolation` and its three siblings disambiguate
  `P0001` by **message substring**. I verified against all 34 migrations that the ten
  `RAISE EXCEPTION` sites are currently unambiguous, but the file's own comment files this as
  B18 and it is still open: a migration rewording a message silently breaks the mapping and a
  `PERIOD_CLOSED` becomes a 500.
- `queries/identity.ts:90` — `resolveMemberships`'s driver branch does not filter
  `driver.voided_at`, so an archived linked driver keeps `viewOwnData`.
  `listActiveDailyLeasesForCalendar` and `listLeasesDueForNextBillingPeriod` both added that
  filter under GAP-178/B13; the auth path was not revisited. Arguably correct (archiving
  requires zero open money, and reading your own history is harmless) — but it is an unstated
  consequence, worth a deliberate decision rather than an omission.

---

## What I checked and found correct

Recorded deliberately — a review that only lists faults invites the same ground being
re-covered next quarter.

**Money and time primitives.** `split`/`splitInteger` largest-remainder including negative
totals and deterministic tie-breaking; `divideHalfUp`'s symmetric rounding; `parse`/`toWire`
round-tripping; `fromInput`'s deliberately looser grammar; every money column `bigint` mode, no
`number` in any money path. `businessDateAt` via `Intl.DateTimeFormat('en-CA')`;
`inclusiveDays`; `addCalendarMonths`' end-of-month clamping (31 Jan + 1 month → 28/29 Feb, no
drift); every SQL date a bound parameter — no `CURRENT_DATE` anywhere in the codebase.

**§6.7's borne-by matrix** (`domain/expense.ts:34-41`) reproduces UC §6.7 exactly: tolls
flipping B→driver / C→us, fines' one-tap deduction, cleaning's "customer's while he has it,
ours between rentals" fallback, and the vehicle-loan finance row that deliberately does not
flip. Resolved as of `spent_on`, not today (GAP-56).

**Loan arithmetic.** The fixed `principal : finance` ratio per payment; `settleVehicleLoan`'s
closing payment absorbing accumulated rounding onto `principalOutstanding`; W-69 honoured
(forgiveness writes no money record); `financeMinor` provably bounded by the loan's own finance
total.

**Transaction and locking discipline.** Parent-row `FOR UPDATE` before every read-modify-write
(deposit, advance, loan, obligation, write-off, party archive); the deliberate choice to lock
the parent rather than the children under READ COMMITTED; migration 0034 pairing the archive
trigger's `FOR SHARE` against it; `assert_period_open` caught and mapped, never pre-checked.

**Void/replace cascades.** `voidOffset` unwinding both sides symmetrically; `voidAdjustment`
unwinding payment allocations newest-first and refusing when the settlement is not
allocation-backed; `voidWriteOffRecovery` reversing the minted payment so a recovered bad debt
cannot resurface as spendable credit; `replacesId` party/parent checks on every table;
`payment_allocation_live_pair` correctly made partial in 0022.

**`confirmDay`.** Four inserts in one transaction; the pre-generated-`open`-row UPDATE path
(GAP-3); `expected_minor` server-resolved from `daily_lease_rate`, never trusted from the
client; `received <= earned` enforced on parsed bigints (not, as I first suspected, on strings).

**Auth and tenancy.** `authMiddleware`'s five-step chain — `X-Business-Id` is a filter over
server-derived memberships, never a grant; `businessId` set from the matched row, not the
header. Cross-tenant is 404 throughout, capability-denial is 403. `resolveMemberships`'
`UNION ALL` (correctly not an `or()` join) with per-business dedup preferring the member shape.
`platformAdminMiddleware` never sets `businessId`. **Every one of the 155 handlers carries a
`requireCapability` call** except the 13 that legitimately should not (9 platform-admin behind
their own middleware, plus business-create, invite-redeem, me, session) — checked mechanically,
not sampled. Every money route is mounted behind `authMiddleware` in `index.ts`; the OpenAPI
docs 404 in production.

**Reports' degradation discipline.** `profitPerKm`, `kmPerLitre`, `revenuePerAvailableDayMinor`,
`behindByMinor`, `distributableMinor`, `loanInstalmentsDue` all return `null` rather than a
confident zero; `singleAggregateTotal` distinguishes "a real Rs 0" from "the query is broken";
the lost-day denominator is `ran + lost` in all three groupings with a `HAVING` clause that
drops an all-open bucket rather than rendering "0 / 0". CSV export carries RFC 4180 quoting plus
the CWE-1236 formula-injection guard.

**The schema's own guards.** The `assert_period_open()` trigger array is hand-maintained *and*
backed by `scripts/assert-no-trigger-drift.sql`, which CI runs against a from-scratch Neon
branch on every PR — `loan_payment` (migration 0032) correctly carries its trigger. All void
filters on money aggregates are present (checked every `SUM`/`reduce` site in `queries/`).
`integration.yml` provisions a throwaway branch per PR, applies all 34 migrations from scratch
(proving forward-only, not just the diff), runs the drift assertion, then the full integration
suite — so the golden fixtures genuinely gate merges.

---

## Suggested order

1. **H-4** (recovery receipt reverses an unrelated payment) — erases a real receipt, and the
   fix is contained.
2. **H-1** (write-off) — a live receivable can be wrong today; small fix.
3. **H-2** (off-road re-entry) — reachable by an ordinary correction.
4. **H-3** (mileage period range) — currently refusing legitimate readings, so it is probably
   already being worked around by hand.
5. **M-7** (corrected payment) — one-line filter change, and it moves UC-109's headline figure.
6. **M-1** — needs a DM §15 decision before code moves; open it now, since M-4 and the
   export/report reconciliation both hang off it.
7. **M-2, M-3, M-5, M-6, M-8, M-9, M-10** — each self-contained.
8. **L-1 … L-6** — one sitting.

Every item is stated as a defect in *this* build. The only one that is a disagreement with the
specification rather than with the code is **M-1**, flagged as a document question on purpose.
