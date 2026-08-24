# Combined plan — remediation + pending features

**Date:** 2026-08-23
**Status: planning complete on the merge, open questions consolidated at Part 5. Nothing implemented.**

**What this supersedes.** This document merges two working notes written the same day, which did not reference each other and overlapped in ten places:

- `CODE-EVALUATION-FOLLOWUP-2026-08-23.md` — verification of an external bug report (29 bugs, B1–B29) plus a 9-PR remediation plan. Referred to below as **FOLLOWUP**.
- `PENDING-FEATURES-DESIGN-2026-08-23.md` — four owner-agreed features (late-fact flag, tappable bell, vehicle loans, distribution). Referred to below as **PENDING**.

Both remain readable for their reasoning — FOLLOWUP's Part A verification evidence and Part B.1 implementation traps, PENDING's loan design rationale and declined-decisions table. **Neither is the plan any more; this is.** Where they disagree with each other or with the source, Part 2 below records which one is right and why.

`docs/` still decides. When items reach `docs/`, the owning document wins over all three of these notes.

---

## Part 1 — Decisions locked before merging

Five decisions were taken in the merge session. They constrain everything below.

| # | Decision | Consequence |
|---|---|---|
| 1 | **GAP-173 ships as a Badge on the record + a CSV column**, not a report subtotal line | FOLLOWUP Part E's design wins; PENDING item 1's "of which late facts" subtotal is **dropped** |
| 2 | **B1 + B9 + the badge + the CSV column ship as one PR** | The read side never ships against a write side that is still wrong |
| 3 | **The remediation stream claims migration `0031` onward** as its PRs land | Loans take the next free number whenever that stream actually starts |
| 4 | **The docs-vs-SQL sync lands before loans edits `data-model.md`** | Nobody drafts the loan DDL against a block known to be stale |
| 5 | ~~The voided-row fix lands before anything else touches `reports.ts`~~ | **Withdrawn on re-validation (C-7), then dissolved by Q-6.** B16 is not a bug, B2 is one line, and phase A1 no longer exists — the filter rides in Step 6. |

**Shipment order beyond these five is not owner-constrained.** The phase order in Part 3 is chosen on dependency and risk, and may be resequenced freely where Part 4's rules allow.

---

## Part 2 — Corrections to both source docs

Verified against source at `HEAD` during the merge. **Four corrections, two of which change the plan's shape.**

### C-1 · PENDING is wrong that "the write half has been correct all along"

PENDING item 1 opens by stating the W-35 write side is correct and that a late loan payment "inherits this flag with no extra work." **That holds for `day_record` only.**

In `submitInsuranceClaim`:
- `api/src/domain/incident.ts:619` — `insertInsuranceClaim` sets `postedPeriodId` **only**. No `belongsToPeriodId`, ever.
- `api/src/domain/incident.ts:627-629` — the paired `insertIncidentRecovery`, same transaction, same `linkage` object, **does** set it.

So two rows describing one incident disagree at the moment of insert. That is FOLLOWUP's B1, and FOLLOWUP has it right. `saveOpeningBalance` (`api/src/domain/opening-balance.ts:344`) is the same class — a hard `409 PERIOD_CLOSED` with no W-35 fallback, which is B9.

**Effect on the plan:** the badge would silently never render on insurance claims. This is why decision 2 merges the write and read halves into one PR. It also means **any new money table must set `belongsToPeriodId` itself** — loans included. PENDING's "inherits with no extra work" is false and is corrected in Part 3's Step 10 conformance list.

### C-2 · FOLLOWUP's Part D finding 4 is wrong — B9 *does* have an in-app surface

FOLLOWUP states "No screen displays individual `deposit_movement` rows — only aggregate held/refunded totals per deposit," and builds open question F-3 on top of it.

**False.** `web/src/features/people/DriverActivitySections.tsx:263-299` maps `view.deposit.movements` into individual rows, each carrying a movement-type label (`DEPOSIT_MOVEMENT_LABEL`, line 56), a date rendered through `formatShortDate`, and a void button.

**Effect on the plan:** FOLLOWUP's open question F-3 is **closed, not asked** — B9's late-fact badge goes on the movement row in `DriverActivitySections.tsx`, immediately beside the date already rendered there. No new screen, no CSV-only compromise.

### C-3 · No period-label helper exists — write one, mirroring `formatShortDate`

FOLLOWUP's open question F-4 asked whether one exists in `web/src/lib/`. It does not. The directory has `formatShortDate.ts`, `formatTimestamp.ts` and a dozen `*Label.ts` mappers, none of which produce a "Month Year" string.

