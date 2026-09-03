# FleetSettle — Logical Issues Audit (Exhaustive Pass)

**Branch:** `develop` @ `a5d19a3`. **Coverage:** every file in `api/src/domain/**` (37/37, confirmed by explicit checklist), `api/src/queries/**` + `api/src/handlers/**` + middleware/errors/auth (~85 files, full read confirmed), `api/migrations/**` (39/39, confirmed in numeric/cumulative order) + `api/src/db/schema.ts`, and `web/src/**` (355 of 359 files opened directly — `web/src/features/**` all 207, `web/src/components/**` all 42, `web/src/design/**` all 41, `web/src/app/**` all 8, `web/src/lib/**` all 57; `packages/shared/src/route-defs/**` sampled 10 of 34 route-def/handler pairs rather than all 34). **Method:** every issue below was independently re-read and confirmed against the current file state — by me, directly, not just relayed from a subagent — before inclusion.

Ordered by severity. Numbering has no other significance.

---

### 1. CRITICAL — a partial deposit refund is recorded as if the whole deposit were released
**File:** [`api/src/domain/deposit.ts:252`](api/src/domain/deposit.ts#L252)
**Defect:** `newStatus = TERMINAL[input.movementType] ?? dep.status` maps any `movementType: "refunded"` movement straight to `status: "released"`, with no check that the refund actually zeroes the held balance.
**Failure scenario:** A deposit holds 20,000. A manager refunds 100 (a partial refund — the API accepts any positive amount for `refunded`, with no constraint tying it to the balance). The deposit's status flips to `released` even though 19,900 is still held. `sumDepositsHeld` filters on `status IN ('held','hold_window')`, so the remaining 19,900 silently disappears from every cash-position report, and the deposit can no longer be topped up or further refunded because the `status !== 'held'` guard now blocks it.

---

### 2. CRITICAL — a stale pre-transaction read lets a corrected incident recovery leave a phantom spendable credit
**File:** [`api/src/domain/incident.ts:436`](api/src/domain/incident.ts#L436) (unlocked read) and [`api/src/domain/incident.ts:565`](api/src/domain/incident.ts#L565) (stale value used to decide reversal)
**Defect:** `recordRecoveryReceived` reads `recovery` via `writer` before opening its transaction. Inside the transaction, whether to call `markPaymentReversed` is decided from that pre-transaction `recovery.paymentId`, not from a value read inside the transaction. The write path itself (`recordIncidentRecoveryReceived`'s `UPDATE`) does take a row lock, so this is a lost update, not a true concurrent race: the second of two overlapping corrections blocks, then proceeds using its now-stale snapshot once the first commits.
**Failure scenario:** Two near-simultaneous corrections of the same recovery (a fat-fingered amount fixed with a quick resubmit, or two devices). The first mints payment A and sets `paymentId = A`. The second's transaction voids A's allocation (using a live, correctly-scoped read) but — because its captured `recovery.paymentId` is stale — never calls `markPaymentReversed` on A. Payment A is left `active` with no live allocation, which `credit-forward.ts` (filtering only on `status != 'reversed'`) reads as fully spendable, unattributed customer credit.

---

### 3. HIGH — closing a lease's deposit refund reads the held balance outside any lock, unlike its own sibling branch two lines below
**File:** [`api/src/domain/lease-closure.ts:343`](api/src/domain/lease-closure.ts#L343) (`"refund"` branch) vs. [`api/src/domain/lease-closure.ts:369`](api/src/domain/lease-closure.ts#L369) (`"apply"` branch)
**Defect:** The `"refund"` branch reads `heldBefore = await sumDepositMovements(writer, dep.id)` on the plain `writer`, then passes it as the refund amount into `recordDepositMovement`, which opens its own separate transaction afterward. The `"apply"` branch a few lines later does the same sum but explicitly *inside* its transaction, with a comment stating exactly why: "reading it via `writer` beforehand would let a concurrent deposit movement make `remaining` stale by the time the loop below spends it." The `"refund"` branch does precisely what that comment warns against.
**Failure scenario:** A manager closes a lease and refunds a deposit holding 20,000; `heldBefore` reads 20,000. Before the refund's own transaction opens and locks the row, a concurrent top-up of 5,000 commits. The refund transaction then locks the deposit, sees a true balance of 25,000, and validates only that the 20,000 draw doesn't exceed it — which passes. It refunds 20,000 and (via finding #1's unconditional status mapping) marks the deposit `released`, permanently, with 5,000 of real money left unaccounted for.

---

### 4. HIGH — cancelling a trip acts on a stale, unlocked snapshot; a sibling function fixed the identical race
**File:** [`api/src/domain/trip.ts:1011`](api/src/domain/trip.ts#L1011) (`cancelTrip`, entire body operates on `input.trip`) vs. [`api/src/domain/trip.ts:577`](api/src/domain/trip.ts#L577) (`confirmTripHold`'s locked re-read, with its own comment explaining exactly this hazard) and [`api/src/queries/trip.ts:458`](api/src/queries/trip.ts#L458) (`cancelTripRow`'s `UPDATE`, no `WHERE status = ...` guard)
**Defect:** The handler reads `trip` via a plain reader connection before either transaction opens, and `cancelTrip` never re-fetches or locks the row inside its own transaction — unlike `confirmTripHold`, whose comment documents this exact hazard and re-reads `forUpdate`.
**Failure scenario:** `closeTrip` and `cancelTrip` run concurrently on the same trip. `closeTrip` commits first, creating a `driver_fee` obligation. `cancelTrip`, still working from its stale `status === 'booked'` snapshot, proceeds to void every obligation sourced from the trip — including the one `closeTrip` just created — then unconditionally overwrites status to `cancelled`, silently undoing the legitimate close and erasing the driver's fee.

---

### 5. HIGH — a payment correction can silently discard a concurrent correction (lost update)
**File:** [`api/src/domain/payment-correction.ts:70`](api/src/domain/payment-correction.ts#L70) (`findPaymentForBusiness`, no lock option exists on this query at all) and [`api/src/queries/payment.ts:170`](api/src/queries/payment.ts#L170) (`updatePaymentAfterCorrection`, unconditional `UPDATE`, no status guard)
**Defect:** `correctPayment` reads the payment row inside its transaction but without `FOR UPDATE` — the query function doesn't even expose a lock parameter, unlike `findObligationForBusiness`/`findIncidentRecoveryForBusiness` elsewhere in the codebase.
**Failure scenario:** Two concurrent corrections of the same payment (double-submit, or two staff members). Under READ COMMITTED, both reads proceed without blocking each other; both compute new `amountMinor`/`status` from the same pre-correction values. The second `UPDATE` overwrites the first correction's result with values computed from stale data — both `payment_correction` audit rows exist, but only the second's numbers survive on the `payment` row itself.

---

### 6. HIGH — `write_off.party_type` has no database-level constraint at all
**File:** [`api/migrations/0001_initial_schema.sql`](api/migrations/0001_initial_schema.sql) — `write_off` table DDL (`party_type text NOT NULL`, no `CHECK`); confirmed no later migration among all 39 touches this column.
**Defect:** Every structural sibling with the same `party_type` + `party_customer_id` + `party_driver_id` shape enforces an enum at the DB level — `obligation` (`CHECK (party_type IN ('customer','driver','partner'))`, plus a separate "exactly one party FK" check), `payment`, `deposit`. `write_off` alone has neither the enum check nor the exactly-one-FK check; protection exists only in the Zod schema at the application boundary.
**Failure scenario:** Any writer that bypasses the guarded schema — a bulk-repair script, a raw backfill in the style of the ones migrations `0036`/`0038` already use, a future endpoint that forgets to reuse the shared schema — can insert a `write_off` row with `party_type = 'partner'` (a value the domain never handles) or with `party_type` inconsistent with which FK is actually populated. `queries/write-off.ts` reads `partyType` back as a trusted `"customer" | "driver"` literal with no runtime check. The result: a real financial write-off recorded in the ledger's total but invisible from the party's own balance or ageing report.

---

### 7. HIGH — an audit-trail timestamp is rendered in the device's timezone instead of the business timezone
**File:** [`web/src/features/period/auditEntryToTimeline.ts:4-11`](web/src/features/period/auditEntryToTimeline.ts#L4) (`formatWhen`)
**Defect:** Builds `new Intl.DateTimeFormat("en-GB", {...})` with no `timeZone` option and formats a raw `timestamptz` string from `audit_log`. `web/src/lib/formatTimestamp.ts` exists specifically to avoid this (and has its own test suite that catches the failure mode in a non-Colombo test timezone); this file duplicates the formatting logic without the fix, and has no test of its own.
**Failure scenario:** `CorrectPaymentSheet.tsx` calls this for every audit-log entry on a payment (every payment has at least one). Any manager whose device is not on `Asia/Colombo` (a device left on UTC, a traveller) sees each correction's timestamp off by 5.5 hours — occasionally a full calendar day near midnight — on the ledger's own audit trail.

---

### 8. HIGH — a driver's own balance screen shows a caption that contradicts the fixed headline for the same figure
**File:** [`web/src/features/mine/MineScreen.tsx:46-51`](web/src/features/mine/MineScreen.tsx#L46) vs. [`web/src/components/TwoBalances.tsx:46-59`](web/src/components/TwoBalances.tsx#L46)
**Defect:** `TwoBalances`'s headline text is fixed and unconditional: the `owedToYouMinor` figure is always rendered under the literal words "He owes you," and `owedByYouMinor` always under "You owe him" (confirmed by its own doc comment, and by both other call sites — `DriverDetailScreen.tsx` and `DriverStatementScreen.tsx` — which pass `"—"` as the detail line specifically to avoid saying anything that could clash with those fixed headlines). `MineScreen.tsx` instead supplies real captions: `owedToYouMinor` (fed from `owedToUsMinor` — money the driver owes the business) is captioned "What you still owe the business," directly under a headline that reads "He owes you [same amount]." The second row inverts the same contradiction.
**Failure scenario:** A linked driver opens their own read-only balance view and sees, for the identical number, one line asserting it's owed to them and the line directly beneath it asserting the opposite. `MineScreen.test.tsx` asserts the headline text and the amount but never the caption text, so this passes CI.

---

### 9. MEDIUM — voiding a payment allocation can silently clobber a prior void's audit fields
**File:** [`api/src/queries/payment.ts:225-234`](api/src/queries/payment.ts#L225) (`voidPaymentAllocation`)
**Defect:** The `UPDATE` sets `voidedAt`/`voidedReason`/`voidedBy` with `WHERE eq(paymentAllocation.id, allocationId)` only — no `isNull(voidedAt)` guard. This is the sole exception among the codebase's void functions, all of which carry this guard specifically so a second/concurrent void becomes a no-op rather than an overwrite.
**Failure scenario:** Two concurrent unwinds of the same allocation (from `adjustment.ts`, `payment-correction.ts`, or `incident.ts`). Both UPDATEs land; the second silently overwrites who voided it and why. The resulting balance stays correct — both callers already excluded voided rows on read — but the audit trail of who actually voided the allocation, and for what stated reason, is destroyed.

---

### 10. MEDIUM — `payment` and `deposit` check `party_type` is a valid value, but not that it matches which party FK is populated
**File:** [`api/migrations/0001_initial_schema.sql`](api/migrations/0001_initial_schema.sql) — `payment` and `deposit` table DDL.
**Defect:** Both tables constrain `party_type` to a valid enum, but unlike `obligation` (which additionally has `CHECK ((party_customer_id IS NOT NULL)::int + ... = 1)`), neither ties `party_type` to which of `party_customer_id`/`party_driver_id`/`party_user_id` is actually set. `docs/engineering/data-model.md`'s own DDL for both tables has the same gap — a genuine schema inconsistency, not a doc/code drift.
**Failure scenario:** A row could be inserted with `party_type = 'driver'` while `party_customer_id` is populated (or neither/both IDs set); a nullable `REFERENCES` FK only validates a value if one is present. Any read path that branches on `party_type` to choose which ID column is authoritative can attribute a payment or deposit to the wrong party, or to neither.

---

### 11. MEDIUM — `payment_allocation`'s void trio has no consistency CHECK, unlike its structurally-identical sibling
**File:** [`api/migrations/0022_void_everywhere.sql:37-46`](api/migrations/0022_void_everywhere.sql) (`payment_allocation`) vs. same file, `vehicle_day_allocation`/`day_record`/`opening_balance_entry` (each gets a CHECK), vs. [`api/migrations/0024_offset_allocation_void.sql:15-19`](api/migrations/0024_offset_allocation_void.sql)
**Defect:** In migration `0022`, three of the four tables getting the void trio (`voided_at`/`voided_reason`/`voided_by`) also get a CHECK forcing all-null-or-all-set. `payment_allocation`, added in the same migration, gets only the three columns — no CHECK. Migration `0024` later gives `offset_allocation` — whose own header explicitly calls it "structurally identical to `payment_allocation`" — the CHECK that `payment_allocation` still lacks. Confirmed never added in any of the remaining migrations.
**Failure scenario:** A void of a `payment_allocation` row — real money-reallocation, undoing which obligation a payment counted against — can land with `voided_at` set and `voided_by`/`voided_reason` NULL, and the database accepts it silently: the one table in this void-trio family where that's possible.

---

### 12. MEDIUM — `expense.borne_by` is checked one-directionally, and a live API path exploits exactly the gap
**File:** [`api/migrations/0001_initial_schema.sql:398-415`](api/migrations/0001_initial_schema.sql) (DB CHECK) and [`packages/shared/src/schemas/expense.ts:74-80`](packages/shared/src/schemas/expense.ts#L74) (Zod, same one-directional shape) and [`api/src/handlers/expense.ts:76-87`](api/src/handlers/expense.ts#L76)
**Defect:** Both the DB CHECK and its Zod mirror only enforce "if `borneBy = 'driver'` then `borneByDriverId` is set" (and the customer equivalent) — neither constrains the *other* FK column, and neither constrains `borneBy = 'us'` to leave both FKs null. The handler attaches whatever `borneByDriverId`/`borneByCustomerId` the request supplied independently of `borneBy`'s value, checking only that the referenced party exists in the business, not that it's consistent with `borneBy`.
**Failure scenario:** `POST /api/expense {borneBy:"us", borneByDriverId:"<valid driver>"}` passes both the Zod schema and the DB CHECK, and is echoed back with `borneBy:"us"` and a populated `borneByDriverId`. No report is corrupted today (current queries filter on `borne_by`, not the FK columns), but the stored data is inconsistent, and any future consumer that trusts FK presence — e.g. a driver's own statement view — would attribute the wrong party's cost.

---

### 13. LOW — `opening_balance_entry.kind` and `message.recipient_type` have an enum CHECK but no consistency CHECK against their nullable party/vehicle columns
**File:** [`api/migrations/0001_initial_schema.sql:779-791`](api/migrations/0001_initial_schema.sql) (`opening_balance_entry`) and [`api/migrations/0001_initial_schema.sql`](api/migrations/0001_initial_schema.sql) (`message`, `recipient_type`)
**Defect:** Same pattern as #10, on two more tables. `opening_balance_entry.kind` is enum-checked; `party_customer_id`/`party_driver_id`/`party_user_id`/`vehicle_id` are independently nullable with nothing tying the populated column to `kind`. `message.recipient_type` has the identical shape against `recipient_customer_id`/`recipient_driver_id`.
**Failure scenario / mitigation:** `opening_balance_entry` is protected today by a Zod discriminated union at the wire boundary, and blast radius is bounded (one batch per business, ever). `message.recipient_type` is currently dormant — no file anywhere under `api/src` writes `recipientDriverId`/`recipientCustomerId` yet, since the messaging phase hasn't shipped a writer. Worth closing before that phase ships, given CLAUDE.md's driver-isolation requirement (a future inbox query scoped by `recipient_driver_id` without also checking `recipient_type` would be exposed to this).

---

### 14. LOW — `commitOpeningBalanceRoute` doesn't declare the 409 its handler can actually return
**File:** [`api/src/route-defs/opening-balance.ts:49-61`](api/src/route-defs/opening-balance.ts#L49) vs. [`api/src/domain/opening-balance.ts:550`](api/src/domain/opening-balance.ts#L550)
**Defect:** The route-def's declared responses are 200/401/403/404. The handler's domain call re-materializes opening-balance entries on commit and maps a period-closed trigger violation to `PeriodClosedError` (HTTP 409) — reachable if the covering period closed between save and commit. The runtime behavior is correct; only the OpenAPI contract is incomplete, unlike the sibling `save` route which does declare it.

---

## Coverage notes

- **Backend domain (37 files):** re-audited with an explicit per-file checklist; 37/37 confirmed read, one new issue found (#3).
- **Backend queries/handlers/middleware (~85 files):** confirmed full read; findings from both the original and this pass are included above.
- **Migrations (39 files) + schema.ts:** re-audited in full cumulative-state order with an explicit per-file checklist; 39/39 + schema.ts confirmed read, four new issues found (#11, #12, #13 ×2).
- **Frontend (359 files):** 355 opened directly across all of `features/` (207), `components/` (42), `design/` (41), `app/` (8), `lib/` (57) — up from ~45 in the first pass. `packages/shared/src/route-defs/**` (34 files) was sampled at 10 route-def/handler pairs rather than read in full; one gap found (#14) in the sampled set, so the other 24 are unverified. `web/src/test/**` (3 files, scaffolding) was skimmed rather than deeply reviewed.
- Every finding above was independently re-verified against the live file — not merely relayed from a subagent — before inclusion in this document.
