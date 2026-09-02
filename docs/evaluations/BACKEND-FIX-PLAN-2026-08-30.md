# Backend fix plan — 30 August 2026

Closes the findings in `BACKEND-LOGIC-ACCURACY-REVIEW-2026-08-29.md` (20 findings, all re-verified) and
`BACKEND-LOGIC-VALIDATION-2026-08-30.md` (14 new findings, plus corrections to the first set). **34 findings, 16 pull
requests, 5 waves, 3 decisions that must land before any code.**

Two rules shape the ordering. **The owning document decides** — three findings are disagreements with the
specification, not the code, so they are decisions first and patches second. **Documents travel together** — four PRs
below change a document and its mechanics in the same change, because shipping half leaves the pair lying about each
other.

Conventions assumed throughout: feature branch → PR into `develop`, never a direct push; migrations hand-written,
numbered forward-only from **0035**; `npm run check` is the gate; never mock the database; every endpoint carries the
seven-case test set (happy · 401 missing · 401 verifier throws · 403 capability · 404 other business · 409 invariant ·
`PERIOD_CLOSED`), plus the linked-driver class wherever driver data is touched. **The golden fixtures must stay 39/39
with 134,000 / 15,000 / 7,500 unmoved** (`docs/engineering/fixtures/golden.py`, `docs/qa/scenarios/fixtures/`) — any
PR that moves one is wrong until proven otherwise.

Gap numbering: TRACKER.md is currently at **GAP-200**, so this work files **GAP-201 onward**.

---

## Wave 0 — decisions that gate code

None of these is a coding question. Each needs an owner's answer recorded in the owning document's
"what we did not take" section before the PR that depends on it can be written.

### D1 · What basis does UC-70 vehicle profit use?
**Gates:** M-1, M-4, and the shape of PR-1. **Owning doc:** `docs/engineering/data-model.md` DM §15.

`sumVehicleEarned*` counts `obligation.amount_minor` gross, ignoring `waived_minor`; `sumVehicleCosts*` ignores
`write_off` entirely. The code is faithful to DM §15's documented query — the document is what produces the wrong
number. Meanwhile UC-99's export *does* include `write_off`, `customer_contribution` and `insurance_settlement`, so
the year's CSV and the year's report are computed from different fact sets and cannot reconcile.

**Recommendation: net.** Subtract `waived_minor` from earned, add `write_off` to costs, and make the three report
families read one shared list of kinds. FL §5.73 already states the intent — *"the month shows the 340 charged and the
340 waived"* — and the export is already closer to that intent than the report is. The alternative (declare UC-70
gross-of-goodwill and change the export to match) is defensible but contradicts FL §5.73 as written.

### D2 · Can you write off part of an outstanding obligation?
**Gates:** H-1's full fix. **Owning doc:** `docs/product/use-cases.md` UC-90 + DM §10.1/§10.3.

Confirmed against the schema: `obligation` carries `amount_minor`, `settled_minor`, `waived_minor` and
`CHECK (settled_minor + waived_minor <= amount_minor)` — **there is no `written_off_minor`**, and `write_off` has **no
unique index on `obligation_id`** (only on `replaces_id`, migration 0025). So today a partial write-off flips the whole
obligation to `written_off` and a second write-off against the same obligation is accepted as well.

**Recommendation: yes, partial is a real business act** ("he'll never pay the last bit"), implemented as
`obligation.written_off_minor` mirroring how `waived_minor` already works, with the status flipping to `written_off`
only when `settled + waived + written_off >= amount`. **Ship the interim refusal first** (below) so nothing vanishes
silently while the column is designed.

### D3 · What happens when an off-road window is re-recorded?
**Gates:** H-2. **Owning doc:** `docs/product/user-flows.md` F-3.4 step 2.

**Recommendation: refuse, require the prior treatment be voided first.** W-61's *"undo what you did, in the order you
did it"* already governs this, `voidAdjustment` already exists as the undo path, and a refusal is far cheaper to get
right than a reversal-and-reapply cascade across an adjustment and a lease extension. The `rent_treatment` column
already records that a treatment was applied — nothing currently reads it, and this makes it load-bearing.

---

## Wave 1 — the cash figure

### PR-1 · `listPartnerCashPositions` counts every direction money moves
**Closes NH-1, NH-2, M-7.** No migration. **Highest value in the plan.**

All three are the same function and the same report; they conflict if split. `heldMinor` is currently
`received − banked − advanced`, which never sees money leaving the business.

