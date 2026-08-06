# Implementation plan — the remaining build, in two parallel tracks

**Not a specification, and not a record.** `docs/` says what to build and why; [TRACKER.md](TRACKER.md) says what is done and carries every open gap by id; this says what remains, in what order, and who can build it at the same time as whom. Where the three disagree: `docs/` first, then `TRACKER.md`, then this.

**Written 4 August 2026**, from `b2cf367` — backend complete through P13, frontend complete through Web-P8b. Validated route-def by route-def against `api/src/route-defs/` and screen by screen against `web/src/`.

**What changed from the previous edition.** It was a single serial queue of nine phases, each opening with its own backend increment and then building screens against it — so the frontend idled through every read increment and the backend idled through every screen. This splits the same work into **Track A (Worker + shared schemas)** and **Track B (React client)**, which is legal because of one rule the project already runs on, restated below. The old `Web-P8c…P12` numbering is retired; every item here carries a gap id from [TRACKER.md](TRACKER.md) §4 instead.

**Updated 5 August 2026**, `e7efa71` — the CI gap under "One thing that is not code" (below) is resolved; see [TRACKER.md](TRACKER.md) for the full account. Nothing on either track was ever blocked by it, but every PR into `main` is now actually tested for the first time.

**Updated 5 August 2026**, `2822193` — validated A2/A3/B2/B3 against the code rather than against this file, ahead of building them. Three things were wrong and are fixed below: **`/more` does not exist**, so B2 and B3 had no entry point (now **B0**, GAP-37) · **`GET /api/payment` does not exist**, so F-8.2 was unbuildable from any screen (now in A3, GAP-38) · **GAP-13 stopped being expensive when P13 shipped** and is now built in A3 rather than deferred a fifth time. A2's one open decision — F-7.6's host — is also **made**, and it closes GAP-4 by deriving rather than writing.

**Updated 5 August 2026 — A2 done.** Six endpoints, 25 new tests, full suite 31/353. B2's dependency is now only B0. One new gap recorded, **GAP-39** — W-53's management fee has never actually reduced vehicle profit; TRACKER.md §4 has the detail. A2's own write-up is below, under Track A.

**Updated 5 August 2026 — A3 done.** Four endpoints/changes, 13 new tests, full suite 31/366. B3's dependency is now only B0. A3's own write-up is below, under Track A.

**Updated 5 August 2026 — A4 done.** Two endpoints, 8 new tests, full suite 31/374. B6's dependency is now only B0 — every one of A2, A3 and A4's handoffs to Track B has now happened. A4's own write-up is below, under Track A.

**Updated 5 August 2026 — A5 done.** One endpoint, 4 new tests, full suite 31/388. **Track A's read backlog is finished**; everything left on it writes, migrates, or both. A5's own write-up is below, and the section after the Track A table has been re-planned against the code — see "What the A6–A10 validation pass found".

**Updated 5 August 2026 — re-pointed at what is actually left.** Deployment and auth both landed today, and between them they *were* the critical path. With them gone this plan's framing was stale: it still sequenced around unblocking things, when nothing on either track is blocked any more. "Start here" is rewritten around **who still cannot use the product** — one of three roles has a working app — and B0 is now explicitly first. One new gap, **GAP-40**: nothing signs the user out.

**Updated 5 August 2026 — B8 done, and it was mis-sized here.** Real Asgardeo auth is wired (`96301f8`): SDK, PKCE, callback, sign-in gate, 12 new tests. This plan costed B8 at "ten minutes of console work" — that covered the console; **the client half was unbuilt and unscoped**, and until it landed nobody could log in to a deployed build at all. It also surfaced a stale client id in all three Worker environments and a QA build that would have shipped production's. Both fixed. **The lesson worth keeping: "blocked externally" hid an unsized item on the critical path** — B8 was ranked last precisely because the blocker was cheap, which said nothing about the work behind it. Its write-up is under Track B.

---

## The rule that makes two tracks legal

> **The schema is the synchronisation point, and the main lever for parallelism.** Once a resource's Zod schema lands in `packages/shared`, the two tracks separate: the Worker builds against a real Neon branch, the client against mocks derived from *the same schema object*. Hand-mirrored types drift silently and what drifts is a money field (IG §2). So the schema is always a phase's first task, never its last.
>
> — TRACKER.md §1, rule 2

**The contract between the tracks, stated once:**

1. **Track A lands the Zod schema first**, in `packages/shared/src/schemas/`, in its own commit, before the query or handler exists. That commit is the handoff.
2. **Track B imports that schema object and mocks against it.** Never a hand-written interface mirroring it. The one exception already in the tree is `MeResponse` in `FirstRunGate.tsx`, and it is documented as one.
3. **Neither track edits the other's files.** `packages/shared` is Track A's to write and Track B's to read. If Track B needs a schema change, it asks; it does not add a field.
4. **Money is `string` on the wire in every schema either track writes.** Non-negotiable, and the reason clause 2 exists at all.

**Where the tracks actually contend:** `packages/shared/src/schemas/` (A writes, B reads — serialise via clause 1) and `web/src/app/router.tsx` (B only, but every B item touches it — expect merge conflicts there and nowhere else).

---

## Start here

**As of 5 August 2026 the product is deployed and a real person can log in to it.** That was the whole of the critical path a day ago, and it is gone: `fleetsettle.com` and `qa.fleetsettle.com` are live, and B8 replaced an auth stub whose token the Worker was always going to refuse. **Nothing on either track now waits on anyone outside this repository** except P14's Meta approvals.

**So the question stopped being "what unblocks this" and became "who still cannot use it".** Three roles; one of them has a product:

| Role | Today |
|---|---|
| `owner_manager` / `manager` — the partner who enters everything | **Complete.** Home, vehicles, calendar, leases, trips, incidents, costs, quick-add, people |
| `owner` — the partner who reads the reports | **Nothing.** `FirstRunGate` renders a placeholder. Nine tested report endpoints, no screen — **B4** |
| `driver` — the linked driver | **Nothing.** `GET /api/driver-view` has been ready since P12 — **B5** |

**Do these two things first, in this order:**

| # | | Why it is first |
|---|---|---|
| 1 | **B0** — the `/more` hub | Half a day, no backend. It gates B2, B3 and B6, and it is where sign-out goes (GAP-40 — nothing signs the user out today) |
| 2 | **B4** — the Review shell and nine reports | The largest single item left on either track, and the entire product for the partner this system was built to be believed by |

