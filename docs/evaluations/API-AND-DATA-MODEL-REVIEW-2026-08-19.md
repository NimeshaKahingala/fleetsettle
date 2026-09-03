# API and data-model review — 19 August 2026

One coherent logical review of the backend (`api/src/**`, `api/migrations/**`,
`packages/shared/src/**`), run against `develop` (`b5be091`), following the
method in the approved plan: read the owning doc section, read the full
vertical (route-def → handler → domain → query → migration), apply the
invariant checklist, check test coverage. Source-and-docs only — no
`api/.dev.vars` exists, so the integration suite and golden fixtures were not
run; every claim below is a static read, not a live result.

Findings are ranked most severe first within each slice. `CONFIRMED` means the
code path was read end to end and the defect is demonstrable from source.
`PLAUSIBLE` means the flow is unusual or the invariant is only probably
broken. Every finding was checked against TRACKER.md's 52 open gaps first;
one that restates a known gap is logged as a cross-reference, not counted as
new.

---

## Slice A — Tenancy, auth, access control

**Scope read:** `auth/{context,verify,policy,jwks}.ts`,
`middleware/{auth,platform-admin,rate-limit}.ts`, `domain/{membership,
platform-admin,business-creation,setup}.ts`, `queries/{identity,business,
business-member,driver-link-invite}.ts`, `queries/platform/{platform-admin,
business-creation-request}.ts`, handlers `session`/`me`/`business`/
`business-member`/`invite`/`admin`/`driver-view`/`driver` (link/unlink),
migrations `0029` (drops `one_active_business_per_user`, adds
`driver_linked_user_per_business`) and `0030` (`platform_admin`,
`business_creation_request`, `platform_audit_log`, `assert_platform_has_admin()`),
`index.ts` route mounting, `errors/{app-error,handler}.ts`,
`scripts/check-forbidden.mjs`'s tenancy and platform-import rules, IG §7
(`Auth`) in full.

Chosen first because it is both the security spine (CLAUDE.md → Tenancy) and
the newest code in the tree — `0029`/`0030` and the five-step header rule
landed 18 August, one day before this review.

### Passes

- **The five-step header rule (IG §7.5) is implemented exactly as specified.**
  `authMiddleware` (`middleware/auth.ts:21-63`) resolves `sub` → memberships
  from the database only, never the token; a present `X-Business-Id` is
  matched against that resolved set (404 on no match, never 403); an absent
  header with exactly one membership is used unremarked; an absent header
  with more than one throws `BUSINESS_NOT_SELECTED`; `businessId` is always
  assigned from the matched row, never the header string. `check-forbidden.mjs`'s
  `tenancy/from-header` rule backs this with a structural check that only
  `middleware/auth.ts` may read the header at all.
- **`resolveMemberships` (`queries/identity.ts:62-122`) correctly implements
  the `UNION ALL`-not-`OR`-join fix it documents**, including the harder edge
  case: an identity that is both a `business_member` and a linked `driver` of
  the *same* business (the two-car-and-a-bus owner who also drives one of
  them) is deduplicated to one `Membership` row, deterministically preferring
  the `business_member` shape regardless of which row the union returns
  first — traced through both insertion orders by hand, both converge
  correctly.
- **Cross-tenant is 404 everywhere checked in this slice**, never 403:
  `revokeBusinessMember`, `changeBusinessMemberRole`
  (`domain/membership.ts:75-135`, scoped through
  `findActiveBusinessMemberForBusiness`), `unlinkDriverHandler`
  (`handlers/driver.ts:182-193`, scoped through `findDriverForBusiness`),
  `platformAdminMiddleware` for a non-admin (`middleware/platform-admin.ts:30`).
- **The platform tier's structural boundary (IG §7.6, INV-38) holds.**
  `/api/admin/*` mounts `platformAdminMiddleware` alone — `index.ts:92-97`'s
  own comment confirms no route composes it with `authMiddleware`, and no
  such composition exists anywhere in `index.ts`. `check-forbidden.mjs`'s
  `checkPlatformQueryImports` enforces the allowlist
  (`business`/`businessSettings`/`accountingPeriod`/`appUser`/`platformAdmin`/
  `businessCreationRequest`/`platformAuditLog`/`businessMember`/
  `businessMemberInvite`) on every file under `queries/platform/`, and both
  files actually under that directory (`platform-admin.ts`,
  `business-creation-request.ts`) import only from that list.