`api/src/queries/reports.ts:1108-1174`:
- Change the `received` filter from `eq(payment.status, "active")` to `ne(payment.status, "reversed")` — `corrected`
  means "this much of it still counts", and `amount_minor` already holds that figure (M-7).
- Add a `direction = 'paid'` subquery, grouped by `handled_by_user_id`, same `ne(status, 'reversed')` filter —
  subtract it (NH-2). This is UC-50 "pay the driver", the routine weekly action.
- Add a `partner_payout` subquery, `voided_at IS NULL`, grouped by `user_id` — subtract it (NH-1).

`api/src/domain/credit-forward.ts:88`: same `active` → `<> reversed` change, so a corrected payment's surplus can
still settle a later due.

**One sub-decision inside this PR.** `partner_payout.kind` has three values and they are not equivalent:
`payout` is unambiguously cash leaving (subtract); `loan_on_behalf` needs a ruling on whose cash actually moved (the
loan is in an owner's name, and `domain/vehicle-loan.ts`'s comment reads as *he* paid the lender); `partner_settlement`
is two-sided but modelled as one row against one `user_id`, so subtracting it moves one partner's figure and never
credits the other. Decide all three explicitly rather than letting `SUM(*)` decide by default.

**Docs:** DM §15's UC-75 SQL gains both terms and the status correction.
**Tests:** a payout reduces `cashOnHandMinor` and `distributableMinor`; a driver payment reduces both; a corrected
payment counts at its remaining amount; a voided payout does not reduce. Then confirm the three existing
distributable-cash tests (`api/tests/integration/reports.test.ts:1006+`, asserting 58000/50000, 200000/160000, and the
null-degrade) **pass unchanged** — none involves a payout or a `paid` payment, so any movement there means the change
overreached.
**Risk:** reported cash goes *down*, which is the safe direction (it currently overstates). Flag to the owner as a
visible change on a live report before merging.

---

## Wave 2 — money attributed to the wrong record

### PR-2 · Incident recovery lifecycle
**Closes H-4 (interim), NM-4.** No migration.

- `api/src/domain/incident.ts:443-453` — replace the "void every allocation on the obligation, then
  `markPaymentReversed` the parent" loop with the `unwindObligationAllocations` shape from
  `api/src/domain/adjustment.ts:262-292`: void or reduce the allocation, **never touch the parent payment row**. The
  two call sites of the same query currently differ by exactly one line, which is why this reads as an oversight.
- `api/src/domain/incident.ts:521-563` — move the `findIncidentRecoveryForBusiness` read and the
  `receivedAmountMinor > 0` check inside the transaction, against a `FOR UPDATE` row. This is the same race already
  fixed in `voidObligation` (GAP-178/B12) and `voidWriteOff` (GAP-190/B12).

**Tests:** correcting a recovery amount for a customer carrying credit-forward must leave the older, unrelated payment
`active`; a concurrent void-vs-receive must not leave a live `payment_allocation` pointing at a voided obligation.

### PR-3 · Incident recovery payment provenance
**Completes H-4.** Migration **0035**.

`incident_recovery` has no `payment_id` column (checked through 0034), so true provenance needs one — mirroring
`write_off_recovery.payment_id`, which `voidWriteOffRecovery` already uses correctly. Reverse only the payment this
path minted.

### PR-4 · Write-off correctness
**Closes H-1 (interim).** Migration **0036**.

- `api/src/domain/write-off.ts:82-85`, in the transaction after the locked read: require
  `amountMinor === amount − settled − waived`, else 400. Refusing a partial is deliberate and temporary — D2 decides
  the real shape, and a refusal is strictly better than 40,000 of receivable vanishing with no row recording it.
- Compare the obligation's party against the request's `partyCustomerId`/`partyDriverId`, else 400. The handler
  currently checks that all four ids exist in this business but never that they refer to each other.
- Migration: partial unique index on `write_off (obligation_id) WHERE voided_at IS NULL` — idempotency in the
  constraint, per CLAUDE.md, not an application pre-check.

### PR-5 · Partial write-offs
**Completes H-1, after D2.** Migration **0037**.

`obligation.written_off_minor` (default 0), the `CHECK` replaced with
`settled_minor + waived_minor + written_off_minor <= amount_minor` (every existing row passes — the same
drop-and-add pattern migrations 0009/0014/0033 already use), `computeObligationStatus` extended, and **every read that
computes outstanding** updated: `queries/obligation.ts`, `queries/reports.ts`'s receivables and ageing,
`domain/party-archive.ts`, `domain/lease-closure.ts`. W-28 still holds — a waiver and a write-off never share a bucket.