`formatShortDate.ts` is the pattern to mirror exactly — a module-level `Intl.DateTimeFormat` pinned to `timeZone: "UTC"`, parsing `` `${date}T00:00:00Z` ``, with its own comment explaining that a `BusinessDate` is a resolved calendar day and anchoring to a fixed offset is what stops it shifting across a DST boundary.

**Effect on the plan:** F-4 is **closed, not asked**. One small `formatPeriodLabel.ts`, written once in Step 1, reused by both the badge and the CSV column.

### C-4 · PENDING's "Neither fails loudly" is wrong — CI already catches both trigger omissions

PENDING item 3 flags two hand-maintained lists (`assert_period_open()`'s array, `write_audit_log()`'s triggers) and budgets "a test each, because neither fails loudly."

Both lists are genuinely run-once and hand-maintained — confirmed, `api/migrations/0001_initial_schema.sql:949-961` is a literal `ARRAY[...]` of 19 tables, and `0002`'s catalogue `DO` block does not re-run. **PENDING is right that a loan migration needs two explicit `CREATE TRIGGER` statements.**

But the failure is loud. `api/scripts/assert-no-trigger-drift.sql` checks *both* triggers for every table carrying `posted_period_id` and expects zero rows, and `check:drift` is wired into three workflows — `integration.yml:65`, `deploy-qa.yml:42`, `migrate-production.yml:44`. Omitting either trigger fails CI before it can reach QA.

**Effect on the plan:** drop the two bespoke tests from Step 10's budget; the existing assertion covers them. Keep the two `CREATE TRIGGER` statements as a hard checklist item.

### C-5 · Two of PENDING item 2's three destinations do not exist

PENDING item 2 frames three bell rows as needing wiring to destinations. Checked:

| Row | Destination | Reality |
|---|---|---|
| Rent due | receivables | **Exists** — `web/src/features/reports/ReceivablesReportScreen.tsx`. A genuine wire-up. |
| Earlier days | unconfirmed days list | **No list screen.** `web/src/features/daily/` holds `ConfirmDayCard` / `ConfirmWeekGroupCard` — components rendered on Home, not a destination. |
| Deposits to release | deposits list | **No screen at all.** Deposits are per-driver, inside `DriverDetailScreen`. |

**Effect on the plan:** item 2 is larger than "wire three rows." Two of the three need either a new screen or an explicit decision to scroll to an existing Home section. Raised as open question **Q-4**.


### C-6 · B16 is not a bug — removing it would be a regression

FOLLOWUP pairs B16 with B2 as "voided-row filters." Checked end to end, and **B16 should not be fixed.**

`listOffsetsForDriver` (`api/src/queries/driver-money.ts:621`) deliberately projects `voidedAt` **and** `voidedReason` into its row type. `getDriverOwnView` (`api/src/domain/driver-view.ts:55`) passes the list straight through without summing — the balances it returns come from a separate source. And `web/src/features/people/DriverActivitySections.tsx:217-228` reads `offset.voidedAt !== null` and renders the row `line-through decoration-critical decoration-2` with a "Voided · \<reason\>" line beneath.

That is the same intentional pattern the original report itself noted for `listWriteOffsForBusiness:101` ("intentionally includes voided (struck-through)"). The original report's own wording hedged — *"inflates **if summed naïvely**"* — and nothing sums it.

**Adding `isNull(offsetRecord.voidedAt)` would delete void history from the driver's own statement**, which is exactly the append-only ledger behaviour the UI is deliberately showing. **Closed as not-a-bug.**

### C-7 · B2 is one narrow utilisation query, not a money bug

Both follow-up docs escalate B2's framing. The original report rates it **MEDIUM** and is precise: `countAllocatedDaysForVehicle` (`api/src/queries/reports.ts:1346`) is a single raw `SELECT COUNT(*) FROM vehicle_day_allocation` missing `voided_at IS NULL`. Its own in-function comment carries `// eslint-disable-next-line no-restricted-syntax -- a day count, not money`.

It inflates the **UC-79 utilisation percentage**. It is not a money figure. The original report's deep scan states it is *"the only remaining voided-filter miss after full scan of 22 money/occupancy tables in `reports.ts`"* — and independently, `reports.ts` carries 33 `voidedAt` filters, so the file is broadly correct.

**Effect on the plan:** with B16 removed (C-6), the former phase A1 is a **one-line change to one raw SQL string**. Decision 5's ordering rule was justified by a collision risk that does not exist, and is withdrawn. Raised as **Q-6**.

