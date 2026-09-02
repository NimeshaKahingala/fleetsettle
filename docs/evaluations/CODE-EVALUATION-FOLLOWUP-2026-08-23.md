# CODE-EVALUATION-2026-08-23.md — Follow-up: Validation, Fix Plan, Design

**Date:** 2026-08-23
**Branch at time of writing:** `docs/gap-171-172-scenario-testing`
**Purpose:** This document is a handover. It records (1) an independent verification of every claim in `CODE-EVALUATION-2026-08-23.md`, (2) the fix plan derived from that verification, (3) every decision made while refining that plan — including the reasoning and the examples used to reach each decision — and (4) in-progress design work for one item (GAP-173's late-fact flag). No code, migration, or doc change has been made yet. Everything below is planning and design only.

**How to use this doc:**
- **Part A** — read once to trust the bug list; it records which of the original report's claims survived independent verification and which did not.
- **Part B** — the plan to execute, in order. **Part B.1** carries implementation traps that change the shape of three fixes; read it before starting PR 5.
- **Part C** — why the plan looks the way it does, including why the PR order deliberately departs from the original report's severity ranking. Read before deviating, since several "obvious" alternatives were already considered and rejected for a stated reason.
- **Part D** — findings discovered during this review that are *not* in the original report.
- **Part E** — the completed design for GAP-173's late-fact flag, including rejected alternatives.
- **Part F** — what is still genuinely undecided and needs an answer before or during the relevant PR.

Nothing has been implemented — this is 100% pre-work.

---

## Part A — Verification of `CODE-EVALUATION-2026-08-23.md`

The original report (`CODE-EVALUATION-2026-08-23.md`, at repo root, written 2026-08-23 by an external evaluator "Muse Spark (opencode)") lists 29 numbered bugs (B1–B29) plus a 5-row docs-vs-SQL drift table. Before trusting it enough to plan work against, every citation was independently re-checked against the actual source at `HEAD` (`54bfd21` at evaluation time), using four parallel read-only sub-agents, each re-reading the cited file at the cited line and grading the claim ACCURATE / INACCURATE / PARTIALLY ACCURATE / FALSE.

### Overall verdict

**High trust.** Of 29 bugs + 5 docs-drift rows, only **one claim is confirmed false** (B23) and one has a **wrong mechanism but a still-valid conclusion** (B19). Everything else checked out, several were found to be *understated* (the real bug is worse than described). Line-number citations are correct to within 1–2 lines almost everywhere (usually pointing at a comment/JSDoc line immediately above the real line).

### Corrections to the original report

| Item | Original claim | Correction |
|---|---|---|
| **B23 — FALSE** | INV-28: `write_audit_log` trigger "not attached to the 19 money tables… pending" | Migration `0002_audit_log_writer.sql:73-91` runs a `DO $$` block that dynamically discovers every table with `posted_period_id` via a `pg_attribute`/`pg_class` catalogue query and attaches the trigger **at migration-apply time**. It is live today, not pending. The report quoted stale intent from `docs/engineering/data-model.md` (item "D-8") without checking that migration `0002` already implements exactly that task. **Drop B23 from all remediation lists.** |
| **B19 — mechanism wrong, conclusion still valid, actual bug is worse** | Two concurrent `submitInsuranceClaim` calls race past an app-level duplicate check and hit a DB unique constraint, producing an unwanted `500` instead of `409` | **No unique constraint exists at all** on `incident_recovery(incident_id, source)` or `insurance_claim.incident_id` anywhere in the migrations (confirmed by grep across all 30 migration files). So the race does not 500 — it **silently inserts a duplicate claim/recovery row**, with no error at all. This is worse than filed, and changes the fix: instead of "add an `isUniqueViolation` catch," the fix must first **add** the missing constraint (see B19 in Part B, PR 6), then the catch becomes meaningful. |
| **B4 — accurate but overstated severity** | `listAgeingBuckets` (`reports.ts:894-895`) uses `Date.parse` on `date`-only columns, described as timezone-fragile like other Colombo/UTC bugs in this report | `Date.parse` on a *date-only* ISO string (`"2026-08-23"`, no time component) is spec'd to parse as UTC midnight, and **both** operands (`asOfDate`, `effectiveDueOn`) are date-only strings parsed the same way — so the day-count arithmetic itself is correct; UTC has no DST to introduce drift. The real residual risk is **fragility** (this breaks the instant either string gains a time component) and whether the *caller* passes a correctly-computed business-today, not a live off-by-one bug today. **Reclassified LOW/hygiene, not MEDIUM/timezone-correctness.** |
| **B3 — undercounted** | "14 web files" use `new Date(\`${date}T00:00:00\`)` without a trailing `Z` (device-local-midnight bug) | Actual count via `grep -rn 'T00:00:00' web/src`: **15 files / 18 call sites**. The report's list of 13 named files is accurate as far as it goes, but misses two: `web/src/features/daily/ConfirmWeekGroupCard.tsx:19` and `web/src/features/leases/CollectPaymentSheet.tsx:28`. Both must be included in the PR 3 codemod. |
| **B24 — 2 of 6 sub-citations invalid** | Six OpenAPI route-defs allegedly omit a `400`/`409` response that the runtime can actually return | Two don't hold: `api/src/route-defs/vehicle.ts:71` (`listVehiclesRoute`) declares **no** `request` schema at all (no body/params/query) — there is nothing to validate, so no undocumented 400 is possible there. `vehicle.ts:235` (`archiveVehicleRoute`) — `archiveVehicle` → `setVehicleLifecycle` is a bare idempotent `UPDATE`, re-archiving is a silent no-op, **never** a 409 — the claimed missing "409 Already archived" response doesn't correspond to any real code path. The other four citations (`vehicle.ts:35`, `vehicle.ts:54`, `incident.ts:25`, `expense.ts:18`, `mileage-package.ts:12`) are valid. |
| **B22 — already resolved, mis-filed as open/HIGH** | INV-18 (`closure_summary_shown_at` never written) filed as a HIGH severity open bug, with `lease-closure.ts:214` as evidence that only wizard-ordering enforces it, not a DB gate | This exact issue was **already triaged and closed as `GAP-141`** (`TRACKER.md:293`, fixed before this report was written). `docs/engineering/data-model.md` was corrected to v1.1.11 to describe the real mechanism (call ordering, not a stored flag) and explicitly records the consequence: *"nothing server-side stops a direct API call skipping the summary."* Further: `docs/product/user-flows.md:600` states INV-18's intent directly — **"It does not block; it refuses to let you do it blind."** A hard server-side gate was never the design intent. **No fix needed. Optionally**, `closure_summary_shown_at` could be written (non-gating, audit-trail only) the first time `getLeaseClosureSummary` is called, turning a vestigial column into a genuinely useful one — but this is optional polish, not a bug fix. |
| **B28 — real pattern, but report omits the code's own justification** | `sumDepositsHeld` (`reports.ts:1073`) does a sequential N+1 loop calling `sumDepositMovements` per deposit | The N+1 pattern is real, but the code carries its own comment (lines 1062-1072) explicitly justifying it as a **deliberate, bounded** exception to the no-per-row-loop rule (one iteration per driver/customer with an *open* deposit — not the unbounded per-row pattern `IG §2` warns against). Keep in the performance PR, but don't treat it as an oversight — it's a documented trade-off that may just need re-confirming, not blindly "fixing." |
| **B11 — understated** | `allocateAgainstOldest` (`offset.ts:220`) never asserts `remaining === 0` after allocation | Worse than stated: `allocateAgainstOldest` **returns `Promise<void>`** — there is no return value to assert against. The caller (`createOffset`, `offset.ts:99`) cannot check `remaining === 0` even if someone tried; the function signature has to change, not just a call site. |
| **B14 — understated** | `payment-correction.ts:152` calls `findObligationForBusiness` without passing `forUpdate: true` | Worse than stated: `findObligationForBusiness` (`api/src/queries/obligation.ts:143-161`) **has no `forUpdate` parameter in its signature at all** — this isn't a forgotten argument, the function offers no locking capability whatsoever. (Contrast with `findOutstandingObligationsForDriver`/`findOutstandingObligationsForParty`/`findObligationForDepositApply` in the same file, which already support `forUpdate` per the existing `GAP-5a` pattern.) |
| **B18** | Fragile `P0001` + English-substring matching in `isPeriodClosedViolation`/`isSharesNotFullViolation` | Confirmed accurate, and the risk is **systemic**: two more matchers in the same file (`isBusinessHasNoOwnerViolation`, `isPlatformHasNoAdminViolation`) use the identical fragile pattern — 4 total, not 2. |

### Everything else (B1, B2, B5–B10, B12, B13, B15–B17, B20, B21, B25–B27, B29)

Confirmed **accurate** against current source, modulo trivial ±1–2 line offsets (citation points at a comment/JSDoc/declaration line, the real logic is 1–2 lines below). Not re-litigated here — trust the original report's `file:line` citations for these, they hold.

**One nuance worth preserving on B7**, so nobody "fixes" the wrong half of it: the report frames B7 as two problems — the `-0` wire round-trip (`parse("-0") → 0n`, but `toWire(0n) → "0"`) **and** `fromInput` being more permissive than `parse`. Only the first is a bug. `parse` handles **wire format** (integer minor units) and `fromInput` handles **human-typed major-unit decimals** — they are deliberately different formats with different grammars, documented as such in `packages/shared/src/money.ts`. Making them agree would be a regression, not a fix. **PR 8 should tighten the `WIRE` regex to reject `-0` and nothing else.**

### Docs-vs-SQL drift table (original report §4) — all 5 rows verified

All five rows are accurate: the docs genuinely are out of step with the migrations. Recorded here in full because the original report's §4 is terse and these need a remediation PR that the original report's §6 recommended but which had no PR assigned until now (see **PR 9** in Part B).

| # | Doc says | Actual SQL / schema | Verified detail |
|---|---|---|---|
| 1 | `business_creation_request.status` has `DEFAULT 'pending'` (`data-model.md:282`) | `0030_platform_tier.sql:43-44` has **no** `DEFAULT` | Migration line 38 carries an explicit comment: `-- No DEFAULT — insertBusinessCreationRequest sets 'pending' explicitly.` (deliberate — it avoids a third repetition of the same literal in one table definition). But `api/src/db/schema.ts:90` has `.default("pending")`, matching the **doc** rather than the migration. Three-way disagreement; **the migration is the truth, so the fix direction is to remove the `DEFAULT` from the doc — not to add one to the migration.** See the latent trap below. |
| 2 | `insurance_claim` / `incident_recovery` DDL blocks omit `business_id` (`data-model.md:911-924`, `:927-935`) | `0004_business_id_on_audited_child_tables.sql:23` adds it to `incident_recovery`, **line 24** adds it to `insurance_claim` | Report cited "line 23" for both; they are on adjacent lines 23–24. `schema.ts:749` (report said 748 — 748 is the `id` field). |
| 3 | `expense` DDL omits `voided_by` (`data-model.md:847`) | `0007_expense_voided_by.sql:10` adds it | `schema.ts:525` (report said 523 — 523 is `voidedAt`). Migration 0007's own header comment already documents that DM's `expense` DDL only ever wrote two of the void trio — self-documented drift. |
| 4 | `offset_allocation` DDL omits the void trio (`data-model.md:1173-1178`) | `0024_offset_allocation_void.sql:12-14` adds `voided_at`/`voided_reason`/`voided_by` | `schema.ts:574-576` (report said 572 — 572 is a comment line). |
| 5 | `excess_borne_minor` / `received_amount_minor` lack `CHECK >= 0` | Confirmed — but **the docs and the migration agree with each other here** | **This is not a docs-drift item at all** — it is the same underlying missing-constraint fact as **B20**, correctly (if incompletely) reflected in the docs. Fix it via B20 in PR 6; do **not** also file it as a doc sync. |

**Latent trap found while verifying drift row 1 (not in the original report, and not a docs-only issue).** `api/src/db/schema.ts:90` declares `.default("pending")` on a column whose database definition has **no** `DEFAULT`. It is inert today only because the single writer, `insertBusinessCreationRequest` (`api/src/queries/platform/business-creation-request.ts:36`), hard-codes `status: "pending"` on every insert:

```ts
await db.insert(businessCreationRequest).values({ ...values, status: "pending" });
```

If any future insert path omits `status` and trusts Drizzle's declared default, the column is `NOT NULL` with no DB default and the insert fails at runtime — a failure that unit tests using a mocked DB would not catch (and this repo forbids mocking the DB precisely for this class of reason, per `api/CLAUDE.md`). **PR 9 should drop `.default("pending")` from `schema.ts:90` as well as fixing the doc**, so all three sources agree with the migration. This is a small change but it is a code change, not a docs change — worth noting so PR 9 isn't scoped as docs-only.

### Full per-batch verification detail (for anyone who wants the raw evidence)

Four parallel verification passes were run, each re-reading the actual files:
- **Batch 1** — B1 through B9 (core correctness bugs)
- **Batch 2** — B10 through B17 (concurrency/TOCTOU races — these carry the report's CRITICAL/HIGH ratings)
- **Batch 3** — B18 through B21, plus the §4 docs-drift table
- **Batch 4** — B22 through B29, plus spot-checks of Areas 6–10 (schema integrity, invariant traceability, API contract, offline/mutation handling, performance)

All four came back with specific `file:line` evidence quoted for every claim; the corrections above are the only ones that survived cross-checking. If a future session needs the raw per-claim evidence (exact code quotes for all 29+5 items), it was captured in this conversation's transcript but is not reproduced verbatim here for length — re-running the same four-way verification against current `HEAD` is the reliable way to regenerate it if needed (the code may have moved on).

---

## Part B — Refined Fix Plan

Ordered by dependency and risk, **not** strictly by the original report's severity ranking — see *"Why the PR order is not the original report's severity order"* at the top of Part C for the full reasoning. Each PR targets `develop` via a feature branch (never a direct push to `develop` or `main` — both auto-deploy). Next migration number is **`0031`**; next `TRACKER.md` gap id is **`GAP-174`**.

**Before starting PR 5, read Part B.1 — three of its findings change the shape of the fix.**

| PR | Scope | Bugs closed | Risk | Status |
|---|---|---|---|---|
| **1** | **W-35 completion** (late-posted-fact linkage) + GAP-173 design | B1, B9, GAP-173, + a newly-found CSV-export gap (see Part D) | Low | **Design done for GAP-173 (Part E). Not started.** |
| **2** | Voided-row filters | B2, B16 | Low | Not started |
| **3** | Timezone codemod | B3 (15 files / 18 sites — corrected count) | Low | Not started |
| **4** | Zod positivity on money inputs | B21 | Low | **Pre-flight validated clean on QA (Part C, Q1). Not started.** |
| **5** | Locking + transaction-boundary fixes + tenant scoping, **single PR** | B5, B10, B11, B12, B13, B14, B15, B17 | **Critical** (highest-value PR — closes every CRITICAL/HIGH concurrency bug) | Not started. **Needs a fresh disposable Neon branch for interleaved-transaction tests (user confirmed — Part C, round 3, Q3).** |
| **6** | Migration `0031` | B20 (`CHECK >= 0`, not `> 0` — see Part C, Q1), B19 (partial unique index `WHERE voided_at IS NULL` + `isUniqueViolation` catch), B18 (pin trigger messages in a regression test) | Medium | Not started. **Needs the same QA-branch pre-flight already run for B20 (Part C, Q1) — done, clean.** |
| **7** | Performance | B26, B27, B29 (including addressing `day-card-generation`'s cron scan having no `business_id` filter at all) | Medium | Not started |
| **8** | Hygiene | B4 (downgraded), B6 (`MAX_SAFE_INTEGER` guard, mirror `chartAxis.ts`'s existing pattern), B7 (reject `-0` round-trip **only** — see Part A's B7 nuance), B24 (the 4 valid citations only), insurer-recovery label copy fix | Low | Not started |
| **9** | **Docs-vs-SQL sync** — bring `docs/engineering/data-model.md`'s DDL blocks back in line with `api/migrations/*.sql` for drift rows 1–4 (Part A). Row 5 is B20, fixed in PR 6, **not** here. **Not docs-only:** also drop `.default("pending")` from `api/src/db/schema.ts:90` (see the latent trap under Part A's drift table) | (docs-drift table) | Low | Not started. Was recommended by the original report's §6 item 5 but had **no PR assigned** until this review. |

**Closed — no fix needed:**
- **B8** — by design; `voidAdjustment`'s error message already explains the offset-first requirement.
- **B22** — already resolved as `GAP-141`; see Part A correction above.
- **B23** — false claim; see Part A.
- **B25** — correctly deferred to phase P12 (M-12 offline queue); code comments already say so.
- **B28** — documented, deliberate, bounded trade-off; re-confirm during PR 7, don't "fix" blindly.

---

## Part B.1 — Implementation traps (read before writing any code for PR 5)

These are technical findings from the planning discussion that do **not** appear in the original report and that would cost real time — or produce a fix that only *looks* correct — if rediscovered late. Three of them concern PR 5, the highest-risk PR.

**B10 — locking `deposit_movement` rows is the wrong fix and will not work.** The obvious reading ("add `FOR UPDATE` to `sumDepositMovements`") fails: under `READ COMMITTED`, row locks on *existing* `deposit_movement` rows do **not** block a concurrent `INSERT` of a *new* movement — PostgreSQL has no predicate locking at this isolation level. Two concurrent draws would still both pass the `amount > held` check. **The lock must be taken on the parent `deposit` row** (`SELECT … FROM deposit WHERE id = ? FOR UPDATE`) *before* summing movements, and **every** writer that inserts into `deposit_movement` must take that same parent lock, or the serialization has a hole. Enumerate all `deposit_movement` writers before implementing — this is not a one-line change.

**B13 — locking the party row is necessary but not sufficient.** Moving `assertArchivable` inside the transaction and adding `FOR UPDATE` on the driver/customer row only serializes archive-vs-archive. It does **not** serialize archive-vs-new-money, because the money-insert paths (`obligation`, `deposit`, `advance`) do not currently take any lock on the party row — so a concurrent obligation insert can still land between the re-check and the archive. Two viable designs, and this is a **decision, not a mechanical fix**: (a) have money-write paths take `FOR SHARE` on the party row, or (b) enforce the archived-state rule with a DB trigger. Option (b) is more consistent with this repo's "the trigger is the truth" convention (CLAUDE.md), but is a larger change.

**B14 — concrete mechanism, and the pattern already exists.** `findObligationForBusiness` (`api/src/queries/obligation.ts:143-161`) has **8 call sites** (2 in handlers using `reader`, 6 in domain using `tx`). The `forUpdate` pattern needed is already used **4×** in this codebase — `obligation.ts:192`, `:290`, `:334` and `trip.ts:258` — and its shape is: a `forUpdate = false` default parameter plus `const rows = await (forUpdate ? query.for("update") : query);`. Following it keeps the 2 handler read sites unchanged (default `false`) while the 6 domain sites opt in. For the `rowCount === 1` assert, Drizzle's portable idiom across both the HTTP and Pool drivers is `.returning({ id: obligation.id })` and then checking `result.length === 1` — not a driver-specific `rowCount` property.

**B5/B15 — the fix is an argument swap, not a signature change.** `resolvePeriodLinkage` is declared as `resolvePeriodLinkage(db: ReadDb, …)` (`api/src/queries/accounting-period.ts:57-61`), and a transaction handle already satisfies `ReadDb` — which is exactly why `deposit.ts:46` and `payment.ts:61` can already call it correctly with `tx`. So fixing the offending sites means passing `tx` instead of `writer` and moving the call inside the transaction callback. No signature or type changes required.

**B5 spans more files than the report's headline citation.** The original report's §3 detail cites `expense.ts:129` and `incident.ts:251`, but its own §10 consolidated tracker row for B5 lists **four** sites: `expense.ts:129`, `incident.ts:251`, `advance.ts:53`, `partner.ts:120`. Separately, §9's Area 1 flags the same out-of-transaction shape in two *void* paths — `voidWriteOff` (`write-off.ts:255`, which is B12) and `voidAdvance` (`advance.ts:269`, which is **not** separately numbered anywhere). Sweep for the pattern rather than fixing only the two headline files, or `advance.ts:269` will be missed entirely.

---

## Part C — Decision Log

This is the reasoning trail. Recorded in the order decisions were actually made, because later decisions sometimes depend on earlier ones (e.g., Q2's "single PR" decision in round 2 depended on investigation done specifically to answer it).

### Why the PR order is not the original report's severity order

The original report's §10 orders remediation strictly CRITICAL → HIGH → MEDIUM → LOW. This plan deliberately does **not** follow that, and the reasoning should survive handover:

**Every CRITICAL and HIGH bug in the report (B10–B14) is a concurrency race.** A race requires two simultaneous writers. Per `CLAUDE.md`, production *"is not yet open to real users… internal testing only,"* and the business itself is **two partners, one of whom does all the data entry**. Real write concurrency today is approximately one writer. So the CRITICAL races have **near-zero live exposure right now** — while remaining absolute go-live blockers, which is why they are still PR 5 and not PR 8.

**By contrast, B1, B2 and B16 are deterministically wrong on every single read**, with no concurrency required. A utilisation report that counts voided allocation days as earning days (B2) is wrong 100% of the time, today, on a system whose entire stated promise is *"being believed about money."*

Hence: deterministic wrongness first (PR 1–2), cheap self-guarding mechanical fixes next (PR 3–4), then the high-risk concurrency work (PR 5) with proper test infrastructure, then hardening and performance. If the go-live date compresses, **PR 5 is the one that cannot be dropped** — the others degrade gracefully, a corrupted deposit balance does not.

### Round 1 — five original open questions, all resolved

**Q1 (round 1) — Should `positiveMoneyWireSchema` reject zero on `expense.amountMinor`, `arrangement.rentAmountMinor`, `incident.agreedAmountMinor` (B21)?**

*Example used:* A charter with `agreedAmountMinor = 0` (goodwill, e.g. a favour for a relative) vs. the same charter recorded at full price (e.g. Rs 15,000) with a full waiver, reason `goodwill`.

*Finding:* `docs/product/user-flows.md:573` settles this directly — *"A waiver is a recorded adjustment, never a deletion — the month shows the 340 charged and the 340 waived,"* and auto-waived amounts feed the annual "goodwill given" total (`UC-77`, `user-flows.md:1017`), described as *"the number this feature exists to produce."* Recording as `0` directly bypasses the very report this exists for.

*Decision:* **Reject zero on Zod input schemas for these three fields. Do NOT tighten the DB `CHECK` to `> 0`** — B20's separate DB-level fix must stay `>= 0`, because accumulator columns like `insurance_claim.received_amount_minor` and `incident_recovery.received_amount_minor` legitimately start at `0` (`schema.ts:754,767`, `.default(0n)`) before any money has arrived. Conflating B20 (DB CHECK, must allow 0) and B21 (Zod input validation, must reject 0 for these three specific *input* fields) would break claim creation.

*User confirmed:* "agreed, 0 can be rejected" — but asked to validate practical use cases first before adding any DB constraints. See "Round 3, Q2" below for the pre-flight that was then run.

---

**Q2 (round 1) — Does the system support recording an insurer's partial payout in two steps (e.g. Rs 250,000 in November, another Rs 50,000 later), and if so, is a unique constraint on `(incident_id, source)` safe (B19)?**

*Investigation:* Read `settleInsuranceClaim` (`api/src/domain/incident.ts:665-710`). Confirmed: it does `receivedAmountMinor: input.receivedAmountMinor` — an **assignment**, not `+=`. Re-calling settle with a new figure **overwrites** the existing claim/recovery row's received amount; it does not insert a second row. The UI (`SettleInsuranceClaimSheet.tsx:53`) prefills the field with the *existing* `receivedAmountMinor`, so re-opening the sheet after a partial payout shows the prior figure ready to be topped up to the new cumulative total.

*Decision:* **Yes, the system already supports this correctly (overwrite/cumulative, not additive-per-call). A partial `UNIQUE` index is therefore safe and does not block legitimate multi-step settlement:**
```sql
CREATE UNIQUE INDEX incident_recovery_one_per_source
  ON incident_recovery (incident_id, source)
  WHERE voided_at IS NULL;
```
The `WHERE voided_at IS NULL` clause is **not optional** — money records are append-only, and corrections void-and-replace (W-50); a plain unconstrained `UNIQUE` would make a wrong claim permanently uncorrectable once one row exists per source.

*Secondary finding (copy bug, new — not in the original report):* `RecoveryReceivedSheet.tsx:75` (customer-sourced recovery) labels the field **"Received so far"** — correctly signals cumulative/overwrite semantics. `SettleInsuranceClaimSheet.tsx:107` (insurer-sourced) labels the identical-semantics field **"Amount received"** — reads as "this payment," not "running total." The UI prefill (see above) masks the ambiguity in practice, but the label itself is inconsistent with reserved-vocabulary discipline. **Recommended fix: rename to "Received so far" in `SettleInsuranceClaimSheet.tsx:107`.** *User confirmed ("good") — this is now item 4 in PR 8.*

*User confirmed:* "agreed."

---

**Q3 (round 1) — What's the plan for B1 + B9, and why bundle them?**

*Example used (worked through with the user):* Bus accident 3 July. Claim submitted for Rs 400,000 in July. July closes 31 July. Insurer settles Rs 250,000 on 15 September.
- Correct behaviour: post to September (the only open period), with `belongs_to_period_id` pointing back to July. September's report shows it as a late fact belonging to July.
- Actual behaviour today (B1): `submitInsuranceClaim` sets only `posted_period_id`; `belongs_to_period_id` stays `NULL`. DM §15's month-by-month bucketing therefore counts the Rs 250,000 **as September business**, making July look permanently unrecovered and September look like a windfall.
- The paired `incident_recovery` insert (same transaction, `incident.ts:628`) **does** set `belongs_to_period_id` correctly — so today the two tables describing the same incident already disagree with each other the moment the claim is submitted.

*Second example (B9):* Go-live 1 July. In September, an opening-balance deposit entry is found wrong (should have been Rs 40,000, was entered as Rs 50,000). The correction reverses a movement dated 30 June. July and August are now closed. **Today:** the entire `saveOpeningBalance` call throws a hard `409 PERIOD_CLOSED` with **no fallback path** — the number can never be corrected. `docs/engineering/data-model.md:252` already prescribes the fix: *"Once closed, the only route in is W-35's — post to the open period with `belongs_to_period_id` pointing back."*

*Decision:* Bundle B1 + B9 + the already-filed `GAP-173` (late-posted facts never get their promised report flag) into **one PR (PR 1)** — same root cause (an incomplete W-35 implementation), same fix shape (use the `belongsToPeriodId`/`postedPeriodId` pair `resolvePeriodLinkage` already produces), same review. No doc change required — `docs/engineering/data-model.md:206-210,252` already specifies the correct behaviour; only the code is out of step with its own spec.

*Design for GAP-173 was requested and completed later in the session — see Part E.*

*User confirmed:* "Agreed, explain me the full plan with example" (satisfied by the above).

---

**Q4 (round 1) — Should `updateObligationSettled` etc. assert exactly 1 row updated after adding `AND business_id = ?` (B14)?**

*Example used:* A bug passes an `obligationId` belonging to business B while the request is scoped to business A. **Today:** `UPDATE obligation SET settled_minor = … WHERE id = <B's id>` succeeds — business A's payment silently settles business B's obligation, corrupting both tenants' books with no error and no log. **After adding `AND business_id = ?` alone (no assert):** the `UPDATE` matches 0 rows — A's payment records as settled locally, but B's obligation stays unpaid. Silent *divergence* instead of silent *corruption* — better, but still silent and still wrong.

*Decision (recommended and later reaffirmed):* Add the `business_id` predicate **and** assert `rowCount === 1`. Once PR 5's locking work (`FOR UPDATE`) lands, a legitimate 0-row result becomes unreachable via any correct call path — so a 0-row result after that point can only mean a tenancy bug or an impossible concurrent-delete race, and must **throw an internal-class error (500, logged with stack trace) — never a 4xx**, which would incorrectly blame the caller for a server-side fault. This mirrors CLAUDE.md's "reports degrade to not available, never to zero" principle, applied to writes: fail loudly, never write nothing quietly.

*User confirmed ("lets do this")* and asked for the blast-radius/impact analysis, which was run via the codebase's GitNexus MCP tooling (required before editing any symbol, per this repo's standing rule):

**Impact analysis result for `updateObligationSettled` — RISK: CRITICAL.**
- **44 total impacted symbols**, **11 direct callers**, **12 execution flows affected**, **3 modules touched** (Queries, Handlers, Domain).
- Direct callers (depth 1): `applyCreditForward`, `recordDepositMovementTx`, `voidDepositMovement`, `recordRecoveryReceived`, `deductFromDriverFeeTx`, `allocateAgainstOldest` (both the `offset.ts` and `payment.ts` copies), `voidOffset`, `unwindAllocations` (`payment-correction.ts`), `recordWriteOff`, `voidWriteOff`.
- Reached flows include payments, deposits, offsets, write-offs, recoveries, trip close, mileage assessment, lease closure, post-closure charges, `confirmDay`, and **billing-period generation via the `scheduled` cron entrypoint**.
- **Cron-path risk initially flagged, then investigated and withdrawn:** the cron path (`scheduled` → `generateNextBillingPeriodTx` → `applyCreditForward` → `updateObligationSettled`) has no JWT-derived `businessId`. Traced directly: `billing-period.ts:103` calls `applyCreditForward`, whose signature (`credit-forward.ts:52`) already takes `businessId` as a **required positional parameter**, and the codebase typechecks clean — so the cron path already has a `businessId` in scope at every hop. **Not a blocker.**
- **All 11 direct callers already carry `businessId` in scope** — verified by reading each function's signature directly (`credit-forward.ts:52`, `deposit.ts:134` `recordDepositMovementTx(tx, input)` where `input.businessId` exists, `deposit.ts:282` `voidDepositMovement`, `incident.ts:372` `recordRecoveryReceived`, `offset.ts:153` `deductFromDriverFeeTx`, `offset.ts:211`/`payment.ts:104` both `allocateAgainstOldest` variants, `offset.ts:271` `voidOffset`, `payment-correction.ts:139` `unwindAllocations`, `write-off.ts:57`/`write-off.ts:252` `recordWriteOff`/`voidWriteOff`). This directly enabled the "do it in one PR" decision in round 3, Q2 below.

*User confirmed:* "lets do this. let me know the impact" (satisfied by the above).

---

**Q5 (round 1) — Should INV-18 (`closure_summary_shown_at`) stay deferred through go-live (B22)?**

*Decision:* Moot — see Part A's B22 correction. Already resolved as `GAP-141` with a documented, deliberate design (call-ordering enforcement, not a DB gate). No action needed beyond the correction already recorded.

*User confirmed:* "ok."

---

### Round 2 — four new questions raised while writing the refined plan, resolved

**"Is a mileage-only lease real?"** (raised to check whether `rentAmountMinor` could legitimately be `0` for a lease billed purely per-km, which would exclude it from PR 4's scope)

*User answered:* **"No."** → `rentAmountMinor` stays in scope for the Zod-positivity change (PR 4), no carve-out needed.

---

**"PR 5b staging — ship the `business_id` param/assert with the assert initially off, enable it in a follow-up — acceptable?"**

*User pushed back:* "do everything in one go. can we do it?"

*Investigation performed specifically to answer this (see Q4/round1 impact analysis above, re-used here):* Confirmed all 11 direct callers already have `businessId` in scope — no call site needs a *new* value threaded in, only an existing one passed through. Because the new parameter is made **required** (not optional), TypeScript's compiler enumerates every call site automatically — there is no way to silently miss one, which is the actual risk a staged rollout exists to avoid. **The one real ordering constraint that remains:** locks (`FOR UPDATE`) must land in the same PR *before* the assert is enabled — if the assert ships without the lock, a legitimate concurrent `void` could produce a 0-row update and turn a previously-successful request into an unwarranted 500.

*Decision:* **Yes — one PR (PR 5), internally sequenced** (locking first, then scoping + assert), rather than two staged PRs. Former "PR 5a"/"PR 5b" are merged.

---

**"3" (round 2, i.e. "should I mint a fresh disposable Neon branch when we get to PR 5's concurrency tests?")**

*User answered:* **"Yes."** → Confirmed for when PR 5 actually starts. (Per this session's standing project memory: `TEST_DATABASE_URL` in `api/.dev.vars` goes stale when its Neon branch expires — a fresh one needs to be minted at that time, not now.)

---

**"4" (round 2, i.e. confirm the insurer-recovery label fix from Q2/round1)**

*User answered:* **"good."** → Confirmed, folded into PR 8.

---

### Round 3 — four more questions, resolved (including one still technically open — see below)

**Q1 (round 3) — How real should PR 5's concurrency tests be, given they're proving fixes to actual races (B10, B12, B13 are CRITICAL)?**

*Options presented:* (a) real interleaved-transaction tests against live Postgres for the three CRITICALs only (B10 deposit double-draw, B12 write-off void TOCTOU, B13 party-archive TOCTOU), correctness tests + code review for the rest; (b) correctness tests + review for everything, no interleaving tests; (c) real interleaving tests for everything.

*User answered:* **"a"** — confirmed. Only B10/B12/B13 get genuine two-connection interleaved-transaction tests; the remaining PR 5 items (B5, B11, B14, B15, B17) get correctness tests plus code review.

---

**Q2 (round 3) — Where do the B20 pre-flight queries (checking for existing negative/zero rows before adding CHECK constraints) run, given production has no data?**

*User answered:* "prod does not have any data at all. do evaluate the qa if u need." → **QA branch was evaluated directly** (see below — this is now done, not just planned).

**QA pre-flight — completed, results recorded here in full since this gates PR 4 and PR 6:**

Connection details (for reuse by a future session, via the Neon MCP tools):
- Neon org: **FleetSettle** (`org-cold-rice-64493165`)
- Neon project: **fleetsettle** (`spring-sunset-96946055`)
- QA branch: **`qa`** (branch id `br-square-sound-afb68wft`)
- Production branch: **`main`** (branch id `br-odd-cherry-afx5394i`) — confirmed empty, not used for pre-flight.

Column-to-table mapping (confirmed by querying `information_schema.columns` directly, since B20's citations reference migration line numbers, not table names — this mapping matters for writing the actual migration in PR 6):

| Column | Table |
|---|---|
| `rent_amount_minor` | `billing_period` (also on `lease`, separately) |
| `allowance_km` | `billing_period` |
| `mileage_daily_limit_km` | `lease` |
| `excess_borne_minor` | `insurance_claim` |
| `received_amount_minor` | `insurance_claim`, `incident_recovery` |
| `combined_allowance_km` | `mileage_assessment` |
| `apportioned_km` | `mileage_assessment_split` **— not on the parent `mileage_assessment` table**, a detail the original report's citation didn't distinguish |
| `agreed_amount_minor` | `incident_recovery`, `trip` |

Negative-value counts (all must be 0 before PR 6's `CHECK >= 0` migration lands, or the migration fails outright on real rows):

```
bp_rent_neg = 0, bp_allow_neg = 0, lease_limit_neg = 0,
ic_excess_neg = 0, ic_recv_neg = 0, ir_recv_neg = 0,
ma_allow_neg = 0, mas_appt_neg = 0
```
**All zero. Clean. No blocker for PR 6.**

Zero-value counts (relevant to PR 4's Zod positivity change — a legitimately-existing zero row would mean users can no longer *edit* that record once the schema tightens):

```
expense_zero = 0 (of 13 expense rows)
lease_rent_zero = 0 (of 3 lease rows)
trip_agreed_zero = 4 (of 10 trip rows)  ← investigated further, see below
ir_agreed_zero = 0
```

**The `trip_agreed_zero = 4` result was investigated, not just counted.** Pulled the 4 rows directly:

| id | status | customer_id | driver_fee_minor | date |
|---|---|---|---|---|
| `019fd80e-…` | closed | **null** | 0 | 2026-08-06 |
| `019fdfd9-…` | closed | **null** | 0 | 2026-08-08 |
| `019fe41f-…` | closed | **null** | 0 | 2026-08-10 |
| `019fe449-…` | booked | **null** | 0 | 2026-08-11 |

All four have **no customer attached** (`customer_id IS NULL`) and **zero driver fee too** — not just zero fare. Single-day trips, all created in the first week of QA testing (6–11 Aug 2026). This is the signature of QA smoke-test/seed data, not a real "we charged nothing for this charter" business scenario — a real zero-fare charter would still have a real customer and (per CLAUDE.md's rules) likely a nonzero driver fee, since the driver is still paid regardless of what the customer was charged.

**Conclusion: QA pre-flight is clean. Nothing blocks PR 4 or PR 6.** No carve-out or special-casing needed for existing data.

---

**Q3 (round 3) — "Assert failure = 500, confirming." — user's reply: "what should be the action?"**

**This question is not fully closed.** The original phrasing was posed as a confirmation-seeking statement ("I'd recommend throwing... flagging explicitly"); the user's reply asked for a plain, decided answer rather than a request for sign-off, but no explicit "yes, do that" was given afterward before the conversation moved on to other topics (the QA investigation above, then the GAP-173 design in Part E). **Restating the recommendation plainly, as the user asked, for explicit confirmation by whoever picks this up:**

> **Recommended action:** when `updateObligationSettled` (or its siblings gaining the same `business_id` scoping in PR 5) matches 0 rows after acquiring the row lock, throw an internal-class error — HTTP `500`, error code `INTERNAL_ERROR`, logged server-side with a full stack trace — never a `4xx`. A 0-row result at that point (post-lock, post-scoping) cannot be legitimate user error; it can only mean a tenancy bug slipped past every earlier guard, or a genuinely impossible concurrent-delete race. Treating it as a client error would misattribute a server-side data-integrity fault to the caller.

This is carried forward into **Part F (open questions), item 1** as an item requiring an explicit go/no-go, since it changes PR 5's error-handling shape and is worth a clean "yes" before implementation starts.

---

**Q4 (round 3) — GAP-173's report-flag scope: a small badge on affected rows, or a full late-facts report section?**

*User answered:* **"lets do option 1"** (the badge, not a new report section). → This became the scope for the design work in Part E.

---

## Part D — New findings surfaced during Q&A (not present in the original report)

These were discovered while investigating the five original open questions and while doing the GAP-173 design. None are yet triaged into the fix plan with a PR number, except where noted.

1. **Insurer-recovery label copy asymmetry** (found answering Q2/round1). `SettleInsuranceClaimSheet.tsx:107` says "Amount received"; the semantically-identical `RecoveryReceivedSheet.tsx:75` (customer-sourced recovery) says "Received so far." Both fields are cumulative/overwrite, but only one label says so. **Confirmed for fix, now in PR 8.**

2. **`listTransactionsForDateRange` (`api/src/queries/reports.ts:1609-1629`) does not include insurance claims, incident recoveries, or deposit movements at all.** It only pulls `rent`/`daily_amount`/`mileage_excess` obligations, `driver_fee`/`management_fee` obligations, closed trips, and expenses. This means the CSV export (`ExportTransactionsScreen.tsx`, the only consumer of this query) is silently missing entire transaction categories today — independent of, but related to, the B1/B9/GAP-173 cluster. **Not yet triaged to a PR** — see Part D open question 1 below.

3. **`ExportTransactionsScreen.tsx` is the only place `listTransactionsForDateRange`'s rows are consumed, and it renders nothing in-app** — it triggers a CSV download only (`api.getBlob` → `saveBlob`, browser-native file save). There is currently **no in-app screen that displays individual transaction line items** anywhere in the product. `ReviewThisMonthScreen.tsx` and `VehicleMonthReportScreen.tsx` both display only per-vehicle **rollup totals** (via `VehiclePerformanceCard`, `ReportTable` with vehicle-level rows), never individual transactions. This directly shapes GAP-173's design — see Part E.

4. **No screen displays individual `deposit_movement` rows** — only aggregate held/refunded totals per deposit. This means B9's fix (the opening-balance reversal gaining `belongsToPeriodId`) currently has **no in-app surface to badge at all** — see Part E and Part D open question 2.

---

## Part E — GAP-173 design (the late-fact flag) — DESIGN ONLY, NOT IMPLEMENTED

**Scope, as decided (Part C, round 3, Q4):** a badge on affected records, not a new report section.

### Alternatives considered and rejected

Recorded per this repo's standing convention (`CLAUDE.md` → *"Record what you did not take"*; `.claude/rules/docs.md` makes it the first thing that erodes), so the same options aren't re-proposed later.

- **`Provisional` (`web/src/components/Provisional.tsx`) — rejected, and this is the important one.** It is the obvious candidate: it exists, it's in the UI inventory, and it's the established *"this number is not final"* treatment (striped 4px leading edge), already used for pending insurance recoveries among other things. **But it says the wrong thing.** A late-posted fact is **not** provisional — the money definitively arrived, the figure is final and settled. It simply *belongs to a different month than the one it landed in*. Using `Provisional` would tell the owner a settled figure is still estimated, which is a worse lie than showing nothing. Different fact, different treatment.
- **A new bespoke `LateFact` component — rejected.** `web/CLAUDE.md` is explicit: *"Needing something new is usually a signal that the flow has drifted past U-2; re-check it before adding to the inventory."* `Badge` covers this exactly, with an existing precedent on the very screen that needs it.
- **`SyncChip` shape — rejected as a model.** It's a chip, but it is semantically bound to the M-12 offline-queue feature ("Not yet saved") and self-hides when `synced` is true. Wrong domain; noted only because it was examined as a possible pattern source.

### Existing component found and reused (no new component needed)

`web/src/design/primitives/Badge.tsx` — already built, already in the UI inventory (`docs/design/ui-ux-guidelines.md:433`), already used elsewhere for exactly this kind of "state that otherwise reads as plain muted text" purpose (its own doc comment). Variants: `brand` / `good` / `warning` / `serious` / `critical` / `neutral`, always paired with the same word the screen already shows (per **M-15**: colour never carries meaning alone). `IncidentScreen.tsx` already renders two badges today — incident status (line 227) and claim status (line 92) — establishing direct precedent for adding a third, adjacent badge for the late-fact flag.

### Design 1 — per-record detail screens (e.g. `IncidentScreen.tsx`)

```tsx
{claim.belongsToPeriodId !== null && (
  <Badge variant="neutral">Belongs to {formatPeriodLabel(claim.belongsToPeriodId)}</Badge>
)}
```

- **Variant: `neutral`** (hairline border, `text-ink-muted`) — deliberately the quietest variant available. This is informational metadata about *when* a fact belongs, not a warning; nothing is wrong with a late-posted fact, it's simply dated differently than when it was recorded. Matches CLAUDE.md's "reports degrade to not available, never to zero" register — informative, not alarming.
- **Copy: "Belongs to \<Month Year\>"** — checked against the reserved-vocabulary rule (U-6/M-25: no "accrual", "posted", "allocation", "receivable", etc. in user-facing text). This phrasing avoids raw accounting terms and reads in the same plain-English register `user-flows.md:600` already uses to gloss INV-18 ("it refuses to let you do it blind").
- Applies to `insurance_claim.belongsToPeriodId` (once B1 sets it) shown on `IncidentScreen.tsx`, and in principle to any other record carrying a non-null `belongsToPeriodId`.

### Design 2 — CSV export (`listTransactionsForDateRange` / `ExportTransactionsScreen.tsx`)

A `Badge` doesn't reach this surface — CSV has no colour, and (per Part D finding 3) there is no in-app table rendering these rows at all today. Instead: **add a `belongsToPeriodId`/period-label column to `TransactionRow`, populated only for late facts, blank otherwise.** This is the actual accountant-facing surface (`ExportTransactionsScreen.tsx:65`: *"a year of transactions … for an accountant, a tax filing, or a bank"*) where a late claim being silently misattributed to the wrong month would actually cause a real external-facing error (e.g. in a tax filing).

### Open items from the design (these become Part F items 2, 3 and 4)

Three questions came directly out of doing this design and are not yet answered. They build on the findings recorded in Part D above, and are restated as actionable items in Part F below:
1. Whether pulling insurance/deposit-reversal rows into `listTransactionsForDateRange` (Part D finding 2) belongs inside PR 1's scope or should be its own follow-up gap — it's the same root cause but meaningfully more surface area (new query joins, `TransactionRow` shape change) than the two-line spreads B1/B9 need.
2. Whether B9 (the opening-balance/deposit reversal) has **any** UI surface to attach a badge to at all, given Part D finding 4 (no per-movement deposit view exists in-app today). If none exists, B9's fix might end up being CSV-column-only, with no in-app badge — which is fine, but should be a deliberate choice, not an oversight.
3. Whether a `formatPeriodLabel`-style helper (accounting-period row → human "Month Year" string) already exists anywhere in `web/src/lib/`. Not confirmed either way yet — if it doesn't exist, it's a small new helper function, not a new component, and should be written once and reused, not duplicated per screen.

---

## Part F — Open Questions (consolidated, actionable, for the next session)

These are every question still genuinely unresolved as of this document. Numbered independently of earlier per-round numbering to avoid confusion.

1. **PR 5's 500-vs-4xx decision (Part C, round 3, Q3) needs an explicit "yes."** The recommendation is fully stated above (throw `500 INTERNAL_ERROR`, logged with stack, on a 0-row result post-lock/post-scoping) — it just hasn't received a final explicit confirmation distinct from "restate it plainly," which is what was actually asked for. Get an explicit go/no-go before implementing PR 5's assert.

2. **Does `listTransactionsForDateRange` gain insurance/deposit-reversal rows inside PR 1, or as its own follow-up gap?** (Part E, design open item 1.) This affects PR 1's size and review shape — bundling adds a new query + schema-shape change on top of what was otherwise two one-line spreads.

3. **Is there any in-app surface for B9's fix to attach a badge to?** (Part E, design open item 2.) If no per-deposit-movement screen exists and none is planned, B9's late-fact flag may be CSV-export-only — confirm that's acceptable, or scope a small in-app view if not.

4. **Does a period-label formatting helper already exist in `web/src/lib/`?** (Part E, design open item 3.) Needs a quick check before PR 1 starts — if absent, budget for writing one small, reusable helper.

5. **(Carried from earlier, still relevant at PR-4-start time)** Re-run the QA pre-flight queries (Part C, round 3, Q2) if significant time has passed and QA data may have changed before PR 4 or PR 6 actually starts — the numbers above are a snapshot from this session's date (2026-08-23), not a standing guarantee.

---

## Quick-reference facts for the next session

- **Original evaluation report:** `CODE-EVALUATION-2026-08-23.md` (repo root) — trust it per Part A's corrections.
- **Next migration number:** `0031`.
- **Next `TRACKER.md` gap id:** `GAP-174`.
- **Golden fixture status:** `docs/qa/scenarios/fixtures/golden-g1-bus-month.yaml` contains **zero voided rows** — PR 2 (voided-row filter fixes, B2/B16) will **not** move the `134,000`/`15,000`/`7,500` regression figures, but the fixture also doesn't currently *cover* the voided-row bug, so new fixture coverage is real, necessary work inside that PR, not optional.
- **Neon connection info** for re-running any pre-flight query: org `FleetSettle` (`org-cold-rice-64493165`), project `fleetsettle` (`spring-sunset-96946055`), QA branch `qa` (`br-square-sound-afb68wft`), production branch `main` (`br-odd-cherry-afx5394i`, confirmed empty).
- **Git convention:** feature branch → PR into `develop`, never a direct push to `develop` or `main` (both auto-deploy).
- **Nothing in this document has been implemented.** No code, migration, or `docs/` file has been changed as part of this evaluation-and-planning work. `TRACKER.md`/`Plan.md` have not yet been updated to reflect PR 1–8 or `GAP-174`+ — that update itself is pending a decision on when to file them (at PR-1-start, most likely, following this repo's convention that a gap is filed when the fix begins, not before).