**Then, on the backend, A9a before anything else that writes.** GAP-35 is a live defect — voiding a record posted into a closed month silently changes that month's reported figures — and **A6 and A10 each add a fourteenth and fifteenth place it can fire.** One trigger change, half a day. Doing it after them means shipping a known hole into new code.

**Everything left on Track A writes, migrates, or both.** A6–A10 were re-validated against the code on 5 August; three of the five were wrong in ways that matter and one new item came out of it — the findings are below the Track A table. Track A's read backlog is finished and every handoff to Track B has happened (A2 → B2, A3 → B3, A4 → B6, A5 → B5+), so **the two tracks are now fully independent.** Nothing in Track B waits on Track A at all.

---

## Track A — the Worker and shared schemas

| id | Item | Gaps | Endpoints | Blocks |
|---|---|---|---|---|
| **A1** | ✅ Web-P8b's `GET /api/expense` | GAP-33 | 1 | — |
| **A2** | ✅ Partner, banking and cash reads | GAP-9, GAP-4, GAP-31 | 6 | B2 |
| **A3** | ✅ Period, write-off and payment reads | GAP-13, GAP-38 | 4 | B3 |
| **A4** | ✅ Customer-scoped reads | GAP-22 | 2 | B6 |
| **A5** | ✅ Driver history reads | GAP-24, GAP-29 | 1 | B5 (partly) |
| **A9a** | ⚠️ **The void/closed-period hole — a live defect** | GAP-35 | 0 + a migration | **A6, A10** |
| **A6** | The trip receivable — design settled, needs A9a | GAP-23 | 0 + a migration | — |
| **A10** | The other two silent zeros — **new** | GAP-39, GAP-10 | 0–1 + a generator | — |
| **A7** | R2 upload — unblocks five gaps, independent | GAP-16 | 1–2 | B-photos |
| **A8** | Odometer wiring + borne-by preview, independent | GAP-30, GAP-32 | 1 | — |
| **A9b** | The rest of soft delete | GAP-12, GAP-36 | ~15 + a migration | — |

**Endpoint counts are lower than the previous edition's** because validation moved work out of handlers: A6 and A10 add **no new endpoints at all** — they change what existing writes do inside their existing transactions — and A9a is a migration with no endpoint. What is left on this track is mostly domain-layer and SQL, which is also why it is the half that needs the golden fixtures re-run rather than a new screen.

### A1 · Done

`GET /api/expense` shipped in `b2cf367` — every filter optional, newest first, voided rows included, `dailyOperations`. `expense.test.ts` at 20/20.

**It has no caller** (GAP-33), and that is deliberate: §3.3's route map has no business-wide costs route, so the plan's `ExpenseListScreen` was withdrawn rather than built. The endpoint keeps real value — report-adjacent, and every other list endpoint here has shipped ahead of its screen at some point. **Do not add a screen for it without a spec change.**

### A2 · Done