### C-8 · Step 1 is three layers, not one — the API schemas carry nothing

`belongsToPeriodId` appears **zero times** in `packages/shared/src/schemas/`. The plan's Step 1's read side ("the read side: Badge…") silently collapsed three layers of work into one.

Step 1's read side is: **shared response schema additions** → **handler threading** (incident/claim response, driver-view deposit movements, the CSV row shape) → `formatPeriodLabel.ts` → the `Badge` render → the CSV column. Size Step 1 accordingly; the UI is the last and smallest part.

### C-9 · `golden-g2-accident.yaml` covers the exact flow B1 changes

FOLLOWUP notes only that `golden-g1-bus-month.yaml` has zero voided rows. But `docs/qa/scenarios/fixtures/golden-g2-accident.yaml` covers claim-then-settle across months — `pending_recovery_shown: 60000` / *"still waiting on insurer"* → `recovered: 60000` / *"insurer settles"*.

That is precisely the path B1 modifies. **Step 1 is the phase most likely to move a golden fixture**, and neither source doc says so. Check g2 explicitly before and after Step 1; if it moves, that is the tripwire working, not a rebaseline.

### C-10 · No golden fixture covers a voided row at all

`golden-g1-bus-month.yaml`, `golden-g2-accident.yaml` and `golden-g3-mileage.yaml` all contain **zero** voided rows.

So the whole void-and-replace correction mechanism — W-50, a core money rule, and the reason B2/B19 exist as bugs — has **no golden coverage whatsoever**. This is broader than "one fixture for the filter"; it is a standing gap in the regression suite. Worth its own tracked gap regardless of which phase adds the first voided-row fixture.

---

## Part 3 — The combined plan

**Thirteen steps on two tracks that run in parallel.** All thirteen are **filed in [TRACKER.md](TRACKER.md) §4 as GAP-174…GAP-186**, and scheduled in [Plan.md](Plan.md) as Wave 8c.

**A convention correction, since this plan asserted the wrong one.** An earlier draft said *"a gap is filed when the fix begins, not before."* Git history disproves it — the four most recent gap commits are `File GAP-170`, `File GAP-171/GAP-172` and `File GAP-173`, every one of them landed **when the defect was found, before any fix**. Gaps are filed on discovery here. That is why all thirteen were filed before this plan's first line of code.

### The two tracks, and why it matters

Nothing in the remediation track depends on anything in the feature track, and vice versa. They share only two files, both governed by rules in Part 4.

| | Track 1 — Remediation | Track 2 — Features |
|---|---|---|
| **Steps** | 1–9 | 10–13 |
| **Blocked on** | nothing — can start today | Step 11's `docs/` change gates 13 and 14 |
| **Critical path** | Step 5 (the go-live blocker) | Step 11 → 13 → 14, strictly serial |

**The single biggest scheduling win: start Step 11's document change now, in parallel with remediation.** It is the long pole in the whole plan — a `use-cases.md` change that must be drafted, reviewed and merged before *any* loan code can be written, and Step 13 sits behind Step 12 behind it. Every day it waits, the feature track waits. It requires no code and collides with no remediation work.

### Prerequisites — do these once, not per step

- **QA pre-flight** (negative/zero-row counts) gates **Steps 4 and 5**. Run it **once** covering both, not twice. The 2026-08-23 snapshot was clean; it is a snapshot, not a guarantee.
- **A fresh disposable Neon branch** gates **Step 5** only. `TEST_DATABASE_URL` in `api/.dev.vars` expires; mint it when Step 5 starts, not before.

---

## Track 1 — Remediation (Steps 1–9)

### Step 1 · W-35 completion, write and read — **GAP-174**, closes **B1, B9, GAP-173**

Four parts, in this order:
1. `insertInsuranceClaim` gains `belongsToPeriodId` from the `linkage` its own transaction already computed (B1).
2. `saveOpeningBalance` gains the W-35 fallback — post to the open period with `belongsToPeriodId` pointing back — instead of a hard `409` (B9). `docs/engineering/data-model.md:252` already prescribes this; the code is out of step with its own spec.
3. `formatPeriodLabel.ts` — new, mirroring `formatShortDate.ts` (C-3).
4. The read side, **three layers not one** (C-8): add `belongsToPeriodId` to the shared response schemas (it appears **nowhere** in `packages/shared/src/schemas/` today) → thread it through the incident/claim and driver-view handlers → render `Badge variant="neutral"` reading **"Belongs to \<Month Year\>"** on `IncidentScreen.tsx` (precedent: badges already at lines 92 and 227) and on the deposit movement row in `DriverActivitySections.tsx` (C-2). Plus a period-label column on the CSV export, blank except on late facts.

