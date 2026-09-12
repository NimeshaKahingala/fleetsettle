# FleetSettle — Logical Issues Audit

**Branch:** `develop` @ `a5d19a3`. **Scope:** `api/src/domain/**` (37 files), `api/src/queries/**` + `api/src/handlers/**` + middleware/errors/auth (37+34+~14 files), `api/migrations/**` (39 files) + `api/src/db/schema.ts`, and `web/src/**` logic-bearing files (money/date/network code — not pure presentation). **Method:** every issue below was independently re-read and confirmed against the current file state before inclusion; nothing is carried over from a prior document without re-verification.

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

### 3. HIGH — cancelling a trip acts on a stale, unlocked snapshot; a sibling function fixed the identical race
**File:** [`api/src/domain/trip.ts:1011`](api/src/domain/trip.ts#L1011) (`cancelTrip`, entire body operates on `input.trip`) vs. [`api/src/domain/trip.ts:577`](api/src/domain/trip.ts#L577) (`confirmTripHold`'s locked re-read, with its own comment explaining exactly this hazard) and [`api/src/queries/trip.ts:458`](api/src/queries/trip.ts#L458) (`cancelTripRow`'s `UPDATE`, no `WHERE status = ...` guard)
**Defect:** The handler reads `trip` via a plain reader connection before either transaction opens ([`handlers/trip.ts:345`](api/src/handlers/trip.ts#L345)) and `cancelTrip` never re-fetches or locks the row inside its own transaction — unlike `confirmTripHold`, whose comment documents this exact hazard and re-reads `forUpdate`.
**Failure scenario:** `closeTrip` and `cancelTrip` run concurrently on the same trip. `closeTrip` commits first, creating a `driver_fee` obligation. `cancelTrip`, still working from its stale `status === 'booked'` snapshot, proceeds to void every obligation sourced from the trip — including the one `closeTrip` just created — then unconditionally overwrites status to `cancelled`, silently undoing the legitimate close and erasing the driver's fee.

---

### 4. HIGH — a payment correction can silently discard a concurrent correction (lost update)
**File:** [`api/src/domain/payment-correction.ts:70`](api/src/domain/payment-correction.ts#L70) (`findPaymentForBusiness`, no lock option exists on this query at all) and [`api/src/queries/payment.ts:170`](api/src/queries/payment.ts#L170) (`updatePaymentAfterCorrection`, unconditional `UPDATE`, no status guard)
**Defect:** `correctPayment` reads the payment row inside its transaction but without `FOR UPDATE` — the query function doesn't even expose a lock parameter, unlike `findObligationForBusiness`/`findIncidentRecoveryForBusiness` elsewhere in the codebase.
**Failure scenario:** Two concurrent corrections of the same payment (double-submit, or two staff members). Under READ COMMITTED, both reads proceed without blocking each other; both compute new `amountMinor`/`status` from the same pre-correction values. The second `UPDATE` (which does implicitly lock, but only at write time) overwrites the first correction's result with values computed from stale data — both `payment_correction` audit rows exist, but only the second's numbers survive on the `payment` row itself.

---

### 5. HIGH — `write_off.party_type` has no database-level constraint at all
**File:** [`api/migrations/0001_initial_schema.sql`](api/migrations/0001_initial_schema.sql) — `write_off` table DDL (`party_type text NOT NULL`, no `CHECK`); confirmed no later migration among all 39 touches this column.
**Defect:** Every structural sibling with the same `party_type` + `party_customer_id` + `party_driver_id` shape enforces an enum at the DB level — `obligation` (`CHECK (party_type IN ('customer','driver','partner'))`, plus a separate "exactly one party FK" check), `payment`, `deposit`. `write_off` alone has neither the enum check nor the exactly-one-FK check; protection exists only in the Zod schema at the application boundary.
**Failure scenario:** Any writer that bypasses the guarded schema — a bulk-repair script, a raw backfill in the style of the ones migrations `0036`/`0038` already use, a future endpoint that forgets to reuse the shared schema — can insert a `write_off` row with `party_type = 'partner'` (a value the domain never handles) or with `party_type` inconsistent with which FK is actually populated. `queries/write-off.ts` reads `partyType` back as a trusted `"customer" | "driver"` literal with no runtime check. The result: a real financial write-off recorded in the ledger's total but invisible from the party's own balance or ageing report.

---

### 6. HIGH — an audit-trail timestamp is rendered in the device's timezone instead of the business timezone
**File:** [`web/src/features/period/auditEntryToTimeline.ts:4-11`](web/src/features/period/auditEntryToTimeline.ts#L4) (`formatWhen`)
**Defect:** Builds `new Intl.DateTimeFormat("en-GB", {...})` with no `timeZone` option and formats a raw `timestamptz` string from `audit_log`. `web/src/lib/formatTimestamp.ts` exists specifically to avoid this (and has its own test suite that catches the failure mode in a non-Colombo test timezone); this file duplicates the formatting logic without the fix, and has no test of its own.
**Failure scenario:** `CorrectPaymentSheet.tsx` calls this for every audit-log entry on a payment (every payment has at least one). Any manager whose device is not on `Asia/Colombo` (a device left on UTC, a traveller) sees each correction's timestamp off by 5.5 hours — occasionally a full calendar day near midnight — on the ledger's own audit trail.

---

### 7. MEDIUM — voiding a payment allocation can silently clobber a prior void's audit fields
**File:** [`api/src/queries/payment.ts:225-234`](api/src/queries/payment.ts#L225) (`voidPaymentAllocation`)
**Defect:** The `UPDATE` sets `voidedAt`/`voidedReason`/`voidedBy` with `WHERE eq(paymentAllocation.id, allocationId)` only — no `isNull(voidedAt)` guard. This is the sole exception among the codebase's void functions, all of which carry this guard specifically so a second/concurrent void becomes a no-op rather than an overwrite (the convention is stated explicitly next to `voidExpenseRow`'s own equivalent fix, referencing this exact class of bug).
**Failure scenario:** Two concurrent unwinds of the same allocation (from `adjustment.ts`, `payment-correction.ts`, or `incident.ts`, each of which calls this after reading via an already-filtered `isNull(voidedAt)` query but without locking the allocation row itself). Both UPDATEs land; the second silently overwrites who voided it and why. The resulting balance stays correct — both callers already excluded voided rows on read — but the audit trail of who actually voided the allocation, and for what stated reason, is destroyed. This is a direct instance of the append-only rule the codebase otherwise enforces everywhere else.

---

### 8. MEDIUM — `payment` and `deposit` check `party_type` is a valid value, but not that it matches which party FK is populated
**File:** [`api/migrations/0001_initial_schema.sql`](api/migrations/0001_initial_schema.sql) — `payment` and `deposit` table DDL.
**Defect:** Both tables constrain `party_type` to a valid enum, but unlike `obligation` (which additionally has `CHECK ((party_customer_id IS NOT NULL)::int + ... = 1)`), neither ties `party_type` to which of `party_customer_id`/`party_driver_id`/`party_user_id` is actually set. `docs/engineering/data-model.md`'s own DDL for both tables has the same gap, so this isn't a doc/code drift — it's a genuine inconsistency between sibling tables in the schema itself.
**Failure scenario:** A row could be inserted with `party_type = 'driver'` while `party_customer_id` is populated (or neither/both IDs set); a nullable `REFERENCES` FK only validates a value if one is present, so this passes. Any read path that branches on `party_type` to choose which ID column is authoritative can attribute a payment or deposit to the wrong party, or to neither.

---

## Not included

Each subagent traced a substantially larger set of candidate issues — including the previously-known `pg-error.ts` substring-matching gap (B18) and the `partner.ts` `replacesId` same-party gap flagged in the prior review — and ruled them out on closer reading as already fixed, deliberate, or not reproducible from the actual code. Roughly 200 backend files and ~45 targeted frontend files were opened in this pass; the 8 items above are what survived independent re-verification. This document does not restate the previously-confirmed `partner.ts`/`pg-error.ts` findings from `INDEPENDENT-VALIDATION-2026-09-02.md` — they remain open and are documented there.
