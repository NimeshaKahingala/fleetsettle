# Independent Validation of `CODE-EVALUATION-END-TO-END-2026-09-02.md`

**Branch:** `develop` — HEAD `a5d19a3`, same commit the source document claims. **Method:** every claim below was checked against the actual file at the actual cited line, or by running the actual command. Nothing here was carried over from the source document without independent re-derivation. No code was changed.

---

## 1. What checks out

| Claim | Verification | Result |
|---|---|---|
| Backend/frontend/migration counts (202 / 359 / 39) | `find api/src -type f \| wc -l`, `find web/src -type f \| wc -l`, `ls api/migrations/*.sql \| wc -l` | **Confirmed** |
| Branch/HEAD `develop` @ `a5d19a3` | `git log --oneline -3`, `git rev-parse --abbrev-ref HEAD` | **Confirmed** |
| Migrations `0035`–`0039` exist with the stated purposes | `ls api/migrations/` + read each file | **Confirmed** |
| `guard` clean, `typecheck` clean | Ran both directly | **Confirmed** |
| `0/34` route-defs declare `PARTY_ARCHIVED`/`FS001` | `grep -rl` across `api/src/route-defs/` | **Confirmed** |
| B18 — four `pg-error.ts` matchers keyed on fragile substrings of `P0001` trigger text | Read `pg-error.ts:103-126`; confirmed `"is closed"` literal is duplicated across migrations `0001`, `0006`, `0008` | **Confirmed, still open** |
| `partner.ts` `replacesId` paths lack a same-party check | Read all three call sites (capital/banking/payout); compared against `write-off.ts:135`'s `sameParty` guard | **Confirmed, still open** (see caveat in §3) |

The document's overall gate status (clean `guard`/`typecheck`, full suite green) is accurate. Its file-count arithmetic is accurate.

---

## 2. The one finding that matters — confirmed, but the source document describes the wrong mechanism