### PR-6 · Off-road re-entry
**Closes H-2, after D3.** No migration.

`api/src/domain/incident.ts:116-207` — refuse a second `recordOffRoad` while a live treatment exists, reading the
`rent_treatment` column that currently nothing reads, and point the manager at the void path. Applies to both the
`credit_days` adjustment and the `extend` lease-extension branch (`lease_extension` has no unique constraint on
`incident_id` either).
**Tests:** repeated submission of each treatment — `api/tests/integration/incident.test.ts` currently covers each
treatment exactly once, so this failure mode has never been exercised.

### PR-7 · Mileage period selection
**Closes H-3.** No migration.

`api/src/queries/billing-period.ts:126-146` — replace the fully-contained predicate
(`periodStart >= from AND periodEnd <= to`) with an overlap predicate (`periodStart <= to AND periodEnd >= from`),
excluding periods a live assessment already closed out (`mileage_assessment` / `mileage_assessment_split` already
record which). The combined-allowance arithmetic and the day-weighted `splitInteger` apportionment both become correct
for free once the period set is right.
**Tests:** the 12 Jan → 14 Feb → 12 Mar → 12 Apr sequence, asserting the reading is *accepted* (it is currently
refused) and that `isEstimated` is `true` for the combined case (it is currently `false`).
**File as a gap, do not fix here:** F-2.3's *"prior provisional assessments are reconciled, not rewritten"* is
unimplemented — `assessMileage` writes `"final"` unconditionally and nothing in `api/src` ever writes `provisional`
or `superseded`. The enum makes it look implemented.

---

## Wave 3 — refused legitimate actions, and attribution integrity

### PR-8 · Ownership-share re-split
**Closes NM-1.** No migration.

`domain/partner.ts`'s `setOwnershipShares` must close the prior open row(s) for any repeated `user_id` before
inserting — the `changeDailyLeaseRate` / `changeVehicleArrangement` shape, which every other date-ranged table in this
schema already uses — and catch the `EXCLUDE` violation (`23P01`) by name, mapping it to a 400. Today INV-16's own
worked example (*"last year's split changes when someone buys in"*) reaches the generic handler as a raw 500.
**Tests:** a buy-in where an existing owner's share is *reduced* rather than removed. `TRACKER.md:792`'s existing
claim only covers a fully disjoint owner set.

### PR-9 · Expense actor integrity
**Closes NM-5.** No migration.

`api/src/handlers/expense.ts:55-92` — validate `body.paidByUserId` against `findBusinessMemberUserId`, exactly as
`recordPaymentHandler` now does for a partner party (GAP-93 fixed this identical class and did not reach here).
`api/src/domain/expense.ts:189` — stop writing `createdBy: input.paidByUserId`; pass the real authenticated actor as
its own field, so a record can never appear to have been entered by someone who did not enter it.

### PR-10 · Archive guards
**Closes NM-2, NM-3 (GAP-187).** Migration **0038**.

Migration 0031's `archive_guarded_party_column` view derives membership from a catalogue scan but requires a *direct*
FK to `driver`/`customer`, so it structurally cannot see either of these:
- `adjustment` reaches its party only through `obligation_id` — needs a trigger resolving the party via that join
  (with the same `replaces_id` exemption 0031 gives every other guarded table).
- `deposit` carries the party columns directly but has no `posted_period_id`, so the catalogue loop never finds it —
  needs the existing `assert_party_not_archived()` attached by hand.

### PR-11 · Management fee reads the obligations that exist
**Closes M-4, after D1.** No migration.

`domain/partner.ts:565-572` replays `monthlyAmountMinor` in memory for every historical period, on a different
effective-date basis (`periodEnd`) than the generator that actually writes the rows (`periodStart`), and counts
periods for which no obligation was ever generated — the fee is *created* on the partner's side without ever being
subtracted on the vehicle's. Read the real `management_fee` obligations (they carry `posted_period_id`,
`party_user_id`, `voided_at`). `queries/partner.ts:621-635` flags this in its own comment as "a real question for
whoever revisits it" — this is that revisit.

### PR-12 · Report basis
**Closes M-1, after D1.** No migration.