Six endpoints, all shipped: `GET /api/business-member` (GAP-31, `dailyOperations`) · `GET /api/ownership-share`/`capital-contribution`/`management-fee-agreement`/`banking-event`/`partner-payout` (`managePartnerCapital`, except banking-event which shares the write's `dailyOperations` gate) · the composed `GET /api/partner/{userId}` (F-7.6/F-7.3), closing GAP-9 and GAP-4 by derivation, never a write. 25 new integration tests (business-member 4, partner +16, partner-summary 5) in two new files; full suite 31/353, all green. TRACKER.md §2 carries the row.

**One design correction worth carrying forward:** `listOwnershipShares` filters `effective_to IS NULL` alone, not a "latest set per vehicle" grouping — `assert_shares_total`'s deferred trigger structurally forbids two open sets ever coexisting for one vehicle, so the simple filter is provably sufficient. A first draft over-built this; TRACKER §5 has the reasoning.

**One new gap, recorded rather than fixed: GAP-39.** `sumVehicleCostsForPeriod` already reads `obligation WHERE kind = 'management_fee'`, but nothing has ever written one — W-53's "management fee reduces vehicle profit" has been silently a no-op since P7. `GET /api/partner/{userId}` works around it correctly (reading `management_fee_agreement` directly), but UC-70's vehicle-profit figure is still wrong wherever a management fee applies. Unowned; needs a generator, not a read-side fix.

### A3 · Done

Four endpoints/changes, all shipped: `GET /api/accounting-period` (list, newest first, `viewReports`) · `GET /api/write-off` (list, every filter optional, `writeOffOrWaiveAboveThreshold` — the same gate as recording one) · **`GET /api/payment`** (GAP-38, `dailyOperations` — the same gate as recording one; carries the W-49 linked-driver 403 class since a payment names the driver it moved against) · the close checklist's **`unconfirmedDays`** row (GAP-13 — one `COUNT(*)` on `day_record.state = 'open'` scoped to the open period, the same scoping `pendingObligations` already used, cheap and exact since P13). No new table, no new write, no domain layer — four straight filtered reads. 13 new integration tests across the three existing files; full suite 31/366, all green. TRACKER.md §2 carries the row.

**Explicitly out of scope, unchanged: GAP-12.** Void-and-replace stays `expense`-only — that is A9's job, not this one's.

### A4 · Done

Two endpoints, both shipped: `GET /api/customer/{id}/obligation` (outstanding dues only, oldest due first — reuses `findOutstandingObligationsForParty` rather than a second party-scoped query, exactly the trap this item was written to avoid, so this screen can never disagree with what `recordPayment` actually allocates against) and `GET /api/customer/{id}/payment` (reuses `listPaymentsForBusiness` scoped by `partyCustomerId`). Both `dailyOperations`, 404 cross-tenant, both proven against the W-49 linked-driver 403 class. No new table, no new write, no domain layer. 8 new integration tests in the existing `customer.test.ts`; full suite 31/374, all green. TRACKER.md §2 carries the row.

**GAP-22 closes on its backend half only.** `/people/customers/:id` itself still renders `NotBuiltYetScreen` — that placeholder is B6's own item, not a backend gap, and B6 now waits only on B0.

**One shortcut this item confirmed rather than avoided:** `obligation` carries `party_customer_id` directly (set at insert, even for a rent due whose `source_type` is `billing_period`), so a customer's dues never needed the lease hub's three-way source reassembly — one direct filter was enough, as the plan predicted.

### A5 · Done

One endpoint: `GET /api/driver/{id}/view`, gated `dailyOperations`, returning both balances, days (excused ones included), closed trips and fees, advances, offsets and the held deposit. 4 new integration tests in the existing `driver.test.ts` (10 total). TRACKER.md §2 carries the row.

**The previous edition said the driver's own view "cannot be reused." That was half right, and the half it got wrong saved the work.** What cannot be reused is the *route* — its gate, and `requireDriverId` as the only source of the id. The **domain function** reuses perfectly: `getDriverOwnView(db, businessId, driverId, from, to)` never read the caller's identity, it took a `driverId` argument all along. So A5 is a new route-def, a new handler and a shared wire mapper (`toDriverViewResponse`, lifted out of the driver-view handler) over an unchanged domain function — which is also what guarantees the manager's screen and the driver's own screen can never print different numbers for the same driver.

**INV-25 is untouched, and worth restating because it reads like a contradiction.** INV-25 forbids a caller-supplied `driverId` on *the linked driver's own* route — and that route still has no such slot. This is a different route with a different gate, and the boundary is proven in both directions: a linked-driver token 403s it for **any** id, including their own.

**GAP-29 closed without building `GET /api/advance`.** The composed read already returns the driver's advances, so a separate advance list would have been a second way to reach the same rows with no screen asking for it — the same reasoning that withdrew B1. Revisit only if a screen ever needs advances *without* the rest of a driver's history.

### What the A6–A10 validation pass found — 5 August 2026

Re-validated against the code, not against this file, the same way the A2/A3 pass was. **Three of the four remaining items were wrong in ways that change the work**, one whole item was missing, and the ordering changed as a result.

1. **A6 makes `bookTrip` period-dependent for the first time.** `bookTrip` never calls `resolvePeriodLinkage` today — booking a charter works regardless of whether an accounting period covers the date. Posting an obligation inside that transaction requires `posted_period_id`, so **booking starts being refusable with `PERIOD_CLOSED` where it currently always succeeds.** That is a behaviour change to a shipped endpoint, not an addition, and it needs its own test.
2. **A trip need not have a customer.** `trip.customer_id` is nullable and `BookTripInput.customerId` is optional, but `obligation` has a CHECK forcing exactly one party. A trip fare therefore cannot always be posted — the branch is real and the plan never mentioned it.
3. **A8's "real decision" is already decided, four times over.** Whether a fuel fill writes its own `odometer_reading` row transactionally is settled by precedent: `lease.ts`, `mileage.ts` and `trip.ts` (twice) all insert one inside their own transaction, and **there is no standalone odometer endpoint at all.** A8 follows the convention rather than opening the question.
4. **A8's borne-by lookup already exists.** `resolveBorneByDefault` already calls `findActiveLeaseForVehicle`/`findCurrentDailyLeaseForVehicle`. What is missing is not a lookup but a way for the form to *show* what the server would decide — a preview read, which is why the client currently has to omit `borne_by` entirely rather than display a default it is forbidden to compute.
5. **GAP-35's fix cannot be a straight revert of `0006`, and cannot reference `NEW.voided_at` unguarded.** `assert_period_open()` is one function shared by **19** tables; only **13** of them have a `voided_at` column. A function reading `NEW.voided_at` raises `record "new" has no field` on the other six. The fix is a column-presence-safe test, sketched in A9a.
6. **GAP-23 is not the only silent zero — it is one of three, and the other two are unowned.** GAP-39 (management fee) is marked `—`, and GAP-10 (an incident's customer contribution) is filed under "correct to leave." All three are the same defect: **an amount somebody has agreed to owe never becomes an obligation, so it reads as zero everywhere.** `incident_recovery.obligation_id` even carries the comment `-- customer contributions become receivable`. They are now **A10**, and A6 is the first of the family rather than a one-off.

---

### A9a · The void/closed-period hole — GAP-35, and it goes first

**A live defect, roughly half a day, and it grows with every item built before it.** Migration `0006` made `assert_period_open()` return early on any `UPDATE` that leaves `posted_period_id` untouched — correct for its own case (settling a July rent with an August payment) and correct for the twelve others it silently fixed. But **a void sets only `voided_at`**, so voiding a record posted into a closed month is refused by nothing, and July's reported costs change after July closed. `voidExpense` has no period check either. This is precisely the "wrong, plausible, unnoticed for months" failure the project exists to prevent, and it is live today.

**Fix it in the trigger, not in thirteen domain functions.** Two implementations of one rule diverge, and the one that loses is the database.

**The shape, and why it is not obvious.** `assert_period_open()` is attached to **19** tables (`0001`'s `FOREACH t IN ARRAY` block); only **13** carry `voided_at` — `payment`, `day_record`, `mileage_assessment`, `payment_correction`, `insurance_claim` and `trip` do not. A function that names `NEW.voided_at` directly fails on those six with `record "new" has no field "voided_at"`. So the test must be column-presence-safe:

```sql
IF TG_OP = 'UPDATE' AND NEW.posted_period_id IS NOT DISTINCT FROM OLD.posted_period_id THEN
  -- A void is a new reversal fact, not an incidental update: it must obey
  -- the closed-period rule even though posted_period_id is unchanged.
  -- to_jsonb keeps this legal on the six trigger tables with no voided_at.
  IF (to_jsonb(OLD) ->> 'voided_at') IS NULL
     AND (to_jsonb(NEW) ->> 'voided_at') IS NOT NULL THEN
    NULL;                     -- fall through to the closed check below
  ELSE
    RETURN NEW;               -- 0006's case, unchanged
  END IF;
END IF;
```

**Traps:**
- **Do not narrow `0006`.** Settling an obligation, correcting a payment and every other posted-period-preserving update must stay legal. Only the `NULL → NOT NULL` transition on `voided_at` is caught.
- **Un-voiding is not a thing.** There is no path that clears `voided_at`; do not add one to make the test symmetric.
- **`voidExpense` still needs its `PERIOD_CLOSED` mapping** — the trigger raises, `isPeriodClosedViolation` already recognises the shape, and the handler must return 409 rather than 500.
- **The DM §13 drift assertion is unaffected** — no table joins or leaves the array. Re-run it anyway; it is the check that caught this array being wrong once already.

**Done means** — voiding an expense posted into a closed period returns `PERIOD_CLOSED`, voiding one in the open period still works, settling a closed-period obligation with a current-period payment still works (the `0006` regression test), and the golden fixtures still land on 134,000 / 15,000 / 7,500.

### A6 · The trip receivable — closes GAP-23, needs A9a

**The design is settled** (post at booking, `kind: 'trip_fare'`, `source_type: 'trip'`, `source_id: tripId`, `due_on`/`effective_due_on` = the trip's end date, void on cancel). The reasoning is recorded in TRACKER §4 and is not reopened here. What follows is only what validating it against the code changed.

**It is a behaviour change to `bookTrip`, not an addition.** `bookTrip` has never touched `accounting_period` — no `resolvePeriodLinkage`, no `posted_period_id`. An obligation needs one, so **booking a charter becomes refusable with `PERIOD_CLOSED` when no period is open**, exactly as `closeTrip` and `recordPayment` already are. Say so in the route-def's responses and test it; a shipped endpoint quietly gaining a new failure mode is how a screen ends up with an unhandled error path.

**`resolvePeriodLinkage` takes a date, but `postedPeriodId` is always the currently open period** — the date only decides `belongs_to_period_id` (W-35). Pass the **booking date**, not the trip's start or end: booking is the fact being posted. `BookTripInput` has no date field today, so it gains one, supplied by the handler from `businessToday()` (never `new Date()`, never `CURRENT_DATE`).

**Only post the obligation when there is a customer and an amount.** `trip.customer_id` is nullable, `BookTripInput.customerId` is optional, and `obligation`'s CHECK demands exactly one party — so an owner-driven charter with no customer row simply raises no receivable. Mirror `closeTrip`'s own guard on the driver-fee side, which already writes nothing when `driverFeeMinor` is 0:

```ts
if (input.customerId !== undefined && input.agreedAmountMinor > 0n) { … }
```

**The migration widens a CHECK, which the guard treats as destructive.**

- The constraint is **unnamed in `0001`** (`kind text NOT NULL CHECK (kind IN (…))`), so Postgres generated the name. **Look it up on the live branch before writing the migration** (`SELECT conname FROM pg_constraint WHERE conrelid = 'obligation'::regclass AND contype = 'c'`) rather than assuming `obligation_kind_check` — `0006`'s header records that this project confirms against the live branch instead of reading the schema, and that is why it was right.
- `DROP CONSTRAINT` matches the `migration/destructive` guard pattern. It needs an inline `-- allow: widening a CHECK is additive; the old set stays valid` — the exemption is the point, so it shows up in the diff.
- Number it after whatever A9a takes. Forward-only, hand-written, one number per migration.

**On cancel, void the obligation — and mind the idempotent path.** `cancelTrip` returns early when `trip.status === 'cancelled'`; that early return must not re-void. Voiding is an `UPDATE` setting `voided_at`, so **it is subject to A9a's new rule** — cancelling a trip booked in a now-closed month will return `PERIOD_CLOSED`. That is correct (it changes a closed month's receivables) and it is exactly why A9a comes first.

**Done means** — booking a charter for a customer raises a `trip_fare` receivable that `listReceivables` shows and `POST /api/payment` allocates against; cancelling voids it; a charter with no customer raises nothing; income still recognises only at close, off `trip.posted_period_id`, and **G-1 still lands on 134,000**.

### A10 · The other two silent zeros — closes GAP-39 and GAP-10

**New item, and it exists because A6 turned out to have siblings.** Three places in this system take an amount somebody has agreed to owe and never turn it into an obligation. A6 fixes the first. These are the other two, and they fail the same way: a real receivable reads as zero, in a report, forever, with nothing on screen to suggest anything is missing.

**GAP-39 — the management fee that has never reduced anything.** `sumVehicleCostsForPeriod` reads `obligation WHERE kind = 'management_fee'`. The enum value exists; the query is written; **nothing has ever inserted one.** W-53's "a management fee reduces that vehicle's profit" has been a no-op since P7, so every managed vehicle's profit has been overstated by exactly the fee. Needs a **generator**, not a read-side fix — the same shape as `generate-billing-periods`, turning a live `management_fee_agreement` into one obligation per period. Decide deliberately whether it runs on the existing billing-period cron or at period close, and record which; A2's `GET /api/partner/{userId}` reads `monthly_amount_minor` directly and must keep agreeing with whatever this writes.

**GAP-10 — the incident contribution nobody can pay.** `recordCustomerContribution` inserts an `incident_recovery` row with `source: 'customer'` and an `agreedAmountMinor`, and leaves `obligation_id` NULL. The customer has agreed to pay toward the damage and it appears in no receivable, no ageing bucket, and no payment allocation. **`0001` even documents the intent on the column** — `obligation_id uuid, -- customer contributions become receivable`. Post an obligation in the same transaction (`kind: 'customer_contribution'`, which already exists in the CHECK — no migration), set `obligation_id`, and mind that `incident_recovery` separates `posted_period_id` from `received_period_id` deliberately: agreeing and receiving are different months and §7.2 reports both.

**Trap shared by both, and by A6:** these each add a place a void can now happen against a closed period, which is why all three sit behind A9a.

**Done means** — a managed vehicle's profit drops by its management fee in UC-70, an agreed customer contribution shows up as a receivable a payment can settle, and G-2 still lands on 15,000.

### A7 · R2 upload — closes GAP-16, independent of everything else

**One endpoint unblocks five recorded gaps**: condition photos at lease start and close, incident damage photos, expense receipts, and the side-by-side comparison. `attachment` (DM §12) is already generic and polymorphic, its `kind` CHECK already lists every value the five need (**no migration**), and `PhotoCapture` + the tested `photo-pipeline.ts` are built with **0 real callers**.

**Decide the upload path before writing anything, and record it.** IG §10 requires objects be *served* through presigned expiring URLs, never a public bucket — that is about reads, and it is not negotiable (condition photos are dispute evidence and show number plates). It does **not** dictate how bytes get in. Two options, and the plan's title has been quietly assuming the first:

- **Presigned PUT** — the client uploads straight to R2. Needs the S3 API and real credentials signed with `aws4fetch`, i.e. two new secrets, because **a bucket binding cannot presign**. Keeps large bodies out of the Worker entirely.
- **Upload through the Worker** using the `R2` binding (`env.R2.put()`) — no new secrets, no signing library, and the Worker is already the only thing that can authorise the write and insert the `attachment` row in the same breath. The client pipeline compresses before upload, so the bodies are small.

**Recommendation: upload through the binding, presign only for reads.** It is fewer moving parts, needs no credential rotation story, and keeps the `attachment` row and the object from ever disagreeing. Write the reason down either way — this is the kind of choice that gets silently reversed later.

**The bucket exists now.** `api/wrangler.jsonc` gained real `fleetsettle-attachments` / `-qa` buckets in the uncommitted deployment work; before A7 that binding was a `todo-provision-before-deploy` placeholder. A7 depends on that work landing, which is the one external dependency on this track.

**Traps:**
- **`business_id` on the `attachment` row comes from the token**, and reading an object must re-check it. An `r2_key` is guessable if it encodes anything predictable; make it opaque and still verify.
- **`attachment` has no `voided_at` and no `archived_at`** — there is currently no way to remove a wrongly-uploaded photo, and A9 does not cover it because it is not a money table. Decide whether that is a gap or intended, and record it. Do not add a hard delete without deciding.
- **GAP-17 stays open** — the pipeline still runs on the main thread with no Worker + 3s timeout. Unchanged by this item; do not let it look closed.

### A8 · Expense odometer wiring and the borne-by preview — independent

Two small gaps Web-P8b surfaced and recorded rather than guessed at. **Neither blocks anything**, both make a shipped form more complete, and validation shrank both.

**GAP-30 — wire `expense.odometer_reading_id`.** A DB column since P3, never referenced by any schema, query or domain function. The plan called "does a fuel fill create its own `odometer_reading` row transactionally?" the real decision; **the codebase has answered it four times** — `lease.ts`, `mileage.ts` and `trip.ts` (opening and closing) each insert one inside their own transaction, and no standalone odometer endpoint exists at all. Follow the convention: `createExpense` inserts the reading and the expense in one transaction and links them. Its doc comment currently says "a single insert" — update it, since that stops being true. Note the `0005` unique index is partial (`WHERE lease_id IS NOT NULL`), so a fuel-fill reading carries no one-per-day constraint; two fills in a day are two readings, which is correct.

**GAP-32 — a borne-by *preview*, not a second lookup.** The lookup already exists: `resolveBorneByDefault` calls `findActiveLeaseForVehicle` and `findCurrentDailyLeaseForVehicle` today. What the form cannot do is **show** the user what the server will decide, because the client is forbidden from computing §6.7's matrix itself — which is why it omits `borne_by` unless overriding to "Us". One small read (`GET /api/expense/borne-by-preview?vehicleId=&category=`, or the same shape folded onto the vehicle read) returns the resolved default and the party's name, and the form can then display it and offer a real override. **Do not copy the matrix into the client** — Web-P8b's trap list forbids exactly that, and it is the reason this gap exists rather than having been quietly closed.

### A9b · The rest of soft delete — closes GAP-12 and GAP-36

**With A9a's hole fixed, this is ordinary breadth-first work:** ~15 endpoints and one migration. **Nothing in this system is ever hard-deleted, and that must not change** — but a record created by mistake (a test expense, a duplicate driver, a vehicle typed twice) currently has no way out of most tables.

**The rule, stated once:** soft delete only. A money record is **voided** (`voided_at`/`voided_reason`/`voided_by`, with a reason always required — W-50). An entity is **archived** (hidden from pickers and lists, still resolvable by id so historical records that reference it keep rendering). `audit_log` stays undeletable by its own `DO INSTEAD NOTHING` rule, and `accounting_period` is not soft-deletable at all — closing is a structural transition, not a record.

**Where things actually stand, verified table by table:**

| Layer | Mechanism | State |
|---|---|---|
| 13 money tables | the `voided_*` trio | structural on all 13; only `expense` has a domain function and endpoint (GAP-12) |
| the other 6 period-guarded tables | — | `payment`, `day_record`, `mileage_assessment`, `payment_correction`, `insurance_claim`, `trip` have **no `voided_at`**; `payment`'s undo is `POST /api/payment/{id}/correct` (P9) and `trip`/`lease`/`incident` use `status` transitions. Not gaps — do not add the column |
| `mileage_package` | `archived_at` + endpoint | built — the reference implementation for an entity |
| `business_member` | `revoked_at` | built |
| `vehicle` | `lifecycle` column exists | **no endpoint ever sets it** — hardcoded `"active"` at creation, read-only thereafter |
| `driver`, `customer` | — | **no column at all** (GAP-36); a test row is permanent |
| `attachment` | — | no column either, and **not covered by this item** — see A7 |
| `audit_log` | `DO INSTEAD NOTHING` | correct as-is; never make this deletable |

**In order:**
1. **`archived_at` on `driver` and `customer`** (GAP-36), plus archive/unarchive endpoints. `mileage_package`'s "archive, never delete" is the pattern — copy it rather than inventing a second one.
2. **A `POST /api/vehicle/{id}/archive`** driving the `lifecycle` column that has existed since `0001` and never moved.
3. **Void endpoints for the remaining twelve money tables** (GAP-12), each mirroring `voidExpense`'s proven shape: find-scoped-to-business → 404, already-voided → its own error, then a `writer.transaction` (never a bare update, or `changed_by` records `NULL`).

**Traps:**
- **A void is a money write.** It must open a transaction even though nothing needs atomicity, or `withActor` cannot attribute it (TRACKER.md §5).
- **Voiding a parent does not void its children.** Voiding a `payment` leaves its `payment_allocation` rows, and the obligations they settled, exactly as they were — cascading is a second rule that will diverge from the first. Decide per table whether the domain function unwinds, and record the decision; `correctPayment` (P9) already solved this shape for payments and should be reused rather than duplicated.
- **A voided row stays visible, struck through, with its reason** (W-50) — `VehicleOverviewScreen`'s costs section and the vehicle/trip/incident expense lists already do exactly this. Reuse the treatment.
- **An archived entity must still resolve by id.** A voided expense that references an archived driver has to keep rendering his name; archiving hides him from pickers, it does not orphan history.
- **Never offer this as "Delete."** U-6's reserved vocabulary applies — the interface says "Void" for a money record and "Archive" for an entity, and says which one it means.

**Done means** — a test expense, driver, customer and vehicle each created by mistake can all be reversed out of every list they appear in, none of them leaves the database, a void into a closed period is refused by the trigger, and every one of those reversals names who did it in `audit_log`.

**Track B's half** is small and can follow whenever: a void/archive action on the existing detail screens, using the struck-through treatment that already exists. Not a separate B item — it belongs to whichever screen owns the record.

---

## Track B — the React client

| id | Item | Needs | Status |
|---|---|---|---|
| **B0** | **The `/more` hub** (GAP-37, GAP-40) | **nothing** | ▶ **do this first** — B2, B3 and B6 are unreachable without it, and nothing signs the user out |
| **B4** | Review shell + nine reports | **nothing** | ▶ start now |
| **B5** | Mine shell | **nothing** (A5 for the staff-side twin) | ▶ start now |
| **B7** | Offline and the PWA | **nothing** | ▶ startable, sequence last |
| **B2** | Partners, banking, cash | B0 (A2 ✅) | ▶ ready once B0 lands |
| **B3** | Close the month, corrections | B0 (A3 ✅) | ▶ ready once B0 lands |
| **B6** | Customer detail | B0 (A4 ✅) | ▶ ready once B0 lands |
| **B8** | ✅ Real Asgardeo | — | done 5 Aug 2026 |
| ~~B1~~ | ~~`ExpenseListScreen`~~ | — | **withdrawn** — see below |

### B0 · The `/more` hub — closes GAP-37 and GAP-40, and three B items need it

**Missed by the previous edition, and it gates two of them.** `/more` renders `NotBuiltYetScreen` (`router.tsx`), and §3.1 puts **Cash, reports, period close, settings, message log, business** behind that tab. §3.3 gives `/cash`, `/partners/:id`, `/reports` and `/period/close` **no other entry point** — the tab bar has five fixed slots and none of them is "Cash". So every screen B2 and B3 build is reachable only by typing a URL until this exists.

Small: one screen, a list of rows, no backend increment. **Rows for what exists only** — a row leading to `NotBuiltYetScreen` is worse than no row. Reports appears when B4 lands, Cash when B2 does, and so on.

**It also carries sign-out (GAP-40).** B8 wired `signOutRedirectURL` and the SDK's `signOut` exists, but **nothing calls it** — a session currently ends when its token expires or the browser is cleared, which on a shared phone is the wrong answer. §3.1 puts account actions behind this tab, so it belongs here rather than as an item of its own. One row, one call, one confirm.

**Traps:**
- The close-month row is **absent for a `manager`, not disabled** (M-22/W-49, the same rule §7.7 states for the close action itself).
- **Sign-out must clear the query cache**, not only the token. TanStack Query holds one person's money on screen; the next sign-in on the same device must not paint it before the first fetch returns.

### B1 · Withdrawn, and why

The previous edition named an `ExpenseListScreen` for Web-P8b. **It was not built, correctly.** UI §3.3's route map has no business-wide costs route at all: `/vehicles/:id` already covers costs per-vehicle (Web-P5, read-only), and §3.1 puts F-3.1/F-3.3 under the **`＋` Add** tab — "not a destination, no route change" — never under a list screen. `docs/` outranks the plan.

Recorded rather than quietly dropped, so the same screen is not proposed a third time. `GET /api/expense` keeps its own value and its own gap id (GAP-33).

### B4 · The Review shell and nine reports — start now

**Nine tested endpoints and no interface. The partner whose entire use of this product is reading reports has nothing until this ships** — `FirstRunGate` sends the `owner` role to `NotBuiltYetScreen` today.

**Backend increment: none.** All nine exist, capability-gated, proven linked-driver-safe in one loop.

**Screens** — `web/src/features/reports/`: the Review shell's own tab set (`AppShell` already accepts `shell="review"` and renders it), a report catalogue, one screen per report. New routes `/reports` and `/reports/:key`.

**The one hard problem, and it needs deciding before any chart is drawn:** money is `bigint` in the client and **must never become a `number`, "not even for a chart axis"** ([web/CLAUDE.md](web/CLAUDE.md)). Recharts wants numbers. Resolve it deliberately — scale to a display unit at the very edge, in one place, isolated and tested exactly as the money codec is. Do not let a `Number(minor)` leak into a component. The backend already solved this twice for *ratios* (`profitPerKm`, `kmPerLitre` each carry their own lint disable and a recorded reason); follow that precedent rather than inventing a third convention.

**Traps:**
- **Two capability gates.** `viewReports` (STAFF) covers seven; `viewOwnerOnlyReports` (OWNERS) covers UC-77 and UC-79. **The catalogue must not render a card the role cannot fetch** — a 403 the user could have been spared is a bug.
- **Degrade to "not available", never zero** (W-56). `profitPerKm` and `kmPerLitre` come back `null` **by design**; `NotAvailable` and `Rs 0` must look different on screen.
- **The lost-day denominator is `ran + lost`.** Display it as the backend computed it; never recompute a percentage client-side.
- **No accounting vocabulary reaches the interface** (U-6) — no "accrual", "receivable", "allocation" in any title or axis label.
- **GAP-19**: UC-79 ships without `revenuePerAvailableDayMinor`. Do not draw an axis for a figure the endpoint does not return.

**Done means** — all nine render from real data, correctly gated per role, both themes, 360×640.

### B5 · The Mine shell — start now

**Backend increment: none.** `GET /api/driver-view` has been ready since P12.

**Screens** — `web/src/features/mine/`: `MineScreen` on `/me` — `TwoBalances`, his days including excused ones, closed trips and fees, advances, offsets, the held deposit, a Statement link. `AppShell` already accepts `shell="mine"` and renders no tabs for it. Replaces `FirstRunGate`'s `driver` → `NotBuiltYetScreen` branch.

**Traps:**
- **There is no `driverId` anywhere in this route, by construction** (INV-25). The client must never introduce one — not as a prop, not as a query param, not "for testing". The endpoint has no slot for it; keep it that way on this side too.
- **`TwoBalances` never nets** (W-2), and this is the screen where a driver would most want it to.
- **Excused days are included** (§7.9) — they are the thing he would otherwise argue about. Do not filter them out to tidy the list.

**Note the overlap with A5.** This screen and a fuller `DriverDetailScreen` render nearly the same facts from two different endpoints under two different gates. Build `MineScreen` first — its endpoint exists — and factor the shared presentation only once A5 lands, not speculatively.

**Done means** — a linked driver's token renders exactly his own data, and no request shape exists that could return anyone else's.

### B2 · Partners, banking and cash — A2 done, waits only on B0

**Screens** — `web/src/features/partners/`: `PartnerDetailScreen`, `OwnershipSharesForm`, `CapitalContributionSheet`, `ShareVehicleForm` (F-1.4), `BankingEventForm`, `CashPositionScreen`. New routes `/cash` and `/partners/:id`.

**`PartnerListScreen` is a section on `/cash`, not a route.** §3.3 has `/partners/:id` and deliberately no `/partners` — and `GET /api/reports/cash-position` already returns every partner with a name and a held figure, which *is* the list. A separate list route would be a second way to reach the same rows, and the route map is the document that decides.

**Traps:**
- **The shares form submits the whole set at once, never row by row**, and surfaces `OWNERSHIP_SHARES_INVALID` as a 400 rather than pre-checking the sum client-side. The trigger is deferred and fires once at commit — a client-side sum check is a second implementation of it.
- **Capital is not ownership** (W-52). Never render one as the other; never show a derived gap.
- **An overlapping management agreement is a 409** from an `EXCLUDE` constraint. Catch it; do not pre-check.
- **The banking discrepancy's bearer is required exactly when recorded ≠ counted**, and the form must **only ever offer `absorbed` / `unattributed`**. The third enum value means the shortfall was traced to a receipt and corrected there instead (F-8.2) — it can never arrive through this form, and the request schema already refuses it.
- **GAP-1 again: do not build UI that implies per-vehicle scoping exists.**

**Done means** — a 60/40 split saves in one write and reads back; a shared vehicle with a monthly fee grants and revokes.

### B3 · Close the month and corrections — A3 done, waits only on B0

**Screens** — `web/src/features/period/`: `CloseMonthScreen` on `/period/close`, `CorrectPaymentSheet`, `WriteOffSheet`, `PostClosureChargeSheet`, plus **`Timeline` finally wired to real `audit_log` data** — it has one caller today and was built for exactly this.

**`CorrectPaymentSheet` needs a payment row to open from**, which is `GET /api/payment` (GAP-38, shipped in A3). Where that row lives is this item's own decision — the lease hub's dues section and the driver/customer detail screens are all candidates; §7.10 only says "open the receipt."

**Traps:**
- **The checklist warns and lists; it never blocks** (U-7). The close button stays enabled.
- **`unconfirmedDays` is the checklist's first row** (§7.7) and is now in the response (A3). Render all five rows — none is missing any longer, so there is no "state plainly which is missing" fallback to reach for.
- **Closing opens the successor period in the same transaction.** The screen must make clear that this happened, since every later write depends on it.
- **A correction's `bearer` is the whole decision.** `back_to_arrears` puts the party back in arrears (INV-22); `absorbed_loss` leaves their due settled and the business eats it. Two outcomes from one form, and the copy must say which is which **without using the word "allocation"** (U-6).
- **A waiver and a write-off never share a bucket** (W-28). Separate entry points, separate reporting, never one combined "reduce this due" control.
- **`PERIOD_CLOSED` comes from the trigger**, never a client pre-check. Catch it and explain it.
- **GAP-15**: "deduct it from his fee" is `POST /api/offset` applied afterward. Either wire it as two explicit steps or leave it out — do not imply a combined endpoint exists.

**Done means** — a month closes end to end with its successor open; a correction moves a party back into arrears and the audit trail shows who did it.

### B6 · Customer detail — A4 done, waits only on B0, closes GAP-22

`/people/customers/:id` replaces `PlaceholderDetailRoute`. §3.3: dues, payments, statement.

**Reuse `LeaseHubScreen`'s dues section wholesale** — same rows, same "tappable only while `pending`/`part_paid`" rule, same `ActionSheet` into `CollectPaymentSheet`/`AdjustObligationSheet`. This screen is the party-scoped twin of one that already exists; building it a second way would be the drift.

### B7 · Offline and the PWA — startable, sequence last

Cross-cutting: it wraps every screen, so building it before the screens exist means rebuilding it per screen. **Startable at any time, correct to finish last.**

**What lands** — TanStack Query persistence; the paused-mutation queue (M-12) replaying with a **fresh token per attempt**; a 401 on replay pausing and re-authenticating rather than discarding; the eviction warning while the queue is non-empty; the iOS "Add to Home Screen" hint; runtime caching (stale-while-revalidate reads), deferred from P0's shell-precache-only PWA.

**Traps:**
- **A discarded mutation is a lost money record.** Pause and re-authenticate; never drop.
- **`HomeScreen`'s skeleton branch becomes reachable for the first time.** Web-P3 built it correctly and recorded that its one trigger condition — a warm cache — could not occur before this item exists. **Verify it now rather than assuming it works.**
- **`Provisional` has 0 real callers** and is the one inventory component no item claims. If it belongs anywhere it is here; if it doesn't, say so and record it.
- Side-by-side condition comparison needs photos, which need A7.

**Done means** — four days confirmed on a Sunday with no signal replay silently on Monday, and the money lands once.

### B8 · Done

**Shipped 5 August 2026** (`96301f8`), and it was larger than this plan said. The previous edition costed B8 at "about ten minutes of console work" — true of the console half only. The client half was **unbuilt and unscoped**: no SDK in `web/package.json`, no PKCE flow, no login screen, no real `TokenGetter`. `auth-stub.ts` issues an unsigned token that `verifyAccessToken` was always going to refuse, so until this landed **nobody could log in to a deployed build at all.**

What shipped: `@asgardeo/auth-react` ^5.6.2 (the SDK UI § settled on in July) · `lib/auth-asgardeo.ts` — config from `VITE_*`, PKCE on, redirect derived from the serving origin · `app/AuthGate.tsx` — completes the code exchange on `/auth/callback`, offers sign-in otherwise, blocks until there is a session. 12 new tests.

**§12.1's contract paid for itself.** Because the token getter is *injected* into `createApiClient` rather than imported, swapping the stub for the real thing changed `main.tsx` and nothing else — no screen, no query, no test of either.

**Three defects it surfaced, none of which were auth code:**
- **The client id in `api/wrangler.jsonc` was stale in all three environments.** It is checked as `aud`, so every token from the real apps would have 401'd with nothing in the message to say why (IG §10.6's undifferentiated 401, working exactly as designed and costing an afternoon to diagnose if it had reached QA).
- **`deploy:qa` ran plain `vite build`**, whose default mode is `production` — QA would have silently shipped production's client id. Now `--mode qa`, proven by building both and grepping each bundle for the other's id.
- **The callback cannot use `history.replaceState`.** The router is built once at module scope over browser history, so rewriting the URL underneath it leaves it resolving the callback path it captured at creation.

**Verified against the live tenant, not assumed:** the OIDC discovery document's `issuer` and `jwks_uri` match `ASGARDEO_ISSUER`/`ASGARDEO_JWKS_URL` exactly, `authorization_code` + S256 PKCE are supported, and the JWKS serves one RS256 key. The console now has JWT token type, PKCE mandatory, hybrid flow off, and all four redirect URLs — both `/auth/callback` paths and both bare origins, the latter because `signOutRedirectURL` is the origin.

**Not yet done: one real browser round trip.** Everything either side of it is verified; the flow itself needs a human with a password.

---

## How the tracks run

```
        Track A (Worker + shared schemas)          Track B (React client)
        ─────────────────────────────────          ──────────────────────
done    A1  GET /api/expense ✅                     ~~B1 ExpenseListScreen~~ withdrawn
        A2  partner/banking/cash + members ✅        B0  the /more hub (no backend dependency)
        A3  period/write-off/payment ✅              B4  Review shell + 9 reports
        A4  customer reads ✅                        B5  Mine shell
        A5  driver history ✅                        B2  partners, banking, cash (needs B0 only; A2 ✅)
                                                     B3  close the month, corrections (needs B0 only; A3 ✅)
                                                     B6  customer detail (needs B0 only; A4 ✅)
                                                     B5+ driver detail history (A5 ✅)
now     A9a GAP-35 — the void/closed-period hole  ← do this one first
        A6  trip receivable (needs A9a)
        A10 the other two silent zeros (needs A9a)
        A7  R2 upload (unblocks 5 gaps; independent)
        A8  odometer wiring, borne-by preview (independent)
        A9b the rest of soft delete
last                                                B7  offline and the PWA
                                                     B8  real Asgardeo ✅
```

**Track B never idles.** B4 alone is larger than A2 was, and B5, B6 and B7 sit behind it with no backend dependency at all — every Track A handoff Track B was ever waiting on has landed.

**Track A's remaining items are no longer independent of each other.** A9a (the GAP-35 trigger fix) gates A6 and A10, because both add new places the defect can fire. A7 and A8 stay genuinely independent and can be picked up at any point.

**There are no Track A → Track B handoffs left.** A2 → B2, A3 → B3, A4 → B6 and A5 → B5+ have all happened; B2, B3, B5+ and B6 wait on B0 alone now. A6–A10 change what the *existing* endpoints return (or add writes behind existing screens) rather than unblocking a new screen — A7 is the one exception, and its dependent screens are photo work that no B item currently claims.

---

## The bar every item clears

Unchanged, restated so no session goes looking:

- **360 × 640, one thumb, no horizontal scroll**, and it still reflows at 320px.
- **Every create form saves with level-1 fields only** (U-2) — an automated test, not an intention. Every existing form has one; match the wording ("saves with X alone") so they stay greppable.
- **44 × 44 minimum**, ≥ 8px apart, ≥ 16px when one is destructive.
- **Money is `string` on the wire, `bigint` in the client, never `number`.**
- **`Rs 0` and `NotAvailable` are visibly different things.**
- **No raw hex** — `--color-*` tokens only, and colour never carries meaning alone.
- **Reserved vocabulary, never abbreviated**, and no accounting words at all.
- **New token → add it to `theme.text`/`theme.spacing` in `cn.ts`**, or tailwind-merge silently drops it (TRACKER.md §5).
- **New form → inherit the three structural fixes** (TRACKER.md §5): domain-typed form state with `toWire()` only in `mutationFn`, `blankToUndefined` on optional text, `Disclosure forceOpen` on a level-2 error.
- **A new money table is not finished until it is in the `assert_period_open()` array** (Track A only).
- **A new write to a `posted_period_id`-carrying table must open a transaction**, or its audit row records `changed_by` as `NULL` (Track A only).
- `npm run check` clean across all three workspaces — **and, for Track A, the touched integration file re-run alone**, since `check` does not include it and the shared Neon branch drops connections at random. `TEST_PARALLEL=1` against a personal branch (TRACKER.md §5) cuts a full local suite run from ~29 minutes to ~105 seconds — worth setting up before a Track A session, not just for the touched-file re-run.
- **a11y is axe-core in Playwright**, not `eslint-plugin-jsx-a11y` — its peer range caps at ESLint 8/9 and this repo is on 10.
- [TRACKER.md](TRACKER.md) updated: the item becomes a **row**, its leftovers become **gap rows with a track**.

---

## Skipped by decision

**R2 presigned uploads** — carried as **A7** rather than dropped, because the previous edition skipped it and the cost has compounded: five recorded gaps, a built-and-tested `photo-pipeline.ts`, and a `PhotoCapture` component with 0 callers, all waiting on one endpoint against an already-polymorphic `attachment` table.

**Per-vehicle capability scoping (GAP-1)** — backend hardening, out of scope on both tracks. Until it lands, an `owner_manager` shared one vehicle reaches every vehicle's capital, payouts and reports. It blocks no screen and closing it later forces no rework, since endpoint shapes do not change — **but B2 must not imply the scoping exists.**

**Error monitoring (GAP-28)** — deferred deliberately, not forgotten. Workers Logs stays the only observability until there is an on-call person and a channel to page.

**Also out, and recorded in [TRACKER.md](TRACKER.md) §4:** UC-73 (yearly) and UC-99 (export), both product-phase Second · UC-79's `revenuePerAvailableDayMinor` (GAP-19) · F-8.4's deposit-apply (GAP-6) · void-and-replace for the other twelve W-50 tables (GAP-12) · everything under "Not in this tracker".

---

## The things that were not code — all of them now done

This section listed the external work that gated something real. **It is empty.** Kept as a record, because two of the three cost far more than their entry said they would.

1. ✅ **Asgardeo's console change** — 5 August 2026. JWT token type, PKCE mandatory, hybrid flow off, four redirect URLs. **This entry read "ten minutes, blocks nothing else" and both halves were wrong**: it blocked every deployed login, and the client work behind it was unbuilt and unsized. See B8.
2. ✅ **Deployment** — 5 August 2026. Both environments live, both Neon branches migrated, deploy-on-merge for each. It needed **no application code at all**, because every route already sat under `/api/*` and the client already defaulted its base URL to `""`.
3. ✅ **CI's integration workflow** — below.

**The one still outstanding is P14's twelve Meta template approvals**, and it is the only thing on either track waiting on anybody else. Worth firing now regardless of when P14 runs — each approval is minutes to two days, and they queue.

**Done, 5 August 2026: CI's integration workflow.** Was blocked on `secrets.NEON_API_KEY`/`vars.NEON_PROJECT_ID`, absent from the repo — no endpoint had ever been tested by CI at all. Configured via the Neon GitHub App and verified with a real PR run: all seven migrations applied from scratch, the DM §13 drift check, and all 328 integration tests, green, in 12m49s. One live bug surfaced and fixed along the way — Neon's Free plan rejects an explicit `suspend_timeout` on branch creation outright, even at the value it already defaults to — recorded in [TRACKER.md](TRACKER.md) §5 so it isn't rediscovered. Nothing on either track depended on this, but it was the single highest-value non-code fix available, and it's done.

---

## When an item here is finished

Write it up in [TRACKER.md](TRACKER.md) as **one row**, not a section — what it delivers, its proof with real test counts, and a gap id for anything it did not build. Tick the row off here and move on. This file is a plan and goes stale; that one is the record.