**Check `golden-g2-accident.yaml` before and after** (C-9) — it covers claim-then-settle across months, the exact path B1 changes, and is the fixture most likely to move in this whole plan.

`Provisional` is **not** the right component and must not be used — a late-posted fact is settled, not estimated. Do not re-propose; FOLLOWUP Part E carries the full reasoning.

### Step 2 · CSV export — the three missing categories — **GAP-175**

Add insurance claims, incident recoveries and write-offs to `listTransactionsForDateRange` (`reports.ts:1608-1628`), which today pulls only four sources.

**Deliberately excluded:** payments, adjustments and offsets would double-count obligations the export already lists; deposit movements and advances are money you hold, never income, and are a separate judgment call (Q-2).

**Sequence this immediately after Step 1.** Both edit the same query and the same `TransactionRow` shape — Step 1 adds a column, this adds sources. Adjacent means the shape is touched twice with the context fresh, rather than twice cold. Q-2 deliberately kept them as separate PRs because Step 1 is already three layers; that is a review-size decision, not a reason to separate them in time.

### Step 3 · Timezone codemod — **GAP-176**, closes **B3**

`new Date(\`${date}T00:00:00\`)` without the trailing `Z`, parsing at device-local midnight. **15 files / 18 sites in production code**, independently re-counted — plus **2 more in `web/src/features/home/HomeScreen.test.tsx`** that neither source doc lists (16 files / 20 sites total). `VehicleCalendarScreen.tsx` already uses the correct `Z` form once alongside two bare ones, so **grep by pattern, not by file.**

**Must land before Step 11** — both edit `HomeScreen.tsx` (Part 4).

### Step 4 · Zod positivity on money inputs — **GAP-177**, closes **B21**

Reject zero on `expense.amountMinor`, `arrangement.rentAmountMinor`, `incident.agreedAmountMinor`. A zero-value charter is recorded at full price with an explicit waiver, so it reaches UC-77's "goodwill given" total.

**Do not** tighten the DB `CHECK` to `> 0` here — accumulator columns legitimately start at `0`. That is Step 6's separate `>= 0` work, and conflating the two breaks claim creation.

### Step 5 · Locking, scoping, and migration `0031` — **GAP-178**, closes **B5, B10–B15, B17–B20**

**Steps 5 and 6 are one PR** (NQ-1): B13's fix is a DB trigger, so this step needs a migration, and it shares `0031` with the constraint work rather than claiming a second number.

**The go-live blocker.** Live exposure is near zero today — production is internal-testing only and the business has one data-entry partner — but nothing else in this plan degrades as badly if skipped.

Internally sequenced: **locks first, then scoping and the row-count assert.** Shipping the assert before the lock turns a legitimate concurrent void into an unwarranted 500.

**Four traps that change the shape of the fix:**
- **B10** — locking `deposit_movement` rows does not work. Under `READ COMMITTED`, row locks on existing rows do not block a concurrent `INSERT`; there is no predicate locking. The lock must be on the parent `deposit` row, and *every* writer that inserts a movement must take it. Enumerate the writers first.
- **B13 — resolved as a DB trigger** (NQ-1). Locking the party row serializes archive-vs-archive but **not** archive-vs-new-money, because money-insert paths take no lock on the party row. A `BEFORE INSERT` trigger on each money table refuses a write against an archived party — one enforcement point, consistent with *"the trigger is the truth."*
  **Extend `api/scripts/assert-no-trigger-drift.sql` to verify attachment.** That is the whole reason this design won: the existing query already checks every table carrying `posted_period_id` for its triggers and runs in three CI workflows, so a missed table fails loudly. The rejected `FOR SHARE` alternative was verifiable only by human review, and a money path added later would have reopened the race silently.
- **B5/B15** — an argument swap, not a signature change. `resolvePeriodLinkage(db: ReadDb, …)` already accepts a transaction handle, which is why `deposit.ts:46` and `payment.ts:61` already call it correctly. Pass `tx`, move the call inside the callback.
- **B5 spans five sites, not two** — `expense.ts:129`, `incident.ts:251`, `advance.ts:53`, `partner.ts:120`, and `voidAdvance` at `advance.ts:269`, which is numbered nowhere in the original report. Sweep for the pattern.