Implements whichever basis D1 records, across `sumVehicleEarned*` / `sumVehicleCosts*` /
`listTransactionsForDateRange`, reading one shared list of kinds so the report and the export cannot drift again.
**Land last among the `queries/reports.ts` PRs** — it is the largest change to that file.

---

## Wave 4 — the self-contained set

Each is independent; any order. Grouped into four PRs by file affinity.

### PR-13 · Determinism and tenancy scope
**Closes M-6, NL-3, NL-2, L-2 (residual).**
- `queries/obligation.ts:398,449,791` — `.orderBy(asc(obligation.dueOn), asc(obligation.id))`. Ids are UUIDv7, so
  this is insertion order, matching the `findOwnershipSharesAsOfBulk` precedent at `queries/reports.ts:808`.
- `queries/vehicle-loan.ts:229,242` — same tie-break on `paidOn`.
- `queries/vehicle-loan.ts:234-244` — add the `businessId` filter its sibling three lines above already has.
- `queries/lease.ts:70-90` — add `business_id` to `updateLeaseTerms`' `WHERE`, plus the five siblings PR #144 left in
  place (`changeVehicleArrangement`, `changeVehicleServiceInterval`, `archiveDriverRow`, `unarchiveCustomerRow`).
  Defence-in-depth only — every caller checks tenancy first — but this is the pattern that fix established.

### PR-14 · Correction and idempotency fixes
**Closes M-2, M-3, M-8, M-10.**
- `domain/billing-period.ts:145-153` — thread the colliding `seq` out of `generateNextBillingPeriodTx` into the catch.
  **Do not** use `latest.seq` directly: `rollDueBillingPeriods` can commit several periods in one run, so the latest is
  not reliably the one that collided.
- `domain/lease-closure.ts:134-152` — `agreed_discount`, not `goodwill`, for `days_used` (charging for days actually
  used is a contractual entitlement, not a gift, and it currently inflates UC-77's annual total, the one number that
  report exists to produce). Compute `reduceBy` from the obligation's current `amount_minor`, not the period's
  `rentAmountMinor` — otherwise it compounds with H-2 on the same obligation.
- `schemas/adjustment.ts` + `handlers/adjustment.ts:58` — add `occurredOn` (optional, defaulting to today) and pass it
  through; the domain function already takes it. Migration 0017 added the column for exactly this, and pinning it to
  today put UC-77 back on the defect GAP-73 was fixing.
- `handlers/deposit.ts:37-75` — refuse a second `taken` deposit while one is `held`, directing the manager to the
  top-up movement (closer to DM §10.4's one-deposit-per-party-per-lease shape than summing in the driver's view).

### PR-15 · Query efficiency
**Closes L-3.** One grouped query replacing the per-deposit fan-out at all three sites: `queries/reports.ts:1250-1262`
(inside both `getCashPositionReport` and `getDistributableCashReport`), `queries/home.ts:65-72`, and
`domain/party-archive.ts:78-80`. GAP-145 was this exact shape and surfaced as a live 500 at 79 subrequests against a
ceiling of 50.

### PR-16 · Trip fuel `borne_by`
**Closes L-5.** `queries/expense.ts:294-302` — `sumTripFuelLitres` gains the `borne_by = 'us'` filter its sibling
`sumTripCostsByCategory` has, so `closeTrip`'s `kmPerLitre` cannot divide by litres the driver paid for (UC-72/W-20:
*"only fuel you bought"*).

---

## Wave 5 — validation hardening and housekeeping

### PR-17 · Schema-layer hardening
**Closes L-1, NL-1, M-9, NM-6, L-4.** Migration **0039**.
- `schemas/common.ts:12-16` — tighten `moneyWireSchema`'s regex to the wire grammar `money.ts` already defines
  (`/^(?!-0+$)-?\d+$/`), so `"-0"` is a 400 from zod rather than a `TypeError` escaping `safeParse` into a 500.
- `dates.ts:41-46` — validate real calendar validity in `asBusinessDate` (re-derive via `Date.UTC` and compare, the
  technique `addCalendarMonths` already uses), so `"2026-02-30"` is a 400 rather than a Postgres `22008` reaching the
  generic handler as a 500. Add `22008` to `db/pg-error.ts` regardless, as defence in depth.
- A shared `notFutureBusinessDate` refinement on the money-date fields (M-9) — the same shape
  `positiveMoneyWireSchema` took for GAP-177/B21. The business timezone's today is already available at every handler
  via `requireBusinessTimezone`.