- **The three known check-then-act races (`requestOrCreateBusiness`'s
  count-then-decide, `claimRequestForApproval`/`claimRequestForRejection`'s
  now-fixed claim) are exactly as documented** — the claim functions use a
  conditional `UPDATE … WHERE status = 'pending' … RETURNING`, not a
  pre-read, closing the race the two PR-review comments (#73, #74) describe
  fixing; only the allowance count-then-create race remains, and it is
  recorded as accepted, not hidden.
- **`upsertPlatformAdmin`'s `ON CONFLICT … WHERE revoked_at IS NOT NULL` guard**
  correctly prevents a no-op re-grant of an already-active admin from firing
  `platform_admin_audit`'s `AFTER UPDATE` trigger a second time — verified by
  tracing the SQL: an already-active row fails the partial `WHERE`, so
  `ON CONFLICT` degrades to no row touched at all.
- **`assert_business_has_owner()`/`assert_platform_has_admin()` are genuinely
  the only backstop** for the last-owner and last-admin cases — the domain
  layer never pre-checks either count; both catch the DB exception. Traced
  `changeBusinessMemberRole`'s revoke-then-insert sequence against the
  deferred trigger: a self-demotion that would leave zero owners is caught at
  commit, after both writes, correctly rolling back the whole transaction.
- **The invite mechanism (W-57) does not leak which failure mode occurred** —
  `redeemInvite` (`domain/membership.ts:189-275`) throws the identical
  `InviteCodeInvalidError` whether a code never existed, expired, or was
  already redeemed, for both the business-member and driver-link destinations.
- **Attachment reads (`handlers/attachment.ts`) re-check `businessId` and the
  subject's own capability on every request**, never serve from a
  cached/presigned URL, and log row/object metadata only outside production
  with an explicit, reasoned `eslint-disable` — consistent with api/CLAUDE.md's
  "no console.*" rule, which both occurrences in this slice (`attachment.ts`,
  `scheduled.ts`) opt out of correctly rather than violate silently.

### Findings

No `CONFIRMED` or `PLAUSIBLE` findings in this slice. This is recorded
explicitly, per the plan's own reasoning, so a later reader can tell "reviewed
and found sound" apart from "not yet reached."

### Not independently re-verified (noted, not a finding)

- The `countActiveOwnerMemberships` check-then-create race in
  `requestOrCreateBusiness` and the `business_id`-not-yet-set window in
  `claimRequestForApproval` are both already recorded in source as accepted
  trade-offs with a named fix if ever needed (`SERIALIZABLE` + retry). Not
  re-litigated here — re-argued only far enough to confirm the trade-off is
  real and bounded (this product's actual concurrency), not to relitigate the
  decision.
- Whether every one of the 163 route-defs correctly pairs its documented 403
  response with a `requireCapability` call was spot-checked by file-level
  tally (`requireCapability` count vs. `requireBusinessId` count per handler
  file) rather than read line by line for all 33 handler files; `admin.ts`,
  `business.ts`, `invite.ts`, `session.ts`, `me.ts` correctly show zero
  `requireCapability` calls because each is gated by which middleware it
  mounts behind, not a capability check — confirmed by reading all five in
  full. The remaining 28 handler files were not read in full in this slice;
  Slices C–E's per-domain review is where their own capability gates get
  checked as part of the vertical read.

---

## Slice B — Period close and the append-only spine

**Scope read:** `domain/{accounting-period,post-closure-charge}.ts`,
`queries/accounting-period.ts`, `domain/deposit.ts`'s void path,
`queries/driver-money.ts`'s sum/status functions, `domain/obligation.ts`,
migrations `0001` (trigger array + attach), `0006`, `0008` (period-open
evolution), `0013`, `0014`, `0018`, `0019` (deliberate exclusions from the
trigger array), DM §13 in full, `GAP-12-VOID-CASCADE-DESIGN.md`,
`api/scripts/{assert-no-trigger-drift.sql,check-drift.mjs}`,
`.github/workflows/integration.yml`.

### Passes

- **The `assert_period_open()` trigger array is not currently drifted.**
  Checked directly rather than assumed: every table in migration 0001's
  19-entry `FOREACH` array matches DM §13's own documented array exactly
  (including `trip`, whose earlier omission DM §13 records as already found
  and fixed on 18 August). Every table created by a *later* migration that
  might plausibly need `posted_period_id` was checked individually —
  `opening_balance_posting` (0014), `lease_day_exception` (0018),
  `vehicle_unavailability` (0019) — and each carries a specific, correct
  argument for why it holds no `amount_minor` and states no fact of its own,
  so exclusion is right, not an oversight.
- **The drift check is genuinely wired into CI**, not merely aspirational:
  `.github/workflows/integration.yml`'s "DM §13 drift check" step runs
  `npm run check:drift -w @fleetsettle/api` (`api/scripts/check-drift.mjs`,
  which executes `assert-no-trigger-drift.sql` against the freshly-migrated
  ephemeral branch and exits 1 on any row) on every PR, after applying every
  migration from scratch and before the integration suite runs. IG §16.1's
  claim that trigger-array drift is "caught by … SQL assertion … DM §13,
  integration job" is accurate.
- **The void-cascade design's most concrete claims were verified as actually
  shipped, not just documented as intended.** `GAP-12-VOID-CASCADE-DESIGN.md`
  §3.2–§3.5 describes specific bugs found while building the nine remaining
  void endpoints (`offset_allocation` missing the void trio entirely;
  `sumDepositMovements` and `sumSettledForAdvance` both ignoring
  `voided_at`, the second of which the doc calls out as unwinding INV-17's
  trip-close protection — "the trip closes while the driver still holds the
  cash"). All three are fixed in the current code:
  `queries/driver-money.ts:207` (`sumSettledForAdvance`) and `:499`
  (`sumDepositMovements`) both filter `isNull(…voidedAt)`, and
  `domain/deposit.ts:281-333` (`voidDepositMovement`) recomputes
  `deposit.status` exactly as designed (newest live terminal movement wins;
  falling back to `hold_window`/`held` by `hold_release_date`) and separately
  reverses an `applied` movement's own obligation settlement before voiding
  the movement row, closing the GAP-6 follow-up double-count the same
  comment names.
- **`closeAccountingPeriod` correctly closes and opens the successor in one
  transaction** (`domain/accounting-period.ts:57-96`), including generating
  the new period's management-fee obligations inline rather than waiting for
  the next cron tick — consistent with "no cron is a prerequisite for a user
  action."
- **`voidObligation`'s allowlist (`DIRECTLY_VOIDABLE_KINDS = {'post_closure_charge'}`)
  is consistent with the governing cascade principle**: every other
  obligation kind is derived from a source row (billing period, day record,
  trip, incident) and must be corrected there, and the function's
  `findLiveBlockersForObligation` refuse-and-name pattern matches the
  documented "cascade into rows minted by the same call, refuse when
  separately-entered actions sit beneath" rule.

### Findings

**REV-2026-08-19-01 — `api/scripts/assert-no-trigger-drift.sql`'s own header
comment is stale and asserts something no longer true**

- File: `api/scripts/assert-no-trigger-drift.sql:11-12`
- Confidence: `CONFIRMED`
- Invariant: none broken — this is a documentation-accuracy defect, not a
  behavioral one. Flagged because a stale comment on the one check that
  exists specifically to catch silent drift undermines trust in that check
  the next time someone reads it before running it.
- The comment reads: *"Three tables were missing at one point. A fourth —
  `trip` — is missing today and is reported by this query rather than
  assumed away."* This describes a past state as present tense. DM §13 itself
  documents the correction: *"Corrected 18 Aug 2026 … `trip` has both
  triggers live … but was missing from the array immediately above, silently
  … Added back above."* Migration 0001's actual `FOREACH` array (verified by
  direct read, `api/migrations/0001_initial_schema.sql:944-965`) already
  includes `trip`, and its own inline comment explains why `trip`'s
  `posted_period_id` is nullable rather than `NOT NULL` — this is the fixed
  state, not the state the script's header still describes.
- Failure scenario: a developer investigating why the drift check flagged (or
  didn't flag) something reads this script's header first, since it is the
  shorter of the two places the rule is documented. They read "trip is
  missing today," go looking for a problem that isn't there, or worse,
  conclude the check itself is unreliable ("it still says trip is missing but
  the query returns clean") and stop trusting it — the one check that exists
  precisely because CLAUDE.md records this list "has drifted once already."
- Suggested owner: doc fix — delete or update the stale sentence in the
  script's own header to match DM §13's corrected account, in the same PR
  that touches this file next.

---

## Slice C — The three arrangements (in progress)

**Scope read so far:** `domain/trip.ts` (in full, 965 lines — `bookTrip`,
`confirmTripHold`, `closeTrip`, `cancelTrip`, `restoreDailyLeaseOccupancy`,
`releaseAllExpiredHolds`), `domain/confirmDay.ts` (in full),
`domain/day-card-generation.ts` (in full), `queries/trip.ts`'s hold/allocation
functions, `domain/dailyLease.ts`'s `startDailyLease`, migration `0020`
(trip hold expiry). Chosen first because `develop`'s five most recent commits
touching backend code all touch trip hold/in_progress handling
(`848e831`…`5e832c7`), making this the least-settled money path in the tree.

### Findings

**REV-2026-08-19-02 — A hold or a cancelled trip whose date range began before
the release/cancel date permanently loses daily-lease day records for the
already-elapsed portion of that range**

- Files: `api/src/domain/trip.ts:789-803` (`restoreDailyLeaseOccupancy`),
  called from `bookTrip` (`:354`), `cancelTrip` (`:921-925`), and
  `releaseAllExpiredHolds` (`:961`, the nightly cron); also
  `api/src/domain/dailyLease.ts:92` (`startDailyLease`) and
  `api/src/domain/lease.ts:59` (`startLease`) — five call sites in total,
  all sharing the one helper and its one `today`-forward-only fill.
- Confidence: `CONFIRMED`
- Invariant: none of CLAUDE.md's named rules by citation, but squarely the
  general principle behind GAP-3 and the "lost-day denominator" rule — a real
  day the business is owed money for silently never gets an obligation raised
  for it, permanently, with no report or checklist ever surfacing the gap
  (there is no row to be "unconfirmed" — the row is never created at all).
- Mechanism: `restoreDailyLeaseOccupancy(tx, vehicles, today)` calls
  `materializeDailyLeaseHorizon(tx, …, today)`, which fills the daily lease's
  `vehicle_day_allocation`/`day_record` rows starting **only from `today`
  forward** (`day-card-generation.ts:117`: `for (let d = today; d <= rangeEnd; …)`).
  But the trip/hold rows this function is cleaning up after are voided across
  their **entire own date range**, with no lower bound at `today`:
  `releaseExpiredHolds` (`queries/trip.ts:157-166`) voids every
  `vehicle_day_allocation` row for the expiring trip's `sourceId`, regardless
  of date, and `deleteAllocationDaysForTrip` (`queries/trip.ts:53-68`, called
  by `cancelTrip`) does the same for a cancelled trip. Whenever a trip or
  hold's own `startDate` precedes the date its allocation is actually
  released — which is the ordinary case, not an edge case, for any hold that
  is abandoned rather than confirmed, or any multi-day charter cancelled
  after it has already begun — the dates between that `startDate` and
  `today` are freed from the trip but never re-claimed by the daily lease
  that should still own them. No `vehicle_day_allocation` (arrangement B) row
  and no `day_record` is ever created for those dates by any other path:
  `generateDayCards`'s own nightly pass (`day-card-generation.ts:174-255`)
  is equally forward-only from its own `today` argument, so no future run
  ever reconsiders a past date either.
- One of the two call sites already documents the exact mechanism without
  resolving it: `dailyLease.ts:87-91`'s own comment reads *"undo any calendar
  hole the just-released hold(s) left … the horizon materialised below only
  ever fills forward from `input.today`, so a hold whose dates fell before
  today is not otherwise re-covered."* That comment is accurate and is the
  clearest evidence this is a known mechanism, not a misreading of the code
  on this review's part — but it appears once, at the one call site where the
  gap happens not to matter (a *new* daily lease is about to be materialized
  from `today` forward regardless, superseding whatever the old one would
  have owned). The identical limitation is silent at the other three call
  sites — `bookTrip`, `cancelTrip`, and the nightly `releaseAllExpiredHolds`
  — where there is no new arrangement about to paper over it, and where the
  gap is the whole of the consequence, not an aside.
- Failure scenario: a vehicle is on an active daily lease. A manager books a
  hold on it for a two-day charter starting tomorrow (a same-week enquiry is
  the ordinary case a hold exists for, per F-5.1). The enquiry falls through
  and nobody confirms or cancels the hold. Seven days later (the default
  `holdExpiryDays`, `businessSettings.holdExpiryDays` per migration 0020),
  either the nightly cron or the next booking attempt on that vehicle calls
  `releaseExpiredHolds`, which correctly frees the two days back to the
  daily lease's occupancy — but `restoreDailyLeaseOccupancy` only
  re-materializes from today (day 7) forward. The two days the hold
  originally claimed (days 1–2, now in the past but still inside the
  currently open accounting period) get no `vehicle_day_allocation` row and
  no `day_record`, ever. The driver's daily fee for those two days is never
  raised as an obligation — not underpaid, not marked lost, simply absent —
  and nothing in `buildCloseChecklist`'s "unconfirmed days" count or any
  report would ever flag it, because there is no row for either to notice
  the absence of. Multiplied across every hold placed on a daily-lease
  vehicle and later abandoned, this is a quiet, structural leak in exactly
  the number CLAUDE.md names first: "a number that is wrong, plausible, and
  not noticed until someone argues about it months later" — except here the
  number does not even appear as wrong; it simply never appears.
- Not covered by any existing test: `api/tests/integration/trip.test.ts` and
  `dailyLease.test.ts` contain no case exercising a hold or cancellation whose
  own date range precedes the release date (checked by grep for
  `restoreDailyLeaseOccupancy`/`calendar hole`/`before today` — no matches in
  either file).
- Suggested owner: code fix, cross-referenced against GAP-7 (which this
  extends rather than duplicates — GAP-7's own fix closed the *forward*
  calendar hole this same commit describes; this is the *backward* half of
  the identical mechanism, left open). `restoreDailyLeaseOccupancy` should
  fill from `min(today, earliest date actually freed)` rather than from
  `today` unconditionally — the freed range is already known at both call
  sites that matter (`releaseExpiredHolds`'s own `expired` rows carry the
  trip's dates before they're voided; `cancelTrip` already holds `trip.startDate`).

### Passes

- **`startLease` (`domain/lease.ts:49-131`) is the fifth call site sharing
  REV-2026-08-19-02's helper**, confirmed for completeness while tracing
  every caller of `restoreDailyLeaseOccupancy` — the finding above already
  accounts for it and this did not surface anything additional beyond it.
- **`applyCreditForward` (`domain/credit-forward.ts`) correctly serialises on
  the payment rows it draws credit from** (`FOR UPDATE`, oldest-`occurredOn`-
  first), correctly distinguishes `alreadySettledMinor` (a same-transaction
  cash figure, e.g. `confirmDay`'s spot payment) from the credit it is about
  to draw so the two never double-count, and correctly enforces
  `received`/`paid` direction matching so a customer's credit can never
  settle a driver's obligation or vice versa.
- **`generateNextBillingPeriodTx`/`rollDueBillingPeriods` (`domain/billing-
  period.ts`) compute each period's boundaries from the lease's own anchor
  date via `addCalendarMonths`, never chained off the previous period's
  end** — exactly W-40's "reproducible arithmetic rather than accumulated
  drift" — and the catch-up loop is bounded at 24 iterations with per-lease
  errors collected rather than aborting the whole cron run.
- **`assessMileage` (`domain/mileage.ts`) correctly derives which billing
  period(s) a reading closes from the date range since the previous reading,
  never from caller input**, and handles the missing-boundary-reading case
  (multiple periods combined against their summed allowance) in the
  direction W-25 requires — mileage is one-directional, so combining periods
  can only ever raise the assessed excess, never lower it below what two
  separate readings would have produced. Idempotency on `(lease_id,
  read_on)` is checked up front, with a documented reason for not relying
  on the unique-violation catch alone (a genuine replay is by then the
  *latest* reading, and computing "driven since previous" from itself would
  produce a nonsensical zero-period assessment).

---

## Slice D — Cash and balances

**Scope read:** `domain/{payment,payment-correction,offset}.ts` in full,
`queries/{obligation,payment}.ts`'s allocation-ordering functions. Deposit
and advance void/status-recompute paths were already read as part of Slice
B's void-cascade verification (`domain/deposit.ts`, `queries/driver-money.ts`)
and are not re-read here.

### Passes

- **`allocateAgainstOldest` (both `payment.ts` and `offset.ts`, independently
  implemented) correctly locks candidate obligations `FOR UPDATE`, filters
  to `status IN ('pending','part_paid')` and `voided_at IS NULL`, and orders
  strictly by `due_on` ascending** (`queries/obligation.ts:326-364`) —
  matching §6.5's "oldest first" rule in both money directions.
- **`createOffset` (INV-3/W-2) moves both of a driver's balances by the same
  `amountMinor`, each independently allocated oldest-first, and validates
  the amount against *both* outstanding balances before writing anything** —
  a partial offset cannot overdraw either side. `voidOffset` unwinds both
  sides symmetrically, in the same order (allocations reversed and
  recomputed before the parent record voids), matching the governing
  cascade principle from `GAP-12-VOID-CASCADE-DESIGN.md` §2.
- **`correctPayment` (F-8.2/UC-93) correctly distinguishes the two `bearer`
  choices**: `back_to_arrears` unwinds allocations newest-first
  (`findPaymentAllocationsForPayment` orders `desc(id)` — a legitimate
  proxy for insertion order, since ids are UUIDv7 and therefore
  time-sortable, and the table carries no separate allocation timestamp to
  order by instead) and reverses each touched obligation's `settled_minor`;
  `absorbed_loss` touches no obligation at all, leaving the party's due
  settled exactly as it was. `payment.amount_minor`'s own `CHECK (> 0)`
  correctly forces a full reversal to hold status alone (`reversed`) rather
  than an unrepresentable zero amount, with the wire response reporting the
  true remaining figure separately.
- **`deductFromDriverFee` (GAP-15/§6.7) correctly departs from oldest-first
  on its `owed_to_us` side** — settling the one obligation the manager
  named, not whichever is oldest, while its `owed_by_us` side still sweeps
  oldest-first like an ordinary offset — matching the documented rationale
  that a targeted one-tap deduction must not silently clear an unrelated,
  older due instead of the one actually named.

No findings in this slice beyond what Slice B already surfaced (which
covered deposit/advance void-and-recompute).

---

## Slice E — Costs, incidents, vehicles

**Scope read:** `domain/expense.ts` in full, `domain/incident.ts`'s
money-writing functions (`recordRecoveryReceived`, `voidIncidentRecovery`),
`domain/vehicles.ts`'s function list, `queries/payment.ts`'s
obligation-scoped allocation lookup.

### Passes

- **`resolveBorneByDefault` (`domain/expense.ts:55-74`) correctly resolves
  the vehicle's arrangement *as of `spentOn`*, not as of today** — GAP-56's
  own fix, confirmed still in place: a late-entered fuel fill from before a
  new customer's lease started is not misattributed to the new customer.
- **`recordRecoveryReceived` (`domain/incident.ts:370-485`) correctly
  implements its own documented "reverse then repost" fix**: re-recording a
  corrected recovery amount voids every prior live payment allocation for
  the obligation and marks the superseded payment reversed before posting
  the new pair, so a fat-fingered amount corrected twice cannot leave two
  live payments behind. `findPaymentAllocationsForObligation`
  (`queries/payment.ts:250-266`) correctly filters `voided_at IS NULL`, so a
  second correction does not attempt to re-void an already-voided
  allocation.
- **`voidIncidentRecovery` correctly refuses once `received_amount_minor >
  0`**, matching the governing void-cascade principle (Slice B): the
  receipt behind it is its own entered act and must be undone through its
  own correction path, not by voiding the parent recovery.

No findings in this slice.

## Slice F — Reports and derived numbers

**Scope read:** `domain/reports.ts`'s day-based and lost-days functions,
`queries/reports.ts`'s `listLostDays`/`listLostDaysByMonth` SQL, DM §15's
own documented canonical query for the same report, CLAUDE.md's and
`user-flows.md` §4.1's lost-day denominator rule.

### Findings

**REV-2026-08-19-03 — The lost-days report's denominator can include a
still-unconfirmed day, contradicting the documented invariant that it is
exactly `ran + lost`**

- Files: `api/src/queries/reports.ts:668-699` (`listLostDays`) and its two
  siblings (`listLostDaysByMonth`, `listLostDaysByReason`); the identical
  shape is also the *documented, "measured not assumed"* canonical query at
  `docs/engineering/data-model.md:1766-1776`
- Confidence: `CONFIRMED` as a code/doc-claim mismatch; `PLAUSIBLE` as a
  user-facing consequence (depends on a report being run over a still-open
  date range, which has no client-side guard against but is not the only
  way this report is used)
- Invariant: CLAUDE.md → Numbers that go wrong quietly: *"The lost-day
  denominator is `ran + lost` — it excludes days the pattern never
  scheduled and days paused for a charter. Include either and the report
  overstates in the direction that costs money."* DM §15's own comment
  makes the same claim in stronger, absolute terms: *"the denominator is
  `ran + lost` and cannot be inflated by either exclusion."*
- Mechanism: `day_record.state` has more values than the two the exclusion
  rule accounts for — `not_scheduled` is correctly never a row at all
  (excluded by construction) and `paused_for_trip` is correctly filtered by
  `state <> 'paused_for_trip'`, but a day still awaiting confirmation is a
  live row with `state = 'open'`, and neither query filters it out.
  `lease_eligible` is computed as bare `COUNT(*)` over every row that
  survives the `paused_for_trip` exclusion, which is `did_not_run` + every
  `ran_%` state + `open`. Whenever the requested `[from, to]` window
  contains an unconfirmed day for a driver, `lease_eligible` is
  `ran + lost + open_count`, not `ran + lost` — the exact overstatement
  direction CLAUDE.md's own rule calls out as the one that costs money,
  since `lease_eligible` is the denominator UC-76's ratio and UI §11.1's
  "lost X out of Y" figure are built from.
- Failure scenario: a manager opens the lost-days report for "this month so
  far" (or any custom range ending today or later) partway through a day
  that has not yet been confirmed for one of the drivers on a daily lease.
  That driver's `lease_eligible` count is one higher than `ran + lost` for
  as long as the day stays open — the ratio reads as slightly better
  (fewer lost days out of a larger eligible count) than the confirmed facts
  actually support, self-correcting only once every day in range is
  eventually confirmed. Narrower in practice than REV-2026-08-19-02 (it
  self-heals once catch-up confirmation happens, rather than losing the
  fact permanently), but it is a live, reachable divergence between a
  number this codebase promises is exact and what the query actually
  computes, on the report UC-06 names as "the only protection" against a
  driver quietly not running on a particular weekday.
- Not a new gap in the code relative to the doc — the implementation
  faithfully reproduces the doc's own canonical SQL. The finding is that
  the doc's absolute claim ("cannot be inflated by either exclusion") is
  itself incomplete: it enumerates two exclusions and asserts completeness,
  without accounting for the third live state (`open`) that the same
  `WHERE` clause does not touch.
- Suggested owner: either a code fix (add `state <> 'open'` — equivalently
  `state IN ('did_not_run')` OR `state LIKE 'ran_%'`, replacing the current
  `COUNT(*)` — to both `listLostDays*` query functions and their DM §15
  documented counterpart together, since a change to one without the other
  would itself violate "documents travel together") or a doc fix narrowing
  the claim to "for a fully-confirmed date range" if the product decision is
  that this report is never meant to be run over a still-open range. Either
  way, `docs/` decides which, per CLAUDE.md.

---

## Slice G — Scheduled work and idempotency

**Scope read:** `api/src/scheduled.ts` in full, `queries/scheduled.ts`'s
idempotent insert functions.

### Passes

- **All four cron jobs (`generate-day-cards`, `generate-billing-periods`,
  `release-expired-holds`, `generate-management-fee`) are independently
  try/caught**, so one job's failure never takes another down, and each is
  idempotent by construction: `insertAllocationDaysIdempotent`/
  `insertDayRecordsIdempotent` (`queries/scheduled.ts:156-185`) both use
  `onConflictDoNothing()` rather than an application-level existence check,
  matching CLAUDE.md's "idempotency lives in the constraints" rule exactly.
- **`releaseAllExpiredHolds`'s nightly run (`scheduled.ts:77-87`) is the
  fifth and final call site sharing REV-2026-08-19-02's restore gap** —
  confirmed while reading this file, already accounted for in that finding.
- The single-timezone limitation noted in `scheduled.ts:22-27`
  (`businessToday()` called once for the whole cron run, not per business)
  is explicitly self-documented as a known, deferred limitation ("recorded
  in TRACKER.md, not guessed at") rather than a silent gap, so it is not
  logged again here as a new finding.

## Slice H — Cross-cutting sweep

**Scope read:** `scripts/check-forbidden.mjs`'s comment-stripping logic, run
directly against the checked-out repository; `.github/workflows/checks.yml`
and `integration.yml` for CI runner platform.

### Findings

**REV-2026-08-19-04 — `check-forbidden.mjs`'s comment-stripping silently
fails on CRLF line endings, producing false-positive violations (and,
structurally, the matching risk of false negatives) specifically in local
Windows development**

- File: `scripts/check-forbidden.mjs`'s `code()` function
- Confidence: `CONFIRMED` — reproduced directly by running the guard
- Invariant: none of the money/tenancy/time rules themselves — this is a
  defect in the mechanism IG §16.1 names as the enforcement for eleven of
  them, and IG §16.3 says runs on every file write via
  `.claude/hooks/guard.mjs`, in exactly this kind of session.
- Mechanism: `code(line, path)` strips a SQL comment with
  `line.replace(/--.*$/, "")` (and a `.ts`/`.js` comment with
  `line.replace(/\/\/.*$/, "")`). Both regexes rely on `.` reaching all the
  way to the unanchored `$`. Every file in this checkout has CRLF line
  terminators — confirmed directly (`file api/migrations/0025_replaces_id_unique.sql`
  → *"with CRLF line terminators"*, reproduced on a second `.sql` file and a
  `.ts` file, not an isolated case) — and `readFileSync(...).split("\n")`
  leaves the trailing `\r` attached to each line. `.` does not match `\r`
  (an ECMAScript line-terminator character, excluded from `.` even without
  the `m` flag), so on a line ending `…\r`, `/--.*$/` cannot consume the
  final character and the whole match fails outright — `.replace()` then
  returns the **original line completely unchanged**, comment text intact.
  Reproduced directly: `node scripts/check-forbidden.mjs
  api/migrations/0025_replaces_id_unique.sql` reports a `money/inexact-type`
  violation on line 3, which is `-- GAP-60/D-16. Migration 0021 gave every
  W-50 money table a nullable` — a full-line comment, correctly containing
  the English word "money" in prose, that should never have been scanned as
  code at all.
- Running the guard unscoped over the repository as it stands today
  reported 44 violations; every one checked was this same class of false
  positive (a trigger word inside a `--`/`//` comment on a CRLF line),
  never a real violation the fix uncovered.
- Why the existing CI gate hasn't caught this: `checks.yml`/`integration.yml`
  both run `on: ubuntu-latest` (confirmed directly), and git's checkout-time
  CRLF conversion (`core.autocrlf`) is a Windows-side behavior — a Linux CI
  runner checks out the LF-normalized blobs the repository actually stores,
  so `npm run guard` in CI does not hit this path. The bug is invisible to
  the automated gate and visible only in exactly the environment it matters
  most for catching a mistake early: a contributor (or an AI agent) writing
  code on Windows, where `.claude/hooks/guard.mjs` runs this same script on
  every file write, per IG §16.3's own stated purpose ("so a money or
  timezone mistake is corrected while the reasoning is still in context
  rather than twenty minutes later in CI").
- Failure scenario, both directions: (1) noise — a Windows contributor
  writing a migration whose comment happens to mention "money," "real," or
  "CURRENT_DATE" in prose gets blocked or second-guesses a correct write,
  the exact "false positives are what get a check deleted" risk the guard's
  own header comment warns about for its `NEVER_SCAN`/opt-out design; (2)
  the structurally symmetric risk — the same broken `.replace()` no-op means
  a line combining real code with a trailing CRLF-terminated comment is
  scanned as one unstripped string rather than as a comment-stripped
  `subject`, which is a strictly wider surface being matched, not a
  narrower one, so no evidence surfaced here of an actual missed violation
  — but the failure mode is a silent no-op on the regex, not a fail-closed
  behavior, which is the wrong direction for a safety check to fail in.
- Suggested owner: code fix — replace `/--.*$/` and `/\/\/.*$/` with a
  version that treats `\r` as ordinary trailing whitespace (e.g. strip a
  trailing `\r` from each line before the comment-strip regex runs, or use
  `line.replace(/--[^\r\n]*/, "")`), and add the CRLF case to whatever
  fixture/self-test protects this script's own regexes from future drift —
  there does not appear to be one today (`scripts/` carries no test file
  scoped to `check-forbidden.mjs` itself, checked by directory listing).

---

## Closing summary

Eight slices, ~60,000 lines of backend source and 30 migrations read against
their owning documentation, source-and-docs only (no database contact — the
integration suite and golden fixtures were not run). Four findings survived
verification; the great majority of what was checked held, including several
mechanisms this review expected to find drifted (the `assert_period_open()`
trigger array, the void-cascade fixes from `GAP-12-VOID-CASCADE-DESIGN.md`)
and confirmed, by direct reading, that they had not.

| # | Slice | Summary | Confidence | Suggested owner |
|---|---|---|---|---|
| REV-01 | B | `assert-no-trigger-drift.sql`'s own header comment is stale, describing a `trip`-missing-from-the-array state that was already fixed 18 Aug | CONFIRMED | doc fix |
| REV-02 | C | A hold or cancelled trip whose date range began before its release date permanently loses the daily lease's day records for the already-elapsed portion — no obligation, no report flag, ever, for those dates | CONFIRMED | code fix (extends GAP-7's own forward-hole fix to the backward case) |
| REV-03 | F | The lost-days report's `lease_eligible` denominator can include a still-unconfirmed (`open`) day, contradicting the documented claim that it is exactly `ran + lost` | CONFIRMED (code matches doc; the doc's own completeness claim is what's wrong) | doc fix or code fix, `docs/` decides which |
| REV-04 | H | `check-forbidden.mjs`'s comment-stripping silently no-ops on CRLF line endings — every file in this checkout is CRLF, so the guard's local (Windows) results are presently unreliable, invisible to Ubuntu-runner CI | CONFIRMED | code fix |

**Recommended priority: REV-02 first.** It is the only finding that loses a
real number permanently rather than degrading, misreporting temporarily, or
affecting tooling — exactly the class of defect CLAUDE.md opens by naming.
REV-04 is worth a fast follow, since every finding after it in this review
(and every future one) was produced under conditions where the safety net
IG §16.3 describes was not actually catching what it claims to on this
platform. REV-01 and REV-03 are low-urgency, doc-adjacent fixes.

None of the four duplicates an open TRACKER.md gap; none contradicts a
declined recommendation already recorded in `docs/`. Proposed GAP numbers
(GAP-137 onward) are left for whoever picks these up to assign, per this
repository's own numbering convention — this review does not edit
`TRACKER.md`, `Plan.md`, or `docs/` itself.

*This completes the eight-slice pass the plan specified (A–H).*