**B14 has two halves, and the cross-tenant half is the serious one.** Verified: `updateObligationSettled` (`obligation.ts:392`), `applyAdjustmentToObligation` (`:246`) and `reverseAdjustmentOnObligation` (`:376`) **all** do `.where(eq(obligation.id, obligationId))` with no `businessId` predicate — a wrong id mutates across tenants silently. The locking half: `findObligationForBusiness` has **no `forUpdate` parameter at all**; the pattern to copy exists 4× (`obligation.ts:192`, `:290`, `:334`, `trip.ts:258`). Making the new `businessId` parameter **required** lets the compiler enumerate all 8 call sites — which is why this needs no staged rollout.

**Per Q-1:** a 0-row result post-lock, post-scoping throws **500 `INTERNAL_ERROR`**, logged with a stack trace. Never a 4xx.

**Migration `0031` also carries the constraint work:**

- **B20** — `CHECK >= 0` (not `> 0`) on the eight columns.
- **B19** — the original report's mechanism was wrong: **no unique constraint exists at all**, so concurrent submits do not 500, they silently insert a duplicate claim. Add the constraint first; the catch only becomes meaningful afterwards:
  ```sql
  CREATE UNIQUE INDEX incident_recovery_one_per_source
    ON incident_recovery (incident_id, source)
    WHERE voided_at IS NULL;
  ```
  The `WHERE voided_at IS NULL` is **not optional** — money is append-only and corrections void-and-replace (W-50); an unconstrained `UNIQUE` would make a wrong claim permanently uncorrectable. Safe because `settleInsuranceClaim` **overwrites** `receivedAmountMinor` rather than inserting a second row.
- **B18** — pin the trigger messages in a regression test. The fragile `P0001` + English-substring matching affects **4 matchers**, not the 2 the report named.

Testing: **real two-connection interleaved-transaction tests for B10, B12, B13 only**; correctness tests plus review for B5, B11, B14, B15, B17.

### Step 6 · Performance — **GAP-179**, closes **B26, B27, B29**

Including `day-card-generation`'s cron scan having no `business_id` filter at all.

`sumDepositsHeld`'s N+1 (B28) is a **documented, deliberate, bounded** trade-off, justified in-comment at `reports.ts:1062-1072` — re-confirm it, do not blindly "fix" it.

**Touches `reports.ts`; pair with Step 8** (Part 4).

### Step 7 · Hygiene — **GAP-180**, closes **B2, B4, B6, B7, B24** + label fix

- **B2** (from the dissolved phase A1, per Q-6): add `AND voided_at IS NULL` to `countAllocatedDaysForVehicle`'s raw SQL at `reports.ts:1346`. Inflates UC-79 utilisation only — **not money** (C-7). **Do not touch B16** (C-6).
- **B4** — also `reports.ts` (`:894`). Downgraded: `Date.parse` on two date-only strings is spec'd as UTC on both operands, so the arithmetic is correct today. The risk is fragility, not a live off-by-one.
- **B7 — tighten the `WIRE` regex to reject `-0`, and nothing else.** `parse` handles wire format, `fromInput` handles human-typed decimals; they are deliberately different grammars. Making them agree would be a regression.
- **B24 — the 4 valid citations only.** `listVehiclesRoute` declares no request schema, and `archiveVehicle` is a bare idempotent `UPDATE` that never 409s.
- **B6** — `MAX_SAFE_INTEGER` guard, mirroring `chartAxis.ts`'s existing pattern.
- **Label fix:** `SettleInsuranceClaimSheet.tsx:107` says "Amount received" for a cumulative field; the identical `RecoveryReceivedSheet.tsx:75` says "Received so far." Rename to match.

**B2 and B4 are both in `reports.ts`** — same file as Step 6, hence the pairing.

### Step 8 · Voided-row regression coverage — **GAP-181**

All three golden fixtures contain **zero** voided rows, so W-50's void-and-replace mechanism has no regression coverage at all. Scope on its own merits — it protects B2, B19 and every future void path, not just the one filter Step 7 fixes.

### Step 9 · Docs-vs-SQL sync — **GAP-182**, closes the drift table

Bring `data-model.md`'s DDL blocks back in line with the migrations for `business_creation_request`, `insurance_claim`/`incident_recovery`, `expense`, `offset_allocation`. Drift row 5 is **not** a docs issue — it is B20, fixed in Step 6.

