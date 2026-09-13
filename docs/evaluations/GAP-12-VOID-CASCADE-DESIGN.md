# GAP-12 — the nine remaining void endpoints: cascade design

**Written 14 August 2026, on `wave5b/corrections-2026-08-14`, after PR #44 merged.**
**Status: built and closed, 14 August 2026 — same day.** All nine endpoints below shipped as designed (migration `0024`'s `offset_allocation` void trio, the two read-side filters, `VoidBlockedError`, nine `*AlreadyVoidedError` classes, 23 new integration tests), and the doc-change §7 asked for landed the same day, before any of the nine were built (`use-cases.md` W-61, `user-flows.md` INV-36 and F-8.5). [TRACKER.md](../../TRACKER.md)'s GAP-12 row carries the closing account and the two bugs found building it; this file keeps the design reasoning that got there.

This is a working design note, not a specification. `docs/` decides, and by the time this closed, `docs/` already agreed with every decision below — nothing here overrides it. [TRACKER.md](../../TRACKER.md) carries the one-paragraph summary; this file carries the reasoning, kept for a cold session reconstructing *why*, not *whether*.

---

## 1. Where this sits

**Already built and merged (PR #44):**

| | |
|---|---|
| Step 0 | `use-cases.md` W-60 / UC-100, `user-flows.md` INV-35 / F-1.11 — the archive-refusal rule |
| GAP-36 | `POST /api/{driver,customer}/{id}/archive` + `/unarchive`, sharing `domain/party-archive.ts`'s INV-35 open-money check; `POST /api/vehicle/{id}/archive` + `/unarchive` driving `lifecycle` |
| GAP-12, 3 of 12 | `capital_contribution`, `banking_event`, `partner_payout` — the group with no children to unwind, each a straight copy of `voidExpense`'s shape |

**What this document covers:** the **nine remaining tables**, every one of which has a child row, a derived status, or a sibling money record that must move with it.

`adjustment` · `offset_record` · `deposit_movement` · `advance` · `advance_settlement` · `write_off` · `write_off_recovery` · `incident_recovery` · `obligation`

---

## 2. The governing principle

Five of the nine decisions came out of one rule, arrived at by walking real corrections rather than by symmetry:

> **Cascade into rows minted by the same call. Refuse when separately-entered user actions sit beneath.**

A `write_off_recovery`'s `payment` row is minted by `recordWriteOffRecovery` itself — the manager never entered it separately, and there is no screen on which it exists alone. Unwinding it with its parent is one act being undone, not two.

An `advance_settlement`, a `write_off_recovery` beneath a write-off, a receipt beneath an incident recovery are each their own deliberate entry. Voiding a parent must **refuse** and name them, so the manager undoes what he actually did, in the order he did it, with his own reason on each row.

This is the concrete form of Plan.md's standing A9b trap — *"voiding a parent does not void its children; cascading is a second rule that will diverge from the first"* — sharpened by the observation that the trap protects **independently entered** records, not rows that only ever existed as part of the parent.

---

## 3. The decisions, per table

Reference shape for all nine: [`voidExpense`](../../api/src/domain/expense.ts) + [`voidExpenseRow`](../../api/src/queries/expense.ts) — existence check scoped to business → already-voided check → `writer.transaction` (`withActor` only attributes inside a real one) → catch `isPeriodClosedViolation` → `PeriodClosedError`. `voidedReason` is always a parameter, never hardcoded. Every void `UPDATE` carries `WHERE … voided_at IS NULL` so a losing race is a no-op rather than a clobber (the Gitar finding from PR #44, now the house pattern).

### 3.1 `adjustment` — reverse the effect; surplus becomes credit

`applyAdjustmentTx` does not merely insert a row: a waiver raises `waived_minor`, every other type moves `amount_minor` by `sign × amount`, then recomputes status. The void must reverse exactly that.

Reversing a **waiver** is always safe (it lowers `waived_minor`, easing DM §10.1's `CHECK (settled_minor + waived_minor <= amount_minor)`).

Reversing a **`+1`** adjustment (`late_fee`, `extra_charge`) is not. Rent 1,000 → late fee +500 → amount 1,500 → he pays 1,500 → `settled` 1,500. Void the fee and `amount_minor` would fall to 1,000 beneath a `settled_minor` of 1,500: the CHECK fails, and in plain terms he has overpaid by 500.

**Decided: allow it, unwinding `payment_allocation` newest-first until it fits.** The excess then sits as unallocated credit — DM §10.2's existing convention, spendable against his next due. `payment.status` stays `active`: cash never moves, only what it is allocated against.

*Why not refuse* (the first answer, changed on re-validation): "reverse the receipt first" has no honest implementation. `correctPayment` is UC-93, explicitly *"the entry was right and the money genuinely did not arrive"* — using it on cash that did arrive misdescribes physical money. A waiver would record a chosen discount (W-28/INV-14) for what was a typo. Both misdescribe the event; unwinding the allocation is the only option that describes what happened.

### 3.2 `offset_record` — unwind both sides (needs a migration)

`createOffset` writes allocations on **both** directions (W-2's one sanctioned both-balance move), each raising `settled_minor` on real obligations. The void must reverse both, symmetrically, or a driver's two balances both understate what is outstanding.

**Blocker: `offset_allocation` has no `voided_*` trio.** Migration `0022` gave it to `vehicle_day_allocation`, `payment_allocation`, `day_record` and `opening_balance_entry` — not to this one, despite it being structurally identical to `payment_allocation` (a child allocation row moving `obligation.settled_minor`). Migration `0023` then closed its `ON DELETE CASCADE`. So today an offset allocation cannot be undone by any W-58-legal route. **This is a pre-existing W-58 gap, found here.**

**Decided: one migration adds the trio, then the void unwinds properly** — for each live allocation, reverse `settled_minor`, recompute status via `computeObligationStatus`, void the allocation row; then void the `offset_record`. One transaction.

### 3.3 `deposit_movement` — void, **and** fix the read

`sumDepositMovements` does **not** filter `voided_at`. Adding a void without fixing it repeats GAP-120 exactly: trio added, read side unaware, balance silently unchanged by the void.

**Decided: real void endpoint, with `isNull(depositMovement.voidedAt)` added to `sumDepositMovements` in the same change.**

*Why not keep the offsetting-entry convention* (GAP-103 reverses an opening-balance movement by posting an equal-and-opposite `refunded` row): `movement_type` is a business fact — `refunded` means money was handed back. Correcting a mistyped movement with a fake `refunded` row makes the history claim a refund that never happened, so *"have we ever refunded him?"* answers wrongly forever. GAP-103's own use stays as-is; an opening-balance reversal genuinely is a giving-back.

### 3.4 `deposit.status` — recompute on void

`deposit.status` is written **forward-only**: `recordDepositMovement` flips it via a `TERMINAL[movementType]` lookup and nothing ever recomputes it. Voiding a terminal movement would leave a deposit reading `released` while its balance is back above zero — **and that weakens INV-35's archive guard, already merged**, since `findOpenDepositsForParty` only counts `status IN ('held','hold_window')`. A wrongly-`released` deposit would let a party be archived with money still held.

**Decided: recompute on void** — newest live terminal movement wins; if none remains, fall back to `hold_window` when `hold_release_date` is set (F-2.7/W-29 sets that outside the movement history) else `held`. Fully derivable, no new stored state.

### 3.5 `advance_settlement` — recompute the parent, restore INV-17

`sumSettledForAdvance` also ignores `voided_at`, and `advance.status` is written forward-only at settlement time. The consequence is sharp: `findUnsettledAdvancesForTrip` gates INV-17 on `status != 'settled'`, so a voided settlement leaving `status = 'settled'` makes the advance **invisible to the trip-close block** — the trip closes while the driver still holds the cash. UC-44 calls that the one place friction is correct, *"because unreconciled advances turn trip profit into fiction."*

**Decided: void the settlement, add the `voided_at` filter to `sumSettledForAdvance`, recompute `advance.status`** from the live settlements using the same arithmetic `settleAdvance` already applies.

### 3.6 `advance` — refuse while settlements are live

**Decided: refuse, naming the settlements and their total.** Void those first, each with its own reason. (§2's principle: settlements are separately entered.)

### 3.7 `write_off` — restore the obligation; refuse while recoveries are live

`recordWriteOff` flips the linked obligation to `written_off` and never touches `settled_minor`/`waived_minor` — so `computeObligationStatus(amount, settled, waived)` restores **exactly** the prior state with no stored history needed.

**Decided: recompute the obligation's status that way, and refuse while any live `write_off_recovery` points at it.**

### 3.8 `write_off_recovery` — cascade the payment

`recordWriteOffRecovery` mints a `payment` (direction `received`, deliberately never allocated) alongside the recovery row. Voiding only the marker leaves that payment `active` and unallocated, so DM §10.2's credit query (`amount − SUM(live allocations) > 0`) surfaces it as **spendable customer credit** — a recovered bad debt silently becoming money he can apply to a future due, against INV-15.

**Decided: cascade — void the recovery and `markPaymentReversed` its payment, one transaction.** The principled exception of §2: this payment was never independently entered.

*On the transient state:* marking a real arrival "reversed" is only honest because W-50's model is void-**and-replace** — the same is true of voiding an expense that really happened. The end state after replacement is correct.

### 3.9 `incident_recovery` — refuse while money is received, **and fix re-record**

`recordCustomerContribution` mints an obligation (`source_type='incident_recovery'`); `recordRecoveryReceived` — a separate, later action — sets `received_amount_minor`, settles that obligation, and mints a payment + allocation.

**A live bug, found by asking how a manager would actually fix a fat-fingered recovery:** `recordIncidentRecoveryReceived` **overwrites** `received_amount_minor` (SET, not `+=`), so re-recording *does* correct the recovery and its obligation — but `recordRecoveryReceived` mints a **fresh `payment` on every call, unconditionally**. Correcting a receipt therefore double-posts cash into UC-75's position and the customer's payment history. Pre-existing, unrelated to voiding.

**Decided: the void refuses while `received_amount_minor > 0`** (cascading only `voidObligationBySource`, which already exists and is used by `cancelTrip`), **and `recordRecoveryReceived` is fixed to be a real correction** — reverse the prior payment and void its allocation before posting the new pair. Re-recording is the path a manager reaches for first, so it is the one that must be right.

### 3.10 `obligation` — direct void only for directly-raised sources

Every obligation is derived from a source — billing period, day record, trip, incident — **except** a post-closure charge, which `POST /api/post-closure-charge` (F-8.4/UC-91) raises directly from user input with no other row to correct instead. A mistyped one is currently uncorrectable.

**Decided: a direct void allowed only where `source_type` names something a human raised on purpose** (`post_closure_charge` today), refusing derived ones so a number never detaches from its cause — rent, daily amounts, driver fees and trip fares are corrected at their source (close the lease, void the day, cancel the trip). Plus the standing guard: refuse when live allocations or adjustments sit against it.

Note `opening_balance` obligations stay **out** of the allowlist — GAP-103's batch reversal is their correction path.

---

## 4. Cross-cutting decisions

**Cascade reasons.** Child rows get the manager's own words with a short prefix naming the cause — `` `Parent offset voided: ${reason}` ``. Keeps `voidedReason` a real parameter rather than the hardcoded string the A9b trap warns against, and an investigator reading the child row alone still learns why.

**GAP-60's `replaces_id` is out of scope here.** *"The replacement writes `replaces_id`, not the void"* means each table's **create** path needs an optional `replacesId` — ~13 create endpoints and their wire schemas. That is its own item after these nine, not folded in: the nine are already large and each carries a cascade decision. The column exists on 13 tables since migration `0021` with zero writes.

**Track B consequence, stated now rather than discovered later.** Four of the nine refuse with a "void the children first" workflow (§3.6, §3.7, §3.9, §3.10). On 360 × 640 that is only usable if each refusal **names the blocking rows** and the client can reach them. Otherwise U-5's *"every figure can be corrected later"* is true in the API and false in the hand. Every refusal error in §3 therefore carries its blocking figures in `details`, the same shape `PartyHasOpenMoneyError` already uses.

---

## 5. Verified, so nobody re-derives it

**Closed periods interact correctly. Nothing to decide.**

- Setting `voided_at` **is** a post: migration `0008` narrows `0006`'s exception so the `NULL → NOT NULL` transition falls through to the closed check. So **every void is refused once that record's own month is closed** — correct per W-35/UC-98 ("closing is one-way"). A mistake found after close is corrected by an adjustment posting to the open period, not by a void.
- Updating `obligation.settled_minor`/`status` in a closed period **is** allowed: `0006` returns early when `posted_period_id` is unchanged, deliberately (rent posted July, paid August). Safe here because both readers — `listReceivables` and the ageing report — are **as-of-now** views, not period-scoped, so reversing an allocation moves *current outstanding* and never retroactively rewrites a closed month's reported income.

**Three read-side filters are mandatory alongside their writes** (GAP-120's lesson): `sumDepositMovements`, `sumSettledForAdvance`, and the new `offset_allocation` reads all currently ignore `voided_at`.

---

## 6. Work items, in build order

| # | Item | Notes |
|---|---|---|
| 1 | **`doc-change`** | §7 — must land first; F-8.5 is silent on every cascade here |
| 2 | **Migration** — `voided_*` trio on `offset_allocation` | Wave 5's second migration. Same `CHECK` shape as `0023` (reason required, non-empty). Take the next free number; A14's share-link table is the other claimant |
| 3 | Read-side filters | `sumDepositMovements`, `sumSettledForAdvance` — with their writes, never after |
| 4 | The nine void endpoints | Group them: no-status-effect first (`adjustment`, `obligation`), then status-recompute (`deposit_movement`, `advance_settlement`, `write_off`), then refuse-guards (`advance`, `write_off_recovery`, `incident_recovery`, `offset_record`) |
| 5 | **Fix `recordRecoveryReceived`** | §3.9's live double-post bug — independently valuable, can land first if preferred |
| 6 | Widen `check-forbidden.mjs` | `money/void-table-unfiltered`, currently scoped to the four tables `0022` named, to every newly-voidable table |

Each endpoint carries the standard matrix (happy · 401 · 403 · **404 cross-tenant** · 409 already-voided · `PERIOD_CLOSED`) plus its own cascade assertions.

**All six items done, 14 August 2026, same day** — see TRACKER.md's GAP-12 row for the closing account, including the two bugs found building item 4 (`adjustmentId` missing from the create response, and §3.9's own `recordRecoveryReceived` double-post, item 5 above).

---

## 7. The doc-change this owes, before any code

Ownership runs downhill, so this starts in intent and flows down — the same order Step 0 used for INV-35.

**`use-cases.md` — a new `W-61`:** the §2 principle as a business policy. *What correcting means across the ledger: undoing one act undoes what that act minted, and never what someone else entered separately.* This belongs at intent level because it is the same class of decision as W-50 ("money records are append-only") and W-58 ("nothing is hard-deleted"), both of which are intent, not mechanics.

**`user-flows.md` — a new `INV-36` plus `F-8.5` clauses:** the per-table mechanics of §3 — which query filters `voided_at`, which status recomputes, which parent refuses and on what. Plus the two facts from §5 worth stating explicitly: a void is refused once its month closes, and reversing an allocation is legal in a closed period because the readers are as-of-now.

**Also record, per this repository's convention, what was *not* taken** — the refuse-only answer for §3.1 and the offsetting-entry answer for §3.3, both with the reasoning above, so the same argument is not had twice.

**Landed 14 August 2026, before any of the nine endpoints — `use-cases.md` W-61, `user-flows.md` INV-36 and F-8.5**, exactly as asked above.

---

## 8. Gaps this surfaced, worth filing separately

1. **`offset_allocation` never received the W-58 void trio** — pre-existing, fixed by item 2 above.
2. **`recordRecoveryReceived` double-posts payments on re-record** — pre-existing and live; a manager correcting a fat-fingered recovery amount silently duplicates cash in UC-75. Fixed by item 5.