**Location:** [`api/src/domain/incident.ts:436`](api/src/domain/incident.ts#L436) (`recordRecoveryReceived`).

**What's actually there:** `recovery` is read on `writer` — no `FOR UPDATE` — before the transaction opens. Inside the transaction, the decision of whether to call `markPaymentReversed` (line 565-566) uses this pre-transaction, unlocked `recovery.paymentId`, not a value read inside the transaction. `findIncidentRecoveryForBusiness` ([`queries/incident.ts:333`](api/src/queries/incident.ts#L333)) already accepts a `forUpdate` boolean — it simply isn't passed `true` at this call site.

**What the source document claims (§2.1, incident.ts row):** *"concurrent `receive` both see `paymentId=null`, both skip `markPaymentReversed`, both mint P1/P2, last writer wins orphan `active` payment."* This describes an unserialized race where two transactions run concurrently and both proceed to mint.

**What actually happens:** The transaction's own entry point, `recordIncidentRecoveryReceived` ([`queries/incident.ts:424`](api/src/queries/incident.ts#L424)), issues an `UPDATE ... WHERE id = recoveryId AND voided_at IS NULL` against the row. Postgres row-locks on that UPDATE, so two concurrent calls **do not run concurrently** past that point — the second blocks until the first commits. This is not the "both see null" race described; it is a **lost update**: request B's snapshot of `paymentId`, taken before A started, is stale by the time B's UPDATE unblocks and B decides whether to reverse. Same defect class, same fix, different mechanism — and a test written to reproduce "two requests racing to read null simultaneously" would not exercise the actual bug, which requires B to unblock *after* A has already committed a payment.

**Verified impact (confirmed independently, not just asserted):** [`credit-forward.ts:98`](api/src/domain/credit-forward.ts#L98) selects payment candidates filtered only on `status != 'reversed'`, then computes drawable credit as `amountMinor − SUM(live allocations)`. A payment left `active` with its allocation voided (exactly the state B produces) computes as fully drawable credit — not a dangling row, but spendable money a customer did not actually have.

**Severity:** CRITICAL, confirmed. **Fix is narrow:** pass `true` for `forUpdate` at line 436 and use the transaction's own re-read of `paymentId` (or re-fetch inside the `tx` block) rather than the outer `recovery` binding at line 565.

---

## 3. Findings the source document reports as open, independently re-verified as already fixed or nonexistent

| ID | Source's claim | Independent check | Verdict |
|---|---|---|---|
| **B1** | `incident.ts:626` — `insertInsuranceClaim` posts only `postedPeriodId`, missing `belongsToPeriodId` like line 635 | Read the actual `insertInsuranceClaim` call at [`incident.ts:773`](api/src/domain/incident.ts#L773) (not 626, which is an unrelated return statement). `insurance_claim`'s `schema.ts` definition ([`db/schema.ts:799`](api/src/db/schema.ts#L799)) and every migration were grepped for `belongs_to_period_id` on that table — **the column does not exist on `insurance_claim` in any migration.** Only `incident_recovery` has it. | **False as stated — not a bug, and the suggested fix would not compile.** |
| **B2** | `reports.ts:1346` — `countAllocatedDaysForVehicle` missing `AND voided_at IS NULL` | Located the actual (sole) function at [`reports.ts:1890`](api/src/queries/reports.ts#L1890) — line 1346 is unrelated ageing-bucket SQL. The real function already has `AND voided_at IS NULL` on line 1903. | **Fabricated — already correct, wrong line cited entirely.** |
| **B4** | `reports.ts:894` — ageing bucket uses JS `Date.parse` | Grepped `Date.parse`/`new Date(` in `reports.ts` domain+queries — zero hits. The ageing bucket ([`reports.ts:1340`](api/src/queries/reports.ts#L1340)) computes buckets via SQL `${asOfDate}::date - effective_due_on`, not JS date arithmetic. | **False — already SQL, no JS date parsing present.** |
| **N5** | `vehicles.ts:234` — archiving a vehicle doesn't check for an open loan | Read `vehicles.ts` around the archive path: [`vehicles.ts:261-262`](api/src/domain/vehicles.ts#L261) calls `listVehicleLoansForVehicle` and throws `VehicleHasOpenLoanError` if any loan has `closedOn === null`, before calling `setVehicleLifecycle`. Code comment at line 242 explicitly references this as the N5 fix. | **Already fixed — the source document's own prior finding, not carried forward correctly.** |
| **N7** | `vehicle-loan.ts:202` — `listLivePaymentsForLoan` has no `businessId` scoping | Read the function directly ([`queries/vehicle-loan.ts:219-233`](api/src/queries/vehicle-loan.ts#L219)) — the `WHERE` clause includes `eq(loanPayment.businessId, businessId)` alongside `loanId` and `isNull(voidedAt)`. | **False — businessId scoping is present.** |
| **B21** | `arrangement.ts:64`, `incident.ts:121`, `partner.ts:51,198` — money fields typed as plain `moneyWireSchema` instead of `positiveMoneyWireSchema` | Grepped each named field directly: `dailyLeaseAmountMinor` at `arrangement.ts:67,91` is `positiveMoneyWireSchema`; `claimedAmountMinor` at `incident.ts:125` is `positiveMoneyWireSchema`; `amountMinor` at `partner.ts:58,207` is `positiveMoneyWireSchema`. The plain `z.string()`/`moneyWireSchema` occurrences that do exist are on separate *response* schemas (echoing a stored value back), not the create-input schemas the finding names. | **False as stated — the create-input fields already use the positive variant.** |

Six of the nine items the source document lists as "still open, LOW/MEDIUM" are either already fixed in this exact codebase or never existed as described. This is a materially different result from simply re-confirming the source document's tracker.

---

## 4. Findings confirmed genuinely open (beyond the CRITICAL in §2)

1. **`partner.ts` `replacesId` missing same-party check** (MEDIUM) — confirmed real, but at the *wrong* lines in the source document (`132` is unrelated ownership-share code). The real call sites are [`partner.ts:176`](api/src/domain/partner.ts#L176) (capital contribution), [`:344`](api/src/domain/partner.ts#L344) (banking event), [`:456`](api/src/domain/partner.ts#L456) (partner payout). None of the three checks that `target`'s owning user matches `input`'s. Caveat for anyone fixing this: the banking-event table's party column is `fromUserId`, not `userId` — a fix copied verbatim from the capital-contribution shape would reference a field that doesn't exist on that row.

2. **B18 — fragile `P0001` string-matching in `pg-error.ts`** (MEDIUM) — confirmed real and still open, as the source document itself notes in its own code comment at `pg-error.ts:33-37`. Not currently a live money-correctness bug (the underlying trigger still blocks the write regardless of matcher failure), but a reworded trigger message on any of the four generic-`P0001` raisers turns a mapped `409` into an unmapped `500` with no test to catch it at the point of the edit.

3. **OpenAPI declarations for `PARTY_ARCHIVED`/`FS001`** (LOW, spec-only) — confirmed `0/34` route-defs declare it, though the runtime behavior is correct via the central error handler.

---

## 5. Provenance and reliability problems in the source document

- **`fix/gap-190` does not exist in this repository.** `git rev-parse --verify fix/gap-190` fails outright. The source document's central "0 file diff" claims (`git diff fix/gap-190..develop --stat -- web/src`) and its "148/897+13/99" test-count baseline are attributed to a branch that cannot be diffed against in this checkout. Those specific commands could not have produced the output quoted.
- **Test counts don't match a fresh run.** Running `npm test` now yields `149/905`, `14/117`, `4/26` — all green, but numerically different from the document's `148 / 897+13 / 99`. Nothing is broken; the discrepancy indicates the source document's numbers were carried forward rather than freshly measured, consistent with the missing-branch problem above.
- **Citation accuracy is the core defect.** Of four specific `file:line` citations spot-checked in the prior review (`incident.ts:626`, `reports.ts:1346`, `partner.ts:132`, plus B4's `reports.ts:894`), all four pointed at the wrong code. The document's closing claim — *"All `file:line` citations absolute and re-readable via `Read` at that line"* — is demonstrably false for at least four load-bearing citations, and by extension untrustworthy for the ~150 citations that were not independently spot-checked here.

---

## 6. Net assessment

The source document's **conclusion** — that a CRITICAL race remains in `incident.ts`'s recovery-receipt path, and that a handful of MEDIUM/LOW process gaps remain — is directionally correct. Its **evidence** is not reliable: roughly two-thirds of its "still open" secondary findings are wrong (fabricated, already fixed, or citing code that doesn't exist), and its central bug's mechanism is mischaracterized in a way that would misdirect a reproduction test. Anyone acting on this class of document should re-derive each `file:line` before writing code against it, rather than trusting the citation.

**Confirmed to fix, in priority order:**
1. `incident.ts:436` — pass `forUpdate: true`, use the transaction's own read of `paymentId`. (CRITICAL, narrow, contained to this function.)
2. `partner.ts:176/344/456` — add same-party validation on each `replacesId` path, matching the party column each table actually has. (MEDIUM.)
3. `pg-error.ts` — give the three remaining generic-`P0001` raisers their own SQLSTATE, the way `FS001` was given to the archive guard. (MEDIUM, no urgency — currently a blast-radius risk, not a live bug.)

No code changes were made in the production of this document.