**Not docs-only:** also drop `.default("pending")` from `api/src/db/schema.ts:90`. The column has no DB `DEFAULT` (deliberately — `0030_platform_tier.sql:38` says so), and Drizzle currently claims one. Inert only because the single writer hard-codes the value; a future insert path trusting the declared default would fail at runtime on a `NOT NULL` column.

**Must land before Step 12 touches `data-model.md`** (Part 4).

---

## Track 2 — Features (Steps 10–13)

### Step 10 · Bell rows and Home sections tappable — **GAP-183**

Independent of Steps 12–14; can ship any time after Step 3.

Per **Q-4**, one answer per row:

| Row | Resolution |
|---|---|
| Rent due | Wire to `ReceivablesReportScreen.tsx` — **exists** |
| Earlier days | Close the sheet, **scroll to the Home section** already rendering it (`groupUnconfirmedByLease`) |
| Deposits to release | **One new minimal list screen**; each row opens that driver's detail |

Read/unread is **declined, deliberately**: bell rows are derived live, so an item disappearing when the work is done *is* the read state. Letting a manager dismiss "Rs 40,000 rent overdue" without collecting it is the exact W-56 failure mode, on the one widget people trust to say what they missed.

New tap targets must meet M-1: 44 × 44 CSS px, ≥ 8px apart. Sheet rows are `py-3` today and will not meet it unchanged.

### Step 11 · The `docs/` change for loans and distribution — **GAP-184** · **start this first**

**The critical path for the entire feature track.** No code. One `doc-change` PR covering both features, since they are one conversation about capital and cash — see **NQ-2** if you would rather split it.

| Document | Change |
|---|---|
| `product/use-cases.md` | Promote loans from phase Third · add `'finance'` to the §6.7 borne-by matrix (always `us`) · state that UC-03's owners-only capital row covers **partner-level** facts, so business liabilities and cash sit with a manager's working set, **with its reason** · add the distributable-cash report, visible to a manager · a `W-n` decision recording the flat-only amortisation choice |
| `product/user-flows.md` | Flows for loan setup, payment, settle-and-close, arrears · the lifecycle edges table · acceptance criteria · a new `INV-n` for "principal is never an expense" |
| `engineering/data-model.md` | Two new tables, two CHECK migrations, `purchase_cost_minor`, the `assert_period_open()` entry, the explicit audit trigger |
| `design/ui-ux-guidelines.md` | §3.2 gains a loan item so the bell counts it · the three destinations from Step 10 · the interface vocabulary table |
| `engineering/implementation-guidelines.md` | IG §16's rule-to-mechanism table gains the two hand-maintained-list checks |

### Step 12 · Vehicle loans — **GAP-185**

Blocked on Step 11. The full design — flat-only amortisation, proportional 2:1 split via the existing `split()`, final-payment true-up, settle-and-close, cumulative arrears, liability owner, the v1 refusal of partner-paid instalments — is in PENDING and **stands unchanged**. Read it there.

**Three corrections to that design:**
- **`loan_payment` must set `belongsToPeriodId` itself** (C-1). It does **not** inherit the late-fact flag for free — PENDING's claim that it does is false. Add it to the conformance checklist.
- **Drop the two bespoke trigger tests** (C-4) — `check:drift` already covers both omissions in three workflows. Keep the two literal `CREATE TRIGGER` statements as a hard requirement.
- **`'finance'` needs a row in `web/src/lib/expenseCategoryLabels.ts`**, mapped to **"Interest and charges."** GAP-158/159 were exactly this shape — a raw enum reaching the interface unmapped.

**Per Q-2:** a loan payment's finance portion reaches the CSV automatically via the existing expense join. **Principal never will, and that is correct** — principal is not an expense, so including it would double-count.

### Step 13 · Distribution and distributable cash — **GAP-186**

Blocked on Step 12 (**Q-3**) — the formula's third term does not exist until loans are built. No schema change; mostly verification of `ownership_share`, `capital_contribution`, `management_fee_agreement`, `partner_payout`, `banking_event` and the UC-67 statement.

```
Cash on hand and in bank
  −  security deposits held        money you hold, never yours
  −  loan instalments due          overdue + the next falling due (Q-5)
  =  Distributable
```

**Degrades to "not available", never to zero** (W-56) — a distributable figure from a partial read is the most expensive wrong number in this plan, because someone acts on it by moving money.

Visible to `viewReports` — owner, owner-manager and manager alike. It is a cash report, not a capital one, and every input is already visible to a manager. **Seeing is not acting**: recording a `partner_payout` stays `managePartnerCapital`, owners only.

---

## Part 4 — Shared surfaces

Five files are touched by more than one step.