- `schemas/lease-billing.ts:73` — `renewLease`'s `rentAmountMinor` to `positiveMoneyWireSchema`, matching
  `startLease`'s deliberate GAP-177 choice.
- Migration: `CHECK (purchase_cost_minor IS NULL OR purchase_cost_minor >= 0)` on `vehicle` — the last money column in
  the schema admitting a negative. `confirmDay`'s zero-passes gap is closed by the `positiveMoneyWireSchema` sweep
  above.

### PR-18 · Comment and consistency corrections
**Closes L-6, M-5 (downgraded to L), NL-4, NL-6.**
- The four stale comments: `auth/policy.ts:26-30` (reports are no longer uniformly business-wide),
  `domain/opening-balance.ts:265` (`sumDepositMovements` does filter `voided_at`), `db/pg-error.ts` (B18's
  message-substring `P0001` disambiguation is still open — keep the finding, correct the framing),
  `queries/identity.ts:90` (an archived linked driver keeps `viewOwnData` — decide deliberately rather than leave it
  an unstated consequence).
- `domain/day-card-generation.ts:176-195` — report rate-gap dates through the existing
  `unrestorableDayRecordDates` channel. Latent, not live: `changeDailyLeaseRate` is gapless inside one transaction, so
  the gap is currently unreachable — worth closing cheaply before a second writer of `effective_to` appears.
- `handlers/session.ts:20-34` — wrap the first-ever `insertAppUser` in a transaction.
- Migration 0033's `-- allow: widening a CHECK is additive` label describes a narrowing change; correct the comment
  the next time that file's neighbourhood is touched, never in a migration of its own.

### PR-19 · Nested-resource URL uniformity
**Closes NL-5.** A deliberate pass making the parent-segment check uniform across
`/{id}/settlement/{settlementId}/void`-shaped routes — `vehicle-loan.ts`, `vehicle.ts` and `dailyLease.ts` verify the
child belongs to the URL's named parent; `advance.ts`, `deposit.ts`, `write-off.ts` and `incident.ts` do not. Not
exploitable today (all are `businessId`-scoped), but the URL's parent segment is currently decorative on half of one
shape.

---

## Sequencing and conflicts

**`api/src/queries/reports.ts` is touched by four PRs.** Land them in this order to avoid rebases: **PR-1** (cash),
then **PR-15** (N+1), then **PR-11** (management fee), then **PR-12** (report basis, the largest).

**`api/src/domain/incident.ts` is touched by three:** **PR-2**, then **PR-3**, then **PR-6**.

**Migrations are strictly sequential** — 0035 (PR-3), 0036 (PR-4), 0037 (PR-5), 0038 (PR-10), 0039 (PR-17). If any PR
lands out of order, renumber before merge; CI applies all migrations from scratch on a throwaway Neon branch, so a
collision fails loudly rather than silently.

**Blocked until a decision lands:** PR-5 (D2), PR-6 (D3), PR-11 and PR-12 (D1).

---

## Summary

| PR | Closes | Migration | Doc change | Blocked by |
|---|---|---|---|---|
| 1 | NH-1, NH-2, M-7 | — | DM §15 | — |
| 2 | H-4 (interim), NM-4 | — | — | — |
| 3 | H-4 (complete) | 0035 | — | — |
| 4 | H-1 (interim) | 0036 | — | — |
| 5 | H-1 (complete) | 0037 | UC-90, DM §10 | D2 |
| 6 | H-2 | — | FL §3.4 | D3 |
| 7 | H-3 | — | — | — |
| 8 | NM-1 | — | — | — |
| 9 | NM-5 | — | — | — |
| 10 | NM-2, NM-3 | 0038 | — | — |
| 11 | M-4 | — | — | D1 |
| 12 | M-1 | — | DM §15 | D1 |
| 13 | M-6, NL-2, NL-3, L-2 | — | — | — |
| 14 | M-2, M-3, M-8, M-10 | — | — | — |
| 15 | L-3 | — | — | — |
| 16 | L-5 | — | — | — |
| 17 | L-1, L-4, M-9, NL-1, NM-6 | 0039 | — | — |
| 18 | L-6, M-5, NL-4, NL-6 | — | — | — |
| 19 | NL-5 | — | — | — |

**Suggested first sitting:** D1/D2/D3 raised with the owner, then PR-1 and PR-2 — the two highest-value changes, both
migration-free and independently revertable.