| Surface | Steps | Rule |
|---|---|---|
| `api/src/queries/reports.ts` | 1, 2, 7, 8, 14 | **Keep 1→2 adjacent** (same `TransactionRow` shape) and **7→7 adjacent** (B2/B4 are in this file). Otherwise unordered — the file carries 33 correct `voidedAt` filters and is broadly sound. |
| `docs/engineering/data-model.md` | 10, 12 | **Step 9 first.** Both edit the `expense` DDL block; Step 11 must not draft against a block known to be stale. |
| `web/src/features/home/HomeScreen.tsx` | 3, 11 | **Step 3 first.** It rewrites two date call sites there (plus two in the test file); Step 10 restructures the same component's rows. |
| Migration numbers | 5, 12 | **`0031` is Step 5's** — B13's trigger plus the constraint work, one migration (NQ-1). Loans take the next free number. |
| `api/src/auth/policy.ts` | 5, 13 | No rule. Step 5 touches query-layer scoping; Step 12 adds a `manageVehicleLoans` capability. |

**Closed — do not re-open:**
- **B16** — **not a bug** (C-6). Voided offsets are deliberately returned and rendered struck-through. Filtering them would delete void history from the driver's statement.
- **B8** — by design; `voidAdjustment`'s error message already explains the offset-first requirement.
- **B22** — resolved as `GAP-141`. INV-18 never hard-gated: *"It does not block; it refuses to let you do it blind."*
- **B23** — false; the audit trigger is attached at migration-apply time. **Caveat for Step 13:** that block ran once and does not re-run, so new tables need an explicit `CREATE TRIGGER` (C-4).
- **B25** — correctly deferred to P12's offline queue.
- **B28** — documented bounded trade-off; re-confirm in Step 6.

---

## Part 5 — Questions, resolved

All six are answered. Recorded with the reasoning, per this repo's convention that what was decided and what was declined both get written down.

### Closed by reading the code — never needed asking

- **Is there an in-app surface for B9's badge?** → **Yes.** `DriverActivitySections.tsx:263-299` (C-2).
- **Does a period-label helper exist?** → **No.** Write one mirroring `formatShortDate.ts` (C-3).
- **Re-run the QA pre-flight?** → Not a decision. A step inside Steps 3 and 5.

### Q-1 · The 0-row assert returns **500 `INTERNAL_ERROR`**, logged with a stack trace

Never a 4xx. Post-lock and post-scoping, zero rows cannot be legitimate user error — it means a tenancy bug slipped every earlier guard, or an impossible concurrent-delete race. The transaction rolls back, so nothing is half-written.

**Declined: 404.** Consistent with CLAUDE.md's "cross-tenant access returns 404, never 403" on its face, but that rule protects a *user* reaching for a row that isn't theirs. Here the request already passed a scoped read and took a lock, so it is our code that is wrong — and a 404 sends the manager into an unwinnable retry loop against an invisible bug.

**Declined: 409.** After Step 4's lock lands, the race it describes is unreachable via any correct path, so the label would be wrong nearly every time it fired.

### Q-2 · CSV categories: **its own gap, scoped to insurance claims + incident recoveries + write-offs**

Not inside Step 1 — Step 1 is already three layers (C-8), and adding a new query plus a `TransactionRow` shape change makes it hard to review. Scope is fixed now so it cannot drift.

**Deliberately excluded, with reasons:**
- **payments, adjustments, offsets** — these settle or modify obligations the export already lists. Including them double-counts.
- **deposit movements, advances** — money you hold, never income. A separate judgment call, not folded in silently. Revisit as its own decision if an accountant asks for a full cash view.

**Consequence for Step 12, now settled:** a loan payment's finance portion reaches the CSV automatically through the existing expense join. **Principal never will, and that is correct** — principal is deliberately not an expense, so including it would be the same double-count the exclusions above avoid.

### Q-3 · **Step 13 waits for Step 12**

Distributable cash reads a real instalments-due figure from its first render. The report never exists in a state where it confidently overstates by exactly the arrears.

**Declined: ship Step 13 first with an on-screen caveat.** W-56's rule is that a report degrades to "not available", never to a confident wrong number — and a caveat under a large bold figure is not the same as refusing to show it. The caveat also goes stale the moment Step 12 lands.

**Declined: ship Step 13 with the figure blank until loans exist.** Strictly correct, but a report whose headline number is permanently "not available" is close to shipping nothing.

### Q-4 · Bell destinations: **mixed, one answer per row**

| Row | Resolution |
|---|---|
| Rent due | Wire to `ReceivablesReportScreen.tsx` — **exists**, no new work |
| Earlier days | Close the sheet, **scroll to the Home section** that already renders exactly this content (`groupUnconfirmedByLease`). No new route. |
| Deposits to release | **One new minimal list screen**; each row opens that driver's detail, where the deposit already lives |

**Declined: scroll-to-section for all three.** Would put a deposits section on Home that nothing asked for, and bypasses the receivables screen that already exists and is the better destination.

**Declined: a new screen for each.** Duplicates unconfirmed-days content already on Home — precisely what M-36a's *"rather than inventing a new destination"* cautioned against.

### Q-5 · Instalments due reaches **overdue + the next falling due**

The failure modes are asymmetric. Too conservative means the owner distributes one instalment less than he strictly could — recoverable next month, costs only timing. Too aggressive means an instalment bounces days after he moved the money, bringing a penalty and damaging the lending relationship. On a figure whose entire purpose is that someone acts on it immediately, err toward the recoverable mistake.

**Declined: overdue only.** On the 20th it frees cash that is committed on the 25th.

**Declined: overdue + everything due this calendar month.** Identical in the common case, but on an instalment falling on the 2nd it subtracts nothing on the 28th and then jumps a full instalment three days later. A billing cycle is not an accounting period (W-40); anchoring to the month reintroduces that confusion.

### Q-6 · The former A1 is **split** — the filter joins Step 7, the fixture gap becomes its own tracked gap

Two different kinds of work were wearing one phase number.

- **The B2 filter** (`reports.ts:1346`, one line) folds into **Step 7 (hygiene)**.
- **The missing voided-row coverage** (C-10) becomes **its own tracked gap**. It is not a bug fix — it is a hole in the regression suite that protects B2, B19, W-50 and every future void path, and it deserves its own scoping rather than a checkbox at the end of someone else's PR.

**Phase A1 no longer exists.** Its filter is Step 7's; its fixture gap is Step 8.

---

## Part 6 — Optimization decisions

Two questions raised by the optimization pass, both now answered.

**NQ-1 · Does Step 5 need a migration? → Yes: a DB trigger, sharing `0031`. Steps 5 and 6 merged.**

B13 is fixed with a `BEFORE INSERT` trigger refusing money writes against an archived party, not with `FOR SHARE` on the money-write paths. **The deciding argument is CI verifiability**, not elegance: `assert-no-trigger-drift.sql` already checks every table carrying `posted_period_id` for its triggers and runs in three workflows, so extending it makes a missed table fail loudly. *"Did every write path take `FOR SHARE`?"* is answerable only by human review, and a money path added next year would have reopened the race in silence.

Existing data is not a constraint here, so the usual reason to avoid adding a trigger — backfill, existing rows violating it — does not apply.

**Consequence:** the former Step 6 no longer exists. Its constraint work (B18, B19, B20) rides in the same `0031` migration, and `0032` stays free.

**Declined: `FOR SHARE` on the money paths.** Smaller and needs no migration, but unverifiable by CI — the same hand-maintained-list failure that has already bitten this repo twice.

**NQ-2 · Is Step 11 one `doc-change` PR or two? → One.**

Loans and distribution are one conversation about capital, cash and what a manager may see, and both rest on the same UC-03 argument: the owners-only row covers **partner-level** facts (who owns what, who put in what), and neither a loan balance nor a cash figure is one of those.

**Declined: splitting the loans half out to unblock Step 12 sooner.** It would mean two passes over the same UC-03 paragraph and re-running the same argument in two reviews, with the second likely adjusting wording the first had just landed.

---

## Quick reference

- **Next migration:** `0031` (Step 5 — B13's archive trigger + the CHECK/unique work, together).
- **Next gap id:** `GAP-187`. GAP-174…GAP-186 are this plan's thirteen steps, already filed.
- **Golden fixtures:** `134,000` / `15,000` / `7,500` must not move in any phase. **Step 8** adds voided-row fixture coverage, which does not currently exist anywhere.
- **Neon:** org `FleetSettle` (`org-cold-rice-64493165`), project `fleetsettle` (`spring-sunset-96946055`), QA branch `qa` (`br-square-sound-afb68wft`), production `main` (`br-odd-cherry-afx5394i`, empty).
- **Git:** feature branch → PR into `develop`. Never a direct push to `develop` or `main`; both auto-deploy.
- **Nothing here is implemented.** `TRACKER.md` and `Plan.md` are not yet updated.
